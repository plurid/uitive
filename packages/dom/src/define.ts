import { AptAsk } from './ask.js';
import { AptBanner } from './banner.js';
import { AptConfirm } from './confirm.js';
import { AptMore } from './more.js';
import { AptYourInterface } from './your-interface.js';

/**
 * Registers `<apt-ask>`, `<apt-banner>`, `<apt-confirm>`, `<apt-more>` and `<apt-your-interface>`.
 * Safe to call more than once, and a no-op without a DOM, as during server rendering.
 */
export function defineElements(): void {
  const registry = (globalThis as { customElements?: CustomElementRegistry }).customElements;
  if (!registry) return;
  if (!registry.get('apt-ask')) registry.define('apt-ask', AptAsk);
  if (!registry.get('apt-banner')) registry.define('apt-banner', AptBanner);
  if (!registry.get('apt-confirm')) registry.define('apt-confirm', AptConfirm);
  if (!registry.get('apt-more')) registry.define('apt-more', AptMore);
  if (!registry.get('apt-your-interface')) registry.define('apt-your-interface', AptYourInterface);
}

declare global {
  interface HTMLElementTagNameMap {
    'apt-ask': AptAsk;
    'apt-banner': AptBanner;
    'apt-confirm': AptConfirm;
    'apt-more': AptMore;
    'apt-your-interface': AptYourInterface;
  }
}
