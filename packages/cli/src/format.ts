import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Prettier {
  format(code: string, options: Record<string, unknown>): Promise<string>;
  resolveConfig(file: string): Promise<Record<string, unknown> | null>;
}

/** Formats generated code with the project's own Prettier and settings, when it has them. */
export async function formatLikeProject(code: string, file: string, cwd: string): Promise<string> {
  let prettier: Prettier;
  try {
    const path = createRequire(join(resolve(cwd), 'package.json')).resolve('prettier');
    const module = (await import(pathToFileURL(path).href)) as Prettier & { default?: Prettier };
    // Its CommonJS entry, which `require` resolves to, puts everything on `default`.
    prettier = typeof module.format === 'function' ? module : (module.default ?? module);
  } catch {
    return code;
  }
  try {
    const config = (await prettier.resolveConfig(file)) ?? {};
    return await prettier.format(code, { ...config, filepath: file });
  } catch {
    return code;
  }
}
