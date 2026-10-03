#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run } from './commands.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

run(process.argv.slice(2), { version, out: process.stdout, err: process.stderr }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`uitive: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
