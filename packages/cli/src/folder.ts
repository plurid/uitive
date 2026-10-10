import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

/** Where Uitive's files go unless the project says otherwise. */
export const FOLDER = 'uitive';

/**
 * A folder for Uitive's files, with forward slashes and no leading `./` or trailing slash. It must
 * stay inside the project: every command reads and writes there.
 */
export function normalizeFolder(dir: string): string {
  const folder = dir
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '');
  if (
    folder === '' ||
    folder === '.' ||
    isAbsolute(folder) ||
    win32.isAbsolute(folder) ||
    folder.split('/').includes('..')
  ) {
    throw new Error(
      `The folder for Uitive's files must be inside the project, such as src/uitive, not "${dir}"`,
    );
  }
  return folder;
}

/**
 * Where a project keeps Uitive's files: `uitive.dir` in its package.json, which
 * `init --dir` writes, else `uitive`. Relative to the project, with forward slashes. A folder
 * outside the project, absolute or through `..`, is refused.
 */
export async function folderOf(cwd: string): Promise<string> {
  let dir: unknown;
  try {
    const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
      uitive?: { dir?: unknown };
    };
    dir = manifest.uitive?.dir;
  } catch {
    // Without a readable package.json, the default.
  }
  if (typeof dir === 'string' && dir.trim() !== '') {
    try {
      return normalizeFolder(dir);
    } catch {
      throw new Error(
        `uitive.dir in package.json must be a folder inside the project, such as src/uitive, not "${dir}"`,
      );
    }
  }
  return FOLDER;
}

/** A path with its symbolic links resolved as far as it exists; nothing when a link dangles. */
async function real(path: string): Promise<string | undefined> {
  const rest: string[] = [];
  for (let current = resolve(path); ;) {
    try {
      return join(await realpath(current), ...rest);
    } catch {
      // Something there that doesn't resolve, such as a dangling link, would be followed by a write.
      if (
        await lstat(current).then(
          () => true,
          () => false,
        )
      ) {
        return undefined;
      }
      const parent = dirname(current);
      if (parent === current) return undefined;
      rest.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Whether a path stays inside a folder once symbolic links resolve, so that reading or writing it
 * can't reach anything outside. A relative path is taken from the folder.
 */
export async function within(folder: string, path: string): Promise<boolean> {
  const [base, target] = await Promise.all([real(folder), real(resolve(folder, path))]);
  if (base === undefined || target === undefined) return false;
  const away = relative(base, target);
  return !(away === '..' || away.startsWith(`..${sep}`) || isAbsolute(away));
}
