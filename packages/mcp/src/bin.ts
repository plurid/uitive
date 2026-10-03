#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const HELP = `Usage: aptuitive-mcp [options]

Serves Aptuitive's agent kit over the Model Context Protocol, on stdio.

Options:
  --root <dir>       The project to work in; no tool reads or writes outside it.
                     Default: the current directory.
  --allow-network    Lets tools read API descriptions from URLs. Off by default: a URL a
                     model chose can carry data out.
  -h, --help
`;

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    'allow-network': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(HELP);
} else {
  // The transport owns stdout: anything else written there corrupts the stream.
  const server = createServer({
    ...(values.root ? { root: values.root } : {}),
    allowNetwork: values['allow-network'],
    version,
  });
  server.connect(new StdioServerTransport()).catch((error: unknown) => {
    process.stderr.write(
      `aptuitive-mcp: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
