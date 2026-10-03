// Develop against Aptuitive's source: aliases the packages to `src`, so apps and tests see
// every edit without a build and, given a handler module, serves it at `/api/aptuitive`.
import { fileURLToPath } from 'node:url';
import { loadEnv, type Plugin } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const packages = ['core', 'react', 'dom', 'planner', 'adapter', 'server', 'cli', 'mcp'];

export interface AptuitiveDevOptions {
  /**
   * A module, relative to the app's root, exporting `handler: (request: Request) =>
   * Promise<Response>`. It runs in the dev server, never in the browser.
   */
  handler?: string;
}

export function aptuitive(options: AptuitiveDevOptions = {}): Plugin {
  return {
    name: 'aptuitive',
    enforce: 'pre',
    config(config, environment) {
      // Planner credentials stay server-side: copied into the dev server's environment only,
      // never exposed to client code (that would need a VITE_ prefix).
      const variables = loadEnv(environment.mode, config.envDir ?? config.root ?? process.cwd(), [
        'ANTHROPIC_',
        'OPENAI_',
        'GEMINI_',
        'GOOGLE_',
        'APTUITIVE_',
      ]);
      for (const [key, value] of Object.entries(variables)) process.env[key] ??= value;
      return {
        resolve: {
          alias: packages.flatMap((name) => [
            {
              find: new RegExp(`^@plurid/aptuitive-${name}$`),
              replacement: `${root}packages/${name}/src/index.ts`,
            },
            {
              find: new RegExp(`^@plurid/aptuitive-${name}/(.+)$`),
              replacement: `${root}packages/${name}/src/$1.ts`,
            },
          ]),
        },
      };
    },
    configureServer(server) {
      const entry = options.handler;
      if (!entry) return;
      server.middlewares.use('/api/aptuitive', (request, response, next) => {
        void (async () => {
          const module = (await server.ssrLoadModule(entry)) as {
            handler: (request: Request) => Promise<Response>;
          };
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(chunk as Buffer);
          // Stop planning, and spending, when the browser goes away.
          const controller = new AbortController();
          response.on('close', () => {
            if (!response.writableEnded) controller.abort();
          });
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            if (typeof value === 'string') headers.set(key, value);
          }
          const method = request.method ?? 'GET';
          const answer = await module.handler(
            new Request(
              `http://${request.headers.host ?? 'localhost'}${request.originalUrl ?? request.url}`,
              {
                method,
                headers,
                ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
                signal: controller.signal,
              },
            ),
          );
          response.statusCode = answer.status;
          answer.headers.forEach((value, key) => response.setHeader(key, value));
          // Pass the body on as it arrives, so streamed progress reaches the page live.
          const reader = answer.body?.getReader();
          for (;;) {
            const chunk = await reader?.read();
            if (!chunk || chunk.done) break;
            response.write(Buffer.from(chunk.value));
          }
          response.end();
        })().catch(next);
      });
    },
  };
}
