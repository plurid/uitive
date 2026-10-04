import { copyFile, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

async function connect(root: string, allowNetwork = false) {
  const [near, far] = InMemoryTransport.createLinkedPair();
  await createServer({ root, allowNetwork }).connect(far);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(near);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    return {
      text: result.content.map((entry) => entry.text).join('\n'),
      error: result.isError ?? false,
    };
  };
  return { client, call };
}

async function shop() {
  const root = await mkdtemp(join(tmpdir(), 'uitive-mcp-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'shop-admin', dependencies: { react: '^19.0.0' } }),
  );
  await copyFile(here('../../../tools/fixtures/openapi/shop.yaml'), join(root, 'openapi.yaml'));
  await symlink(here('../../cli/node_modules'), join(root, 'node_modules'));
  return root;
}

describe('uitive-mcp', () => {
  it('offers the agent kit as tools', async () => {
    const { client } = await connect(await shop());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'uitive_detect',
      'uitive_init',
      'uitive_openapi_survey',
      'uitive_generate_sources',
      'uitive_generate_blocks',
      'uitive_discover',
      'uitive_check',
      'uitive_preview_plan',
    ]);
    expect(tools.find((tool) => tool.name === 'uitive_check')?.annotations?.readOnlyHint).toBe(
      true,
    );
  });

  it('integrates a project from detection to a checked contract', async () => {
    const root = await shop();
    const { call } = await connect(root);
    expect((await call('uitive_detect')).text).toContain('API description  openapi.yaml');
    const survey = await call('uitive_openapi_survey', { spec: 'openapi.yaml' });
    expect(survey.text).toContain('orders (/admin/orders)');
    const set = await call('uitive_init', {
      format: 'json',
      dir: 'app/uitive',
      agents: false,
    });
    expect(set.error).toBe(false);
    expect(JSON.parse(set.text).written).toContain('app/uitive/api.generated.ts');
    expect((await call('uitive_init', { dir: '../outside' })).error).toBe(true);
    // The folder is recorded, so checking needs no path.
    const checked = await call('uitive_check');
    expect(checked).toMatchObject({
      error: false,
      text: expect.stringContaining('All checks pass.'),
    });
    const preview = JSON.parse(
      (await call('uitive_preview_plan', { text: 'canceled orders this week' })).text,
    );
    expect(preview).toMatchObject({ scoped: false, schema: { optional: 0, unions: 1 } });
    expect(preview.sources).toContain('orders');
  });

  it('stays inside the project, and off the network unless allowed', async () => {
    const root = await shop();
    const { call } = await connect(root);
    expect(await call('uitive_openapi_survey', { spec: '../elsewhere.yaml' })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^The description \.\.\/elsewhere\.yaml is outside the project/),
    });
    expect(await call('uitive_detect', { cwd: '/' })).toMatchObject({ error: true });
    expect(
      await call('uitive_openapi_survey', { spec: 'https://api.example.com/openapi.json' }),
    ).toMatchObject({
      error: true,
      text: 'Reading from URLs is off; download the description into the project first',
    });
  });
});
