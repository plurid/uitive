import type { AnyContract, Aptuitive } from '@plurid/aptuitive-core';
import { defineElements } from './define.js';
import { AptElement } from './element.js';
import { adaptMarkup } from './markup.js';
import type { MarkupOptions } from './markup.js';

/**
 * Starts Aptuitive on a page without React, once: registers the elements and gives every one the
 * client, adapts the markup marked with `data-apt-list` and `data-apt-item` (see `adaptMarkup`),
 * starts a new session when the person comes back after a while, plans each session from use once
 * (see `learn`), and saves usage whenever the page is hidden or closed. Returns a function that
 * undoes it all.
 */
export function startAptuitive<C extends AnyContract>(
  client: Aptuitive<C>,
  options: MarkupOptions = {},
): () => void {
  defineElements();
  AptElement.useClient(client);
  const stop = adaptMarkup(client, options);
  const root = options.root ?? document;
  const owner = root.nodeType === 9 ? (root as Document) : (root as ShadowRoot).ownerDocument;
  const view = owner.defaultView;
  void client.learn();
  const visibility = () => {
    if (owner.visibilityState === 'visible') {
      client.resume();
      void client.learn();
    } else client.flush();
  };
  const hide = () => client.flush();
  owner.addEventListener('visibilitychange', visibility);
  view?.addEventListener('pagehide', hide);
  return () => {
    stop();
    owner.removeEventListener('visibilitychange', visibility);
    view?.removeEventListener('pagehide', hide);
    AptElement.useClient(undefined);
  };
}
