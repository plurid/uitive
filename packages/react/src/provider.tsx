'use client';
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { AnyContract, Uitive, Confirmation, Field, Persona } from '@plurid/uitive-core';
import { defineElements } from '@plurid/uitive-dom';
import { defineDebugElement } from '@plurid/uitive-dom/debug';
import { useConfirmation, useLifecycle } from './hooks.js';
import { defaultKit, kitStyles, type Kit } from './kit.js';
import { currencyOf } from './params.js';

/** What the provider shares below it: the client, and the kit generic blocks draw with. */
export interface UitiveContextValue {
  /** The client pages, hooks and confirmations use. */
  client: Uitive;
  /** The kit generic blocks draw with. */
  kit: Kit;
}

/** The provider's context; `useUitive` reads it. */
export const UitiveContext = createContext<UitiveContextValue | undefined>(undefined);

/** What `UitiveProvider` takes: the client, and the kit generic blocks draw with. */
export interface ProviderProps<C extends AnyContract> {
  /** The client from `createUitive`. */
  client: Uitive<C>;
  /** What generic blocks are drawn with. @default defaultKit */
  kit?: Kit;
  /** Adds the default kit's styles, which kits built with `createKit` still use. @default true */
  styles?: boolean;
  /**
   * The nonce of a `style-src` Content Security Policy, for the kit's styles, when the page allows
   * no inline styles without one.
   */
  nonce?: string;
  /** The application. */
  children?: ReactNode;
}

/**
 * Makes a client and a kit available to pages, generic blocks and confirmations below it, and
 * connects the page's lifecycle (see `useLifecycle`).
 */
export function UitiveProvider<C extends AnyContract>({
  client,
  kit = defaultKit,
  styles,
  nonce,
  children,
}: ProviderProps<C>) {
  useLifecycle(client);
  const value = useMemo(() => ({ client: client as unknown as Uitive, kit }), [client, kit]);
  return (
    <UitiveContext.Provider value={value}>
      {(styles ?? true) && <style nonce={nonce}>{kitStyles}</style>}
      {children}
    </UitiveContext.Provider>
  );
}

/** The client and kit from the nearest provider. */
export function useUitive(): UitiveContextValue {
  const found = useContext(UitiveContext);
  if (!found) throw new Error('Wrap this in <UitiveProvider client={...}>');
  return found;
}

/**
 * Asks the user before a generated interface changes data: the action, every param it will run
 * with, and for destructive actions the phrase to type. Mount it once, inside the provider.
 * Buttons and destructive runs wait for it, and are refused without it; a generated form that
 * shows every value it will send counts as the yes.
 */
export function Confirmations() {
  const { client, kit } = useUitive();
  const { confirmation, confirm, cancel } = useConfirmation(client);
  useEffect(() => client.confirmations(), [client]);
  if (!confirmation) return null;
  // Keyed by the run, so the phrase typed for one never carries over to the next.
  return (
    <ConfirmDialog
      key={confirmation.id}
      kit={kit}
      confirmation={confirmation}
      confirm={confirm}
      cancel={cancel}
    />
  );
}

function ConfirmDialog({
  kit,
  confirmation,
  confirm,
  cancel,
}: {
  kit: Kit;
  confirmation: Confirmation;
  confirm: (phrase?: string) => boolean;
  cancel: () => void;
}) {
  const [phrase, setPhrase] = useState('');
  const expected = confirmation.phrase;
  const matches =
    expected === undefined ||
    phrase.trim().replace(/\s+/g, ' ').toLowerCase() ===
      expected.trim().replace(/\s+/g, ' ').toLowerCase();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (matches) confirm(phrase);
  };
  return (
    <kit.Dialog title={confirmation.label} onClose={cancel}>
      <form className="uitive-stack" onSubmit={submit}>
        <kit.Text>{confirmation.description}</kit.Text>
        <Params kit={kit} fields={confirmation.fields} params={confirmation.params} />
        {expected !== undefined && (
          <kit.Field
            field={{
              name: 'phrase',
              type: 'text',
              label: `Type "${expected}" to confirm`,
              description: '',
              nullable: false,
              values: [],
              minor: false,
            }}
            value={phrase}
            onChange={setPhrase}
            required
          />
        )}
        <div className="uitive-dialog-actions">
          <kit.Button onClick={cancel}>Cancel</kit.Button>
          <kit.Button
            type="submit"
            tone={confirmation.effect === 'destructive' ? 'danger' : 'primary'}
            disabled={!matches}
          >
            {confirmation.label}
          </kit.Button>
        </div>
      </form>
    </kit.Dialog>
  );
}

/** What a run will use, each value as its field shows it, money in its own currency. */
export function Params({
  kit,
  fields,
  params,
}: {
  kit: Kit;
  fields: readonly Field[];
  params: Readonly<Record<string, unknown>>;
}) {
  if (fields.length === 0) return null;
  return (
    <dl className="uitive-params">
      {fields.map((field) => {
        const currency = currencyOf(field, params);
        return (
          <div key={field.name}>
            <dt>{field.label}</dt>
            <dd>
              <kit.Value
                field={field}
                value={params[field.name]}
                {...(currency === undefined ? {} : { currency })}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** What the meta-interface wrappers take: HTML attributes, and the client the element shows. */
export type ElementProps = HTMLAttributes<HTMLElement> & { client: unknown };

/** A layout effect in the browser; on the server, where layout effects warn, a plain one. */
const useBrowserLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A custom element that takes its client as a property. React 18 sets every prop on a custom
 * element as an attribute: `docked={false}` would still match `[docked]`, and `className` would
 * become `classname`. So properties, flags and the class are set here, as React 19 would.
 */
function wrapper<P extends ElementProps>(
  tag: string,
  properties: readonly (keyof P)[],
  flags: readonly (keyof P)[],
  define: () => void,
): (props: P) => ReactElement {
  return function Element(props: P) {
    const ref = useRef<HTMLElement & Record<string, unknown>>(null);
    const rest = { ...props } as Record<string, unknown>;
    for (const name of [...properties, ...flags, 'className']) delete rest[name as string];
    useBrowserLayoutEffect(() => {
      // Registered on first use, before any property is set, so the element's own setters run.
      define();
      const node = ref.current;
      if (!node) return;
      for (const name of properties) node[name as string] = props[name];
      for (const name of flags) node.toggleAttribute(name as string, Boolean(props[name]));
      if (props.className) node.setAttribute('class', props.className);
      else node.removeAttribute('class');
    });
    return createElement(tag, { ...rest, ref });
  };
}

/**
 * `<uitive-banner>`: what just changed and why, with Revert and Keep. It floats at the bottom right;
 * `docked` puts it in the page's flow.
 */
export const UitiveBanner = /* @__PURE__ */ wrapper<ElementProps & { docked?: boolean }>(
  'uitive-banner',
  ['client'],
  ['docked'],
  defineElements,
);
/** `<uitive-your-interface>`: the user's definition, readable and revertible. */
export const UitiveYourInterface = /* @__PURE__ */ wrapper<ElementProps>(
  'uitive-your-interface',
  ['client'],
  [],
  defineElements,
);
/**
 * `<uitive-debug>`: the developer panel. `collapsed` starts it folded. Bundlers leave it out of
 * builds that never render it.
 */
export const UitiveDebug = /* @__PURE__ */ wrapper<
  ElementProps & { personas?: readonly Persona[]; collapsed?: boolean }
>('uitive-debug', ['client', 'personas'], ['collapsed'], defineDebugElement);
