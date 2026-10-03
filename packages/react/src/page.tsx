'use client';
import {
  Fragment,
  useContext,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  GENERIC,
  type AnyPage,
  type BlockSpec,
  type Element,
  type PropsOf,
  type RegionProps,
  type SectionProps,
  type TabsProps,
} from '@plurid/uitive-core';
import { GenericBlock } from './generic.js';
import { defaultKit } from './kit.js';
import { UitiveContext } from './provider.js';

/** Props every block component receives: its own typed props, and the page's context value. */
export interface BlockProps<P> {
  /** The block's props, checked against its schema. */
  props: P;
  /** The page's context value, such as the service shown. */
  context: string | undefined;
}

/** One component per block of a page; the types come from the contract's block schemas. */
export type BlockComponents<B extends Record<string, BlockSpec>> = {
  [K in Extract<keyof B, string>]: ComponentType<BlockProps<PropsOf<B[K]>>>;
};

/** Components for the contract's regions: parts of the application as it already is. */
export type RegionComponents = Readonly<
  Record<string, ComponentType<{ context: string | undefined }>>
>;

/**
 * What `Page` takes: the page to draw, the components for the application's blocks and regions, and
 * the row it is about.
 */
export interface PageProps<B extends Record<string, BlockSpec>> {
  /** The page, usually from `useSurface`. */
  value: AnyPage;
  /** A component for each of the application's own blocks; generic blocks need none. */
  blocks: BlockComponents<B>;
  /** What each region shows, such as the page as it was before Uitive. */
  regions?: RegionComponents;
  /** The page's context value, such as the service shown. */
  context?: string;
  /** The key of the row the page is about. @default the row the location is about */
  current?: string;
  /** The class of the page's wrapper. @default 'uitive-page' */
  className?: string;
}

const silent = () => () => {};
const generic: readonly string[] = GENERIC;

/**
 * Renders a page, standard or redesigned, with the application's own components. Sections,
 * tabs and blocks carry `data-layout`, `data-block` and `data-element` attributes for styling.
 */
export function Page<B extends Record<string, BlockSpec>>({
  value,
  blocks,
  regions = {},
  context,
  current,
  className,
}: PageProps<B>) {
  const scope = useContext(UitiveContext);
  const location = useSyncExternalStore(
    scope ? scope.client.subscribe : silent,
    () => scope?.client.getSnapshot().location,
    () => undefined,
  );
  const row = current ?? location?.entity?.key;
  const kit = scope?.kit ?? defaultKit;
  const byId = new Map(value.elements.map((element) => [element.id, element as Element]));
  const root = byId.get(value.root);
  if (!root) return null;

  const leaf = (element: Element): ReactNode => {
    if (element.block === 'region') {
      const Region = regions[(element.props as RegionProps).name];
      return Region ? <Region context={context} /> : null;
    }
    const Block = (blocks as Record<string, ComponentType<BlockProps<unknown>>>)[element.block];
    if (Block) return <Block props={element.props} context={context} />;
    if (!generic.includes(element.block)) return null;
    return scope ? (
      <GenericBlock
        element={element}
        page={value}
        {...(row === undefined ? {} : { current: row })}
      />
    ) : (
      <kit.Status state="error" message="Wrap the page in <UitiveProvider> to show its data" />
    );
  };

  const node = (element: Element, depth: number): ReactNode => {
    if (element.block === 'section') {
      const props = element.props as SectionProps;
      return (
        <kit.Section
          title={props.title}
          layout={props.layout}
          depth={depth}
          count={element.children.length}
        >
          {element.children.map((id) => wrapped(id, depth + 1))}
        </kit.Section>
      );
    }
    if (element.block === 'tabs') {
      const sections = element.children
        .map((id) => byId.get(id))
        .filter((entry): entry is Element => entry?.block === 'section');
      return (
        <kit.Tabs
          label={(element.props as TabsProps).title}
          tabs={sections.map((section) => ({
            id: section.id,
            title: (section.props as SectionProps).title || section.id,
            content: node(section, depth + 1),
          }))}
        />
      );
    }
    return leaf(element);
  };

  const wrapped = (id: string, depth: number): ReactNode => {
    const element = byId.get(id);
    if (!element) return null;
    return (
      <div key={id} className="uitive-block" data-block={element.block} data-element={id}>
        {node(element, depth)}
      </div>
    );
  };

  // A page that is one region is the application as it is: no wrapper may change its layout.
  if (root.block === 'region') return <>{node(root, 1)}</>;

  // A root section is the page itself: its sections sit directly in the page.
  if (root.block === 'section') {
    const props = root.props as SectionProps;
    return (
      <div className={className ?? 'uitive-page'} data-layout={props.layout}>
        {props.title && <kit.Title>{props.title}</kit.Title>}
        {root.children.map((id) => {
          const element = byId.get(id);
          if (!element) return null;
          return element.block === 'section' || element.block === 'tabs' ? (
            <Fragment key={id}>{node(element, 2)}</Fragment>
          ) : (
            wrapped(id, 2)
          );
        })}
      </div>
    );
  }
  return <div className={className ?? 'uitive-page'}>{node(root, 1)}</div>;
}
