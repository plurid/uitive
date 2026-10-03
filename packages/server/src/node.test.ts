import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createUitive, heuristicPlanner } from '@plurid/uitive-core';
import { afterAll, describe, expect, it } from 'vitest';
import { ops } from '../../planner/src/__fixtures__/ops.js';
import { createUitiveHandler } from './handler.js';
import { toNodeListener } from './node.js';

const body = JSON.stringify(
  createUitive({ contract: ops, now: () => 0 }).request('command', 'compact'),
);
const handler = createUitiveHandler({ contract: ops, planner: heuristicPlanner() });
const listener = toNodeListener(handler, { maxBody: 4096 });

// As Express does after `express.json()`: the body is already parsed, and the URL is the mount's.
const server = createServer((request, response) => {
  if (request.url?.startsWith('/parsed/')) {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString()));
    request.on('end', () => {
      Object.assign(request, { body: JSON.parse(text), url: request.url?.slice('/parsed'.length) });
      void listener(request, response);
    });
  } else void listener(request, response);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('toNodeListener', () => {
  it('serves the handler from node:http, with bodies read or already parsed', async () => {
    for (const path of ['/api/uitive/command', '/parsed/api/uitive/command']) {
      const response = await fetch(`${base}${path}`, { method: 'POST', body });
      expect(response.status, path).toBe(200);
      expect((await response.json()).operations[0].change).toMatchObject({ value: 'compact' });
    }
    expect((await fetch(`${base}/api/uitive/command`)).status).toBe(404);
  });

  it('streams progress lines, and refuses large bodies unread', async () => {
    const response = await fetch(`${base}/api/uitive/command`, {
      method: 'POST',
      body,
      headers: { accept: 'application/x-ndjson' },
    });
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    expect((await response.text()).trim().split('\n').at(-1)).toContain('"type":"result"');
    const large = await fetch(`${base}/api/uitive/command`, {
      method: 'POST',
      body: 'x'.repeat(10_000),
    });
    expect(large.status).toBe(413);
  });
});
