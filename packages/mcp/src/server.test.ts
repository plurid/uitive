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
  const root = await mkdtemp(join(tmpdir(), 'aptuitive-mcp-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'shop-admin', dependencies: { react: '^19.0.0' } }),
  );
  await copyFile(here('../../../tools/fixtures/openapi/shop.yaml'), join(root, 'openapi.yaml'));
  await symlink(here('../../cli/node_modules'), join(root, 'node_modules'));
  return root;
}

describe('aptuitive-mcp', () => {
  it('offers the agent kit as tools', async () => {
    const { client } = await connect(await shop());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'aptuitive_detect',
      'aptuitive_init',
      'aptuitive_openapi_survey',
      'aptuitive_generate_sources',
      'aptuitive_generate_blocks',
      'aptuitive_discover',
      'aptuitive_check',
      'aptuitive_preview_plan',
    ]);
    expect(tools.find((tool) => tool.name === 'aptuitive_check')?.annotations?.readOnlyHint).toBe(
      true,
    );
  });

  it('integrates a project from detection to a checked contract', async () => {
    const root = await shop();
    const { call } = await connect(root);
    expect((await call('aptuitive_detect')).text).toContain('API description  openapi.yaml');
    const survey = await call('aptuitive_openapi_survey', { spec: 'openapi.yaml' });
    expect(survey.text).toContain('orders (/admin/orders)');
    const set = await call('aptuitive_init', {
      format: 'json',
      dir: 'app/aptuitive',
      agents: false,
    });
    expect(set.error).toBe(false);
    expect(JSON.parse(set.text).written).toContain('app/aptuitive/api.generated.ts');
    expect((await call('aptuitive_init', { dir: '../outside' })).error).toBe(true);
    // The folder is recorded, so checking needs no path.
    const checked = await call('aptuitive_check');
    expect(checked).toMatchObject({
      error: false,
      text: expect.stringContaining('All checks pass.'),
    });
    const preview = JSON.parse(
      (await call('aptuitive_preview_plan', { text: 'cancelled orders this week' })).text,
    );
    expect(preview).toMatchObject({ scoped: false, schema: { optional: 0, unions: 1 } });
    expect(preview.sources).toContain('orders');
  });

  it('stays inside the project, and off the network unless allowed', async () => {
    const root = await shop();
    const { call } = await connect(root);
    expect(await call('aptuitive_openapi_survey', { spec: '../elsewhere.yaml' })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^The description \.\.\/elsewhere\.yaml is outside the project/),
    });
    expect(await call('aptuitive_detect', { cwd: '/' })).toMatchObject({ error: true });
    expect(
      await call('aptuitive_openapi_survey', { spec: 'https://api.example.com/openapi.json' }),
    ).toMatchObject({
      error: true,
      text: 'Reading from URLs is off; download the description into the project first',
    });
  });
});
