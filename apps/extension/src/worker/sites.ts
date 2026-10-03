import { pattern } from '../../manifest.ts';

const id = (origin: string) => `site-${origin.replace(/[^a-z0-9]+/gi, '-')}`;

/** Runs the content script on an origin the person enabled; the permission is theirs to give. */
export async function enable(origin: string): Promise<void> {
  if (!(await chrome.permissions.contains({ origins: [pattern(origin)] }))) {
    throw new Error(`Allow Uitive on ${origin} first`);
  }
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id(origin)] });
  if (existing.length > 0) return;
  await chrome.scripting.registerContentScripts([
    {
      id: id(origin),
      matches: [`${origin}/*`],
      js: ['content.js'],
      runAt: 'document_start',
      persistAcrossSessions: true,
    },
  ]);
}

export async function disable(origin: string): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id(origin)] });
  if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [id(origin)] });
  await chrome.permissions.remove({ origins: [pattern(origin)] }).catch(() => false);
}

export async function enabled(origin: string): Promise<boolean> {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id(origin)] });
  return existing.length > 0;
}
