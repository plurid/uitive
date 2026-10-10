import '../zod.ts';
import { pattern } from '../../manifest.ts';
import { adapterById, adapterFor, adapters } from '../adapters.ts';
import type { Loaded } from '../adapters.ts';
import { toWorker } from '../messages.ts';
import type { ToWorker } from '../messages.ts';
import { connectorFetch, ConnectorError, forgetReads, secretName } from './connector.ts';
import { keyName, keyPattern, refusal } from './keys.ts';
import { meter, READ_BUDGET, TOKEN_BUDGET } from './limits.ts';
import { forgetPlans, servePlanner } from './planner.ts';
import { clearSecret, clearSecrets, secretNames, setSecret } from './secrets.ts';
import { disable, disableAll, enable, enabled, enabledOrigins } from './sites.ts';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

const fromPanel = (sender: chrome.runtime.MessageSender) =>
  (sender.url ?? '').startsWith(chrome.runtime.getURL('panel/'));

/** Which secret a name is: the pattern its value must fit, what it's called, and what it refuses. */
function secretRule(
  name: string,
): { pattern: RegExp; label: string; refused?: (value: string) => string | undefined } | undefined {
  if (name === 'anthropic') return { pattern: /^sk-ant-/, label: 'a Claude API key (sk-ant-...)' };
  if (name === 'openai') return { pattern: /^sk-(?!ant-)/, label: 'an OpenAI API key (sk-...)' };
  if (name === 'google') return { pattern: /^AIza/, label: 'a Gemini API key (AIza...)' };
  const [, adapterId, connectorName, mode] =
    /^connector:([^:]+):([^:]+):(test|live)$/.exec(name) ?? [];
  const adapter = adapterId ? adapterById(adapterId)?.adapter : undefined;
  const connector = adapter?.connectors[connectorName ?? ''];
  if (!adapter || !connector || (mode !== 'test' && mode !== 'live')) return undefined;
  const pattern = keyPattern(connector, mode);
  if (!pattern) return undefined;
  return {
    pattern,
    label: keyName(adapter, connector, mode),
    refused: (value) => refusal(connector, value),
  };
}

/** What enabling a site asks the browser for: the site, and the APIs its adapter reads. */
const accessFor = (origin: string): string[] => [
  ...new Set([
    pattern(origin),
    ...Object.values(adapterFor(origin)?.adapter.connectors ?? {}).map((connector) =>
      pattern(connector.base),
    ),
  ]),
];

/** Gives back host permissions no enabled site still needs; those granted at install stay. */
async function release(origins: readonly string[]): Promise<void> {
  const fixed = new Set(chrome.runtime.getManifest().host_permissions ?? []);
  const needed = new Set((await enabledOrigins()).flatMap(accessFor));
  const spare = [...new Set(origins)].filter((origin) => !fixed.has(origin) && !needed.has(origin));
  if (spare.length > 0) await chrome.permissions.remove({ origins: spare });
}

/** The page asking is one this adapter serves. */
function served(id: string, sender: chrome.runtime.MessageSender): Loaded {
  const loaded = adapterById(id);
  if (!loaded || !sender.tab || !sender.origin || !loaded.adapter.origins.includes(sender.origin)) {
    throw new Error('Not a page this extension serves');
  }
  return loaded;
}

async function handle(message: ToWorker, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.kind === 'fetch') {
    const loaded = served(message.adapter, sender);
    return connectorFetch(loaded.adapter, loaded.contract, message.mode, message.request);
  }
  if (message.kind === 'keys') {
    const loaded = served(message.adapter, sender);
    const stored = new Set(await secretNames());
    return Object.fromEntries(
      Object.keys(loaded.adapter.connectors).map((name) => [
        name,
        {
          test:
            loaded.adapter.testMode !== undefined &&
            stored.has(secretName(loaded.adapter.id, name, 'test')),
          live: stored.has(secretName(loaded.adapter.id, name, 'live')),
        },
      ]),
    );
  }
  if (!fromPanel(sender)) throw new Error('Only the side panel may ask that');
  switch (message.kind) {
    case 'site.status': {
      const tab = await chrome.tabs.get(message.tabId);
      // The address shows only where Uitive has access, or just after its button was clicked.
      const origin = tab.url ? new URL(tab.url).origin : null;
      const found = origin ? adapterFor(origin) : undefined;
      const sites = await Promise.all(
        adapters().flatMap(({ adapter }) =>
          adapter.origins.map(async (site) => ({
            origin: site,
            label: adapter.label,
            enabled: await enabled(site),
            access: accessFor(site),
          })),
        ),
      );
      return {
        origin,
        adapter: found
          ? {
              id: found.adapter.id,
              label: found.adapter.label,
              examples: found.adapter.examples,
              modes: found.adapter.testMode !== undefined,
            }
          : null,
        allowed: origin ? await chrome.permissions.contains({ origins: [pattern(origin)] }) : false,
        enabled: origin ? await enabled(origin) : false,
        access: origin && found ? accessFor(origin) : [],
        sites,
        connectors: found
          ? Object.entries(found.adapter.connectors).map(([name, connector]) => ({
              name,
              label: connector.label,
              key: connector.keys.label,
              hint: connector.keys.hint ?? {},
              secret: {
                ...(connector.keys.test === undefined
                  ? {}
                  : { test: secretName(found.adapter.id, name, 'test') }),
                live: secretName(found.adapter.id, name, 'live'),
              },
            }))
          : [],
      };
    }
    case 'site.enable':
      if (!adapterFor(message.origin)) throw new Error('No adapter for this site yet');
      await enable(message.origin);
      return true;
    case 'site.disable':
      await disable(message.origin);
      await release(accessFor(message.origin));
      return true;
    case 'secret.set': {
      const rule = secretRule(message.name);
      if (!rule) throw new Error('Unknown key');
      const refused = rule.refused?.(message.value);
      if (refused) throw new Error(refused);
      if (!rule.pattern.test(message.value)) throw new Error(`That isn't ${rule.label}`);
      await setSecret(message.name, message.value);
      return true;
    }
    case 'secret.clear':
      await clearSecret(message.name);
      return true;
    case 'secret.status':
      return secretNames();
    case 'usage':
      return {
        reads: await meter('reads'),
        tokens: await meter('tokens'),
        budget: READ_BUDGET,
        tokenBudget: TOKEN_BUDGET,
      };
    case 'forget': {
      forgetReads();
      forgetPlans();
      const granted = (await chrome.permissions.getAll()).origins ?? [];
      await disableAll();
      await Promise.all([
        chrome.storage.local.clear(),
        chrome.storage.session.clear(),
        clearSecrets(),
        release(granted),
      ]);
      return true;
    }
  }
}

chrome.runtime.onMessage.addListener((raw, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  const parsed = toWorker.safeParse(raw);
  if (!parsed.success) return false;
  handle(parsed.data, sender).then(
    (value) => reply({ ok: true, value }),
    (error: unknown) =>
      reply({
        ok: false,
        code: error instanceof ConnectorError ? error.code : 'failed',
        problem: error instanceof Error ? error.message : String(error),
      }),
  );
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'planner' && port.sender?.id === chrome.runtime.id) servePlanner(port);
});
