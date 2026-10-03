import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where Aptuitive's files go unless the project says otherwise. */
export const FOLDER = 'aptuitive';

/**
 * Where a project keeps Aptuitive's files: `aptuitive.dir` in its package.json, which
 * `init --dir` writes, else `aptuitive`. Relative to the project, with forward slashes.
 */
export async function folderOf(cwd: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
      aptuitive?: { dir?: unknown };
    };
    const dir = manifest.aptuitive?.dir;
    if (typeof dir === 'string' && dir.trim() !== '') {
      return dir.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    }
  } catch {
    // Without a readable package.json, the default.
  }
  return FOLDER;
}
