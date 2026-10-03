// Remove a package's build output so stale files never ship.
import { rm } from 'node:fs/promises';
const name = process.argv[2];
if (!['core', 'react', 'dom', 'planner', 'server', 'cli', 'mcp', 'adapter'].includes(name))
  throw new Error('Specify a package');
await rm(new URL(`../../packages/${name}/dist`, import.meta.url), { recursive: true, force: true });
