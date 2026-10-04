import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { SKILL } from 'uitive';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const json = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;
const frontmatter = (text: string) => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return Object.fromEntries(
    (match?.[1] ?? '').split('\n').map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
};

describe('the Claude Code plugin', () => {
  const plugin = json('plugins/claude-code/.claude-plugin/plugin.json');
  const marketplace = json('.claude-plugin/marketplace.json');

  it('has a manifest the marketplace points at', () => {
    expect(plugin.name).toBe('uitive');
    expect(plugin.name).not.toMatch(/^(claude|anthropic)/);
    const entries = marketplace.plugins as { name: string; source: string }[];
    expect(entries).toEqual([
      expect.objectContaining({ name: plugin.name, source: './plugins/claude-code' }),
    ]);
    expect(existsSync(new URL('plugins/claude-code/.claude-plugin/plugin.json', root))).toBe(true);
    // Only plugin.json belongs in .claude-plugin; everything else sits at the plugin's root.
    expect(readdirSync(new URL('plugins/claude-code/.claude-plugin/', root))).toEqual([
      'plugin.json',
    ]);
  });

  it('starts the MCP server from the published package, in the project', () => {
    expect(json('plugins/claude-code/.mcp.json')).toEqual({
      mcpServers: {
        uitive: {
          command: 'npx',
          args: ['-y', '@plurid/uitive-mcp', '--root', '${CLAUDE_PROJECT_DIR}'],
        },
      },
    });
  });

  it('bundles the same integration skill that init writes', () => {
    expect(read('plugins/claude-code/skills/integrate-uitive/SKILL.md')).toBe(SKILL);
  });

  it.each([
    'plugins/claude-code/skills/integrate-uitive/SKILL.md',
    'plugins/claude-code/skills/uitive-check/SKILL.md',
    'plugins/claude-code/agents/curator.md',
  ])('%s says what it is and when to use it', (path) => {
    const fields = frontmatter(read(path));
    expect(fields.name).toMatch(/^[a-z][a-z-]*$/);
    expect(fields.description?.length).toBeGreaterThan(40);
    expect(read(path)).not.toContain('\u2014');
  });
});
