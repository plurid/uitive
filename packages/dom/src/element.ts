import type { ClientLike } from './client-like.js';
import { base } from './styles.js';

/** Where there is no DOM, as during server rendering, the classes extend a stand-in. */
const Base: typeof HTMLElement =
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement ??
  (class {} as unknown as typeof HTMLElement);

/** How long a two-step button stays armed, in milliseconds. */
const ARMED_FOR = 4000;

type Trigger = 'click' | 'change' | 'submit';

/**
 * The lifecycle shared by Aptuitive's elements: subscribes to the client while connected,
 * renders into a shadow root only when what it shows changes, and keeps focus and typing
 * across renders. Interactive markup declares `data-act` (and `data-on` for `change` or
 * `submit`); `data-arg` carries a value to the handler.
 */
export abstract class AptElement<Client extends ClientLike = ClientLike> extends Base {
  static #fallback: ClientLike | undefined;
  static readonly #connected = new Set<AptElement<ClientLike>>();

  /**
   * The client every element uses when none is set on it, such as elements a framework renders
   * later. `startAptuitive` sets it.
   */
  static useClient(client: ClientLike | undefined): void {
    AptElement.#fallback = client;
    for (const element of AptElement.#connected) {
      if (element.#client !== undefined) continue;
      element.#detach();
      element.#attach();
      element.update(true);
    }
  }

  #client: Client | undefined;
  #unsubscribe: (() => void) | undefined;
  #release: (() => void) | undefined;
  #rendered: string | undefined;
  #armed: { key: string; until: number } | undefined;
  readonly #root: ShadowRoot;
  /** The element everything renders into. */
  protected readonly content: HTMLElement;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = base + this.styles();
    this.content = document.createElement('div');
    this.content.setAttribute('part', 'content');
    this.#root.append(style, this.content);
    for (const trigger of ['click', 'change', 'submit'] as const) {
      this.#root.addEventListener(trigger, (event) => this.#delegate(event, trigger));
    }
  }

  /** The client this element shows and acts on: its own, or the one every element uses. */
  get client(): Client | undefined {
    return this.#client ?? (AptElement.#fallback as Client | undefined);
  }

  set client(client: Client | undefined) {
    if (client === this.#client) return;
    this.#detach();
    this.#client = client;
    this.#attach();
    this.update(true);
  }

  connectedCallback(): void {
    AptElement.#connected.add(this as unknown as AptElement<ClientLike>);
    this.#attach();
    this.update(true);
  }

  disconnectedCallback(): void {
    AptElement.#connected.delete(this as unknown as AptElement<ClientLike>);
    this.#detach();
  }

  /** Called when the element starts showing a client; what it returns runs when it stops. */
  protected attached(_client: Client): (() => void) | void {}

  /** Extra CSS for this element. */
  protected styles(): string {
    return '';
  }

  /** Changes whenever what the element shows changes; renders are skipped otherwise. */
  protected abstract key(client: Client): string;

  /** The element's markup. Every interpolated value must go through `escape`. */
  protected abstract template(client: Client): string;

  /** Handles an interaction with an element that declares `data-act`. */
  protected abstract act(
    action: string,
    argument: string | undefined,
    target: HTMLElement,
  ): void | Promise<void>;

  /** Renders again if what the element shows changed, or always when forced. */
  protected update(force = false): void {
    const client = this.client;
    if (!client) {
      this.#rendered = undefined;
      this.content.replaceChildren();
      return;
    }
    const key = `${this.key(client)}|${this.#armed?.key ?? ''}`;
    if (!force && key === this.#rendered) return;
    this.#rendered = key;

    // Keep focus, typing and selection on the element with the same `data-key`.
    const active = this.#root.activeElement as HTMLElement | null;
    const focus = active?.dataset.key;
    const field = active as HTMLInputElement | null;
    const value = focus !== undefined && 'value' in (active ?? {}) ? field?.value : undefined;
    const selection = [field?.selectionStart ?? null, field?.selectionEnd ?? null] as const;
    this.content.innerHTML = this.template(client);
    if (focus === undefined) return;
    const next = this.content.querySelector<HTMLInputElement>(`[data-key="${focus}"]`);
    if (!next) return;
    if (value !== undefined) next.value = value;
    next.focus();
    if (selection[0] !== null && selection[1] !== null) {
      try {
        next.setSelectionRange(selection[0], selection[1]);
      } catch {
        // Not every focusable element has a text selection.
      }
    }
  }

  /** For two-step buttons: the first press arms, a second within a few seconds confirms. */
  protected confirm(key: string): boolean {
    if (this.armed(key)) {
      this.#armed = undefined;
      return true;
    }
    this.#armed = { key, until: Date.now() + ARMED_FOR };
    setTimeout(() => {
      if (this.#armed?.key === key && this.#armed.until <= Date.now()) {
        this.#armed = undefined;
        this.update(true);
      }
    }, ARMED_FOR + 50);
    this.update(true);
    return false;
  }

  /** Whether a two-step button is armed. */
  protected armed(key: string): boolean {
    return this.#armed?.key === key && this.#armed.until > Date.now();
  }

  /** Dispatches a bubbling event that crosses the shadow boundary, for hosts to listen to. */
  protected emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #attach(): void {
    const client = this.client;
    if (!client || this.#unsubscribe || !this.isConnected) return;
    this.#unsubscribe = client.subscribe(() => this.update());
    this.#release = this.attached(client) ?? undefined;
  }

  #detach(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#release?.();
    this.#release = undefined;
  }

  #delegate(event: Event, trigger: Trigger): void {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-act]');
    if (!target || !this.client || (target.dataset.on ?? 'click') !== trigger) return;
    if (trigger === 'submit') event.preventDefault();
    Promise.resolve(this.act(target.dataset.act ?? '', target.dataset.arg, target)).catch(
      (error: unknown) => this.emit('apt-error', { error }),
    );
  }
}
