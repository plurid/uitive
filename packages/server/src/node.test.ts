import { createServer, request as httpRequest } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { createUitive, heuristicPlanner } from '@plurid/uitive-core';
import { afterAll, describe, expect, it } from 'vitest';
import { ops } from '../../planner/src/__fixtures__/ops.js';
import { createUitiveHandler } from './handler.js';
import { toNodeListener } from './node.js';

const body = JSON.stringify(
  createUitive({ contract: ops, now: () => 0 }).request('command', 'compact'),
);
const json = { 'content-type': 'application/json' };
const handler = createUitiveHandler({
  contract: ops,
  planner: heuristicPlanner(),
  authorize: () => true,
});
const seen: string[] = [];
const errors: unknown[] = [];
const listener = toNodeListener(handler, { maxBody: 4096 });
const listeners: Record<string, ReturnType<typeof toNodeListener>> = {
  echo: toNodeListener(async (request) => {
    seen.push(request.url);
    return new Response('{}', { headers: json });
  }),
  throws: toNodeListener(
    async () => {
      throw new Error('the handler broke');
    },
    { onError: (error) => errors.push(error) },
  ),
};

// Rejections of the listener's promise, which node:http and Express 4 drop and Node exits on.
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
process.on('unhandledRejection', onUnhandled);

// As Express does after `express.json()`: the body is already parsed, and the URL is the mount's.
const server = createServer((request, response) => {
  const own = Object.entries(listeners).find(([name]) => request.url?.includes(`/${name}`));
  if (own) void own[1](request, response);
  else if (request.url?.startsWith('/parsed/')) {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString()));
    request.on('end', () => {
      Object.assign(request, { body: JSON.parse(text), url: request.url?.slice('/parsed'.length) });
      void listener(request, response);
    });
  } else void listener(request, response);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;
afterAll(() => {
  process.off('unhandledRejection', onUnhandled);
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Sends a request as raw text, for what `fetch` won't send, and returns the status line. */
const raw = (text: string) =>
  new Promise<string>((resolve) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString()));
    const finish = () => resolve(data.split('\r\n')[0] || '(no response)');
    socket.on('end', finish);
    socket.on('error', finish);
    setTimeout(() => {
      socket.destroy();
      finish();
    }, 1500);
  });

/** Sends a request with this Host header and path, which `fetch` won't let a caller choose. */
const withHost = (path: string, host: string) =>
  new Promise<number>((resolve, reject) => {
    const outgoing = httpRequest(
      { host: '127.0.0.1', port, method: 'POST', path, headers: { ...json, host } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    outgoing.on('error', reject);
    outgoing.end(body);
  });

describe('toNodeListener', () => {
  it('serves the handler from node:http, with bodies read or already parsed', async () => {
    for (const path of ['/api/uitive/command', '/parsed/api/uitive/command']) {
      const response = await fetch(`${base}${path}`, { method: 'POST', body, headers: json });
      expect(response.status, path).toBe(200);
      expect((await response.json()).operations[0].change).toMatchObject({ value: 'compact' });
    }
    expect((await fetch(`${base}/api/uitive/command`)).status).toBe(404);
  });

  it('streams progress lines, and refuses large bodies unread', async () => {
    const response = await fetch(`${base}/api/uitive/command`, {
      method: 'POST',
      body,
      headers: { ...json, accept: 'application/x-ndjson' },
    });
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    expect((await response.text()).trim().split('\n').at(-1)).toContain('"type":"result"');
    const large = await fetch(`${base}/api/uitive/command`, {
      method: 'POST',
      body: 'x'.repeat(10_000),
      headers: json,
    });
    expect(large.status).toBe(413);
  });

  it('answers malformed requests and failing handlers instead of rejecting', async () => {
    const before = unhandled.length;
    const statuses = await Promise.all([
      raw(
        'POST /api/uitive/plan HTTP/1.1\r\nHost: a:b:c\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}',
      ),
      raw(
        'POST /api/uitive/plan HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 4\r\nConnection: close\r\n\r\nnull',
      ),
      raw(
        'POST /throws/plan HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      ),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(statuses).toEqual([
      'HTTP/1.1 400 Bad Request',
      'HTTP/1.1 400 Bad Request',
      'HTTP/1.1 500 Internal Server Error',
    ]);
    expect((errors[0] as Error).message).toBe('the handler broke');
    expect(unhandled.slice(before)).toEqual([]);
  });

  it('gives the handler a fixed origin, whatever the Host header or path claims', async () => {
    seen.length = 0;
    await withHost('/echo/plan?x=1', 'localhost');
    await withHost('//localhost/echo/plan', 'victim.example');
    expect(seen).toEqual([
      'http://uitive.invalid/echo/plan?x=1',
      'http://uitive.invalid//localhost/echo/plan',
    ]);
  });
});
