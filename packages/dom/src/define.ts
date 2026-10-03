import { UitiveAsk } from './ask.js';
import { UitiveBanner } from './banner.js';
import { UitiveConfirm } from './confirm.js';
import { UitiveMore } from './more.js';
import { UitiveYourInterface } from './your-interface.js';

/**
 * Registers `<uitive-ask>`, `<uitive-banner>`, `<uitive-confirm>`, `<uitive-more>` and `<uitive-your-interface>`.
 * Safe to call more than once, and a no-op without a DOM, as during server rendering.
 */
export function defineElements(): void {
  const registry = (globalThis as { customElements?: CustomElementRegistry }).customElements;
  if (!registry) return;
  if (!registry.get('uitive-ask')) registry.define('uitive-ask', UitiveAsk);
  if (!registry.get('uitive-banner')) registry.define('uitive-banner', UitiveBanner);
  if (!registry.get('uitive-confirm')) registry.define('uitive-confirm', UitiveConfirm);
  if (!registry.get('uitive-more')) registry.define('uitive-more', UitiveMore);
  if (!registry.get('uitive-your-interface'))
    registry.define('uitive-your-interface', UitiveYourInterface);
}

declare global {
  interface HTMLElementTagNameMap {
    'uitive-ask': UitiveAsk;
    'uitive-banner': UitiveBanner;
    'uitive-confirm': UitiveConfirm;
    'uitive-more': UitiveMore;
    'uitive-your-interface': UitiveYourInterface;
  }
}
