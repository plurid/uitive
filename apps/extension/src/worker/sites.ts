import { pattern } from '../../manifest.ts';

const PREFIX = 'site:';
/** The origin itself names its registration, so no two origins ever share one. */
export const siteId = (origin: string) => `${PREFIX}${origin}`;
/** Registrations from before, when punctuation became dashes and a-b.com met a.b.com. */
const LEGACY = /^site-/;

const registration = (origin: string): chrome.scripting.RegisteredContentScript => ({
  id: siteId(origin),
  matches: [`${origin}/*`],
  js: ['content.js'],
  runAt: 'document_start',
  persistAcrossSessions: true,
});

let migrated: Promise<void> | undefined;

/** Moves registrations made under the old IDs to the new ones, once a worker start. */
function migrate(): Promise<void> {
  migrated ??= (async () => {
    const old = (await chrome.scripting.getRegisteredContentScripts()).filter((script) =>
      LEGACY.test(script.id),
    );
    if (old.length === 0) return;
    // An old registration's match tells its true origin, even where two origins shared its ID.
    const origins = [
      ...new Set(
        old.flatMap((script) => (script.matches ?? []).map((match) => match.replace(/\/\*$/, ''))),
      ),
    ];
    await chrome.scripting.unregisterContentScripts({ ids: old.map((script) => script.id) });
    const current = new Set(
      (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id),
    );
    const missing = origins.filter((origin) => !current.has(siteId(origin)));
    if (missing.length > 0)
      await chrome.scripting.registerContentScripts(missing.map(registration));
  })().catch((error: unknown) => {
    migrated = undefined;
    throw error;
  });
  return migrated;
}

/** Runs the content script on an origin the person enabled; the permission is theirs to give. */
export async function enable(origin: string): Promise<void> {
  await migrate();
  if (!(await chrome.permissions.contains({ origins: [pattern(origin)] }))) {
    throw new Error(`Allow Uitive on ${origin} first`);
  }
  if (await enabled(origin)) return;
  await chrome.scripting.registerContentScripts([registration(origin)]);
}

/** Stops running on an origin; pages already open keep their script until they reload. */
export async function disable(origin: string): Promise<void> {
  await migrate();
  if (await enabled(origin)) {
    await chrome.scripting.unregisterContentScripts({ ids: [siteId(origin)] });
  }
}

export async function enabled(origin: string): Promise<boolean> {
  await migrate();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [siteId(origin)] });
  return existing.length > 0;
}

/** Every origin the content script runs on. */
export async function enabledOrigins(): Promise<string[]> {
  await migrate();
  return (await chrome.scripting.getRegisteredContentScripts())
    .filter((script) => script.id.startsWith(PREFIX))
    .map((script) => script.id.slice(PREFIX.length));
}

/** Stops running everywhere. */
export async function disableAll(): Promise<void> {
  const ids = (await enabledOrigins()).map(siteId);
  if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
}
