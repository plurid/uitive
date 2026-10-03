import '../zod.ts';
import { pattern } from '../../manifest.ts';
import { adapterById, adapterFor } from '../adapters.ts';
import { toWorker } from '../messages.ts';
import type { ToWorker } from '../messages.ts';
import { connectorFetch, ConnectorError, secretName } from './connector.ts';
import { meter, READ_BUDGET } from './limits.ts';
import { servePlanner } from './planner.ts';
import { clearSecret, clearSecrets, secretNames, setSecret } from './secrets.ts';
import { disable, enable, enabled } from './sites.ts';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

const fromPanel = (sender: chrome.runtime.MessageSender) =>
  (sender.url ?? '').startsWith(chrome.runtime.getURL('panel/'));

/** Which secret a name is, and the pattern its value must fit. */
function secretRule(name: string): { pattern: RegExp; label: string } | undefined {
  if (name === 'anthropic') return { pattern: /^sk-ant-/, label: 'a Claude API key (sk-ant-...)' };
  const [, adapterId, connectorName, mode] =
    /^connector:([^:]+):([^:]+):(test|live)$/.exec(name) ?? [];
  const connector = adapterId
    ? adapterById(adapterId)?.adapter.connectors[connectorName ?? '']
    : undefined;
  if (!connector || (mode !== 'test' && mode !== 'live')) return undefined;
  return {
    pattern: new RegExp(connector.keys[mode]),
    label: `a ${mode} restricted key for ${connector.label}`,
  };
}

async function handle(message: ToWorker, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.kind === 'fetch') {
    const loaded = adapterById(message.adapter);
    if (
      !loaded ||
      !sender.tab ||
      !sender.origin ||
      !loaded.adapter.origins.includes(sender.origin)
    ) {
      throw new Error('Not a page this extension serves');
    }
    return connectorFetch(loaded.adapter, message.mode, message.request);
  }
  if (!fromPanel(sender)) throw new Error('Only the side panel may ask that');
  switch (message.kind) {
    case 'site.status': {
      const tab = await chrome.tabs.get(message.tabId);
      const origin = tab.url ? new URL(tab.url).origin : null;
      const found = origin ? adapterFor(origin) : undefined;
      return {
        origin,
        adapter: found ? { id: found.adapter.id, label: found.adapter.label } : null,
        allowed: origin ? await chrome.permissions.contains({ origins: [pattern(origin)] }) : false,
        enabled: origin ? await enabled(origin) : false,
        connectors: found
          ? Object.entries(found.adapter.connectors).map(([name, connector]) => ({
              name,
              label: connector.label,
              secret: {
                test: secretName(found.adapter.id, name, 'test'),
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
      return true;
    case 'secret.set': {
      const rule = secretRule(message.name);
      if (!rule) throw new Error('Unknown key');
      if (/^sk_(live|test)_/.test(message.value)) {
        throw new Error(
          'Secret keys are refused: create a restricted key with read permissions only',
        );
      }
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
      return { reads: await meter('reads'), tokens: await meter('tokens'), budget: READ_BUDGET };
    case 'forget':
      await Promise.all([
        chrome.storage.local.clear(),
        chrome.storage.session.clear(),
        clearSecrets(),
      ]);
      return true;
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
