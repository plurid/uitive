import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
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
    expect(await call('uitive_discover', { url: 'http://shop.test/' })).toMatchObject({
      error: true,
      text: 'Discovery crawls local development servers only, unless the network is allowed',
    });
  });

  it('configures agents inside the root, never at a repository above it', async () => {
    const base = await mkdtemp(join(tmpdir(), 'uitive-mcp-'));
    await mkdir(join(base, '.git'));
    await mkdir(join(base, 'app'));
    await writeFile(
      join(base, 'app', 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0' } }),
    );
    const { call } = await connect(join(base, 'app'));
    const result = await call('uitive_init', { format: 'json' });
    expect(result.error).toBe(false);
    expect(JSON.parse(result.text).written).toContain('.mcp.json');
    expect(existsSync(join(base, 'app', '.mcp.json'))).toBe(true);
    expect(existsSync(join(base, '.mcp.json'))).toBe(false);
    expect(existsSync(join(base, '.claude'))).toBe(false);
  });

  it('refuses components outside the root, alike whether they exist or not', async () => {
    const root = await shop();
    const outside = await mkdtemp(join(tmpdir(), 'uitive-outside-'));
    await writeFile(
      join(outside, 'secret.tsx'),
      "/** SECRET */\nexport function Leak(props: { mode: 'a' | 'b' }) { return null; }\n",
    );
    const { call } = await connect(root);
    const there = await call('uitive_generate_blocks', {
      components: [`${join(outside, 'secret.tsx')}#Leak`],
    });
    const missing = await call('uitive_generate_blocks', {
      components: [`${join(outside, 'missing.tsx')}#Leak`],
    });
    expect(there).toEqual({
      error: true,
      text: `The component ${join(outside, 'secret.tsx')} is outside the project (${root})`,
    });
    expect(missing.text.replace('missing', 'secret')).toBe(there.text);
    expect(existsSync(join(root, 'uitive', 'blocks.generated.ts'))).toBe(false);
  });

  it('refuses a Uitive folder outside the root, and links that lead out of it', async () => {
    const root = await shop();
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'shop-admin', uitive: { dir: '../escaped' } }),
    );
    const { call } = await connect(root);
    expect(await call('uitive_generate_sources', { spec: 'openapi.yaml' })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^uitive\.dir in package\.json must be a folder inside/),
    });

    const linked = await shop();
    const outside = await mkdtemp(join(tmpdir(), 'uitive-outside-'));
    await copyFile(join(linked, 'openapi.yaml'), join(outside, 'openapi.yaml'));
    await symlink(outside, join(linked, 'link'));
    const other = await connect(linked);
    expect(await other.call('uitive_openapi_survey', { spec: 'link/openapi.yaml' })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^The description link\/openapi\.yaml is outside the project/),
    });
    await symlink(outside, join(linked, 'uitive'));
    expect(await other.call('uitive_generate_sources', { spec: 'openapi.yaml' })).toMatchObject({
      error: true,
      text: expect.stringMatching(/^The folder for Uitive's files uitive is outside the project/),
    });
    expect(existsSync(join(outside, 'api.generated.ts'))).toBe(false);
  });

  it('writes only generated files in the Uitive folder, and names the curation by a relative path', async () => {
    const root = await shop();
    const { call } = await connect(root);
    for (const out of ['package.json', 'uitive/contract.ts', 'uitive/nested/api.generated.ts']) {
      expect(
        await call('uitive_generate_sources', { spec: 'openapi.yaml', out }),
        out,
      ).toMatchObject({
        error: true,
        text: expect.stringMatching(/^The output .* must be a file named like/),
      });
    }
    expect(
      await call('uitive_discover', { url: 'http://localhost:1/', out: 'uitive/curation.json' }),
    ).toMatchObject({ error: true, text: expect.stringMatching(/^The discovery file/) });
    const made = await call('uitive_generate_sources', {
      spec: 'openapi.yaml',
      out: 'uitive/shop.generated.ts',
    });
    expect(made.error).toBe(false);
    const code = await readFile(join(root, 'uitive', 'shop.generated.ts'), 'utf8');
    expect(code.split('\n')[1]).toBe(
      '// Keep choices in uitive/curation.json: regenerating replaces this file.',
    );
  });
});
