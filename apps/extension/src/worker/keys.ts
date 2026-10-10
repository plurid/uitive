import type { Adapter, Connector } from '@plurid/uitive-adapter';

/** A site's mode: its test data, or its live data, the only one a site without a test mode has. */
export type Mode = 'test' | 'live';

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** What a connector's key is called in the panel and in messages, such as "a test restricted key for Payments API". */
export function keyName(adapter: Pick<Adapter, 'testMode'>, connector: Connector, mode: Mode) {
  const { label } = connector.keys;
  return adapter.testMode === undefined
    ? `${article(label)} ${label} for ${connector.label}`
    : `${article(mode)} ${mode} ${label} for ${connector.label}`;
}

/** The pattern a key for a mode must fit, or nothing when the connector takes no keys for it. */
export const keyPattern = (connector: Connector, mode: Mode): RegExp | undefined => {
  const pattern = mode === 'test' ? connector.keys.test : connector.keys.live;
  return pattern === undefined ? undefined : new RegExp(pattern);
};

/** Why a key is refused whatever the mode, such as a secret key where a read-only one does. */
export const refusal = (connector: Connector, key: string): string | undefined =>
  connector.keys.refuse.find((rule) => new RegExp(rule.pattern).test(key))?.reason;
