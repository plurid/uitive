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
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { AnyContract, Uitive, Confirmation, Persona } from '@plurid/uitive-core';
import { defineElements } from '@plurid/uitive-dom';
import { defineDebugElement } from '@plurid/uitive-dom/debug';
import { useConfirmation, useLifecycle } from './hooks.js';
import { defaultKit, kitStyles, type Kit } from './kit.js';

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
  children,
}: ProviderProps<C>) {
  useLifecycle(client);
  const value = useMemo(() => ({ client: client as unknown as Uitive, kit }), [client, kit]);
  return (
    <UitiveContext.Provider value={value}>
      {(styles ?? true) && <style>{kitStyles}</style>}
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
 * Asks the user before a generated interface changes data: the action, what it will do it to,
 * and for destructive actions the phrase to type. Mount it once, inside the provider; without
 * it, generated interfaces can't write at all.
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
  return (
    <kit.Dialog title={confirmation.label} onClose={cancel}>
      <kit.Text>{confirmation.description}</kit.Text>
      {confirmation.fields.length > 0 && (
        <dl className="uitive-params">
          {confirmation.fields.map((field) => (
            <div key={field.name} style={{ display: 'contents' }}>
              <dt>{field.label}</dt>
              <dd>
                <kit.Value field={field} value={confirmation.params[field.name]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
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
          tone={confirmation.effect === 'destructive' ? 'danger' : 'primary'}
          disabled={!matches}
          onClick={() => confirm(phrase)}
        >
          {confirmation.label}
        </kit.Button>
      </div>
    </kit.Dialog>
  );
}

/** What the meta-interface wrappers take: HTML attributes, and the client the element shows. */
export type ElementProps = HTMLAttributes<HTMLElement> & { client: unknown };

/**
 * A custom element that takes its client as a property. React 18 sets attributes on custom
 * elements, not properties, so the property is set here, which works in React 19 too.
 */
function wrapper<P extends ElementProps>(
  tag: string,
  properties: readonly (keyof P)[],
  define: () => void,
): (props: P) => ReactElement {
  return function Element(props: P) {
    const ref = useRef<HTMLElement & Record<string, unknown>>(null);
    const rest = { ...props } as Record<string, unknown>;
    for (const name of properties) delete rest[name as string];
    useLayoutEffect(() => {
      // Registered on first use, before any property is set, so the element's own setters run.
      define();
      const node = ref.current;
      if (!node) return;
      for (const name of properties) node[name as string] = props[name];
    });
    return createElement(tag, { ...rest, ref });
  };
}

/**
 * `<uitive-banner>`: what just changed and why, with Revert and Keep. It floats at the bottom right;
 * `docked` puts it in the page's flow.
 */
export const UitiveBanner = wrapper<ElementProps & { docked?: boolean }>(
  'uitive-banner',
  ['client'],
  defineElements,
);
/** `<uitive-your-interface>`: the user's definition, readable and revertible. */
export const UitiveYourInterface = wrapper<ElementProps>(
  'uitive-your-interface',
  ['client'],
  defineElements,
);
/** `<uitive-debug>`: the developer panel. */
export const UitiveDebug = wrapper<ElementProps & { personas?: readonly Persona[] }>(
  'uitive-debug',
  ['client', 'personas'],
  defineDebugElement,
);
