import { z } from 'zod';
import type { AnyContract, AnyPageSpec, BlockSpec, PropsOf } from './contract.js';
import {
  checkGeneric,
  genericBlocks,
  genericFor,
  GenericProblem,
  type GenericName,
} from './generic.js';
import { TEXT_LENGTH, TITLE_LENGTH } from './limits.js';
import { checkQuery, type Query } from './query.js';

/** Every layout a section may have. */
export const LAYOUTS = ['stack', 'grid', 'columns'] as const;
/** How a section arranges its children: one under another, in a responsive grid, or side by side. */
export type Layout = (typeof LAYOUTS)[number];

export { TEXT_LENGTH, TITLE_LENGTH } from './limits.js';

/** Element IDs are free text a planner writes, so only their shape is fixed. */
export const ELEMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
/** Data names are referenced from props. */
export const DATA_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;

/** Elements a page may hold, unless its spec says otherwise. */
export const MAX_ELEMENTS = 40;
/** How deeply a page's sections may nest, unless its spec says otherwise. */
export const MAX_DEPTH = 4;
/** Queries a page may run, unless its spec says otherwise. */
export const MAX_QUERIES = 8;

/** A section's props: a title, and how its children are laid out. */
export interface SectionProps {
  /** May be empty. */
  title: string;
  /** How its children are arranged. */
  layout: Layout;
}

/** Tabs' props: a title for the set. Each tab is a section, titled by its own title. */
export interface TabsProps {
  /** The tabs' accessible name. */
  title: string;
}

/** A region's props: which of the contract's regions it embeds. */
export interface RegionProps {
  /** One of the contract's regions. */
  name: string;
}

/** Blocks every page has: sections and tabs arrange other elements; regions embed what exists. */
export const BUILT_IN = ['section', 'tabs', 'region'] as const;
/** The name of a block every page has. */
export type BuiltIn = (typeof BUILT_IN)[number];

/** The blocks every page has, as block specs. */
export const builtInBlocks: Readonly<Record<BuiltIn, BlockSpec>> = {
  section: {
    label: 'Section',
    description:
      'Groups its children under a title that may be empty: one under another, in a grid or side by side',
    props: z.object({ title: z.string(), layout: z.enum(LAYOUTS) }),
  },
  tabs: {
    label: 'Tabs',
    description: 'Shows one of its sections at a time, picked by the section titles',
    props: z.object({ title: z.string() }),
  },
  region: {
    label: 'Region',
    description: 'Part of the application as it already is, such as the original page',
    props: z.object({ name: z.string() }),
  },
};

/** Elements that may hold children. */
const CONTAINERS: readonly string[] = ['section', 'tabs'];

/** One placed block. Only sections and tabs have children. */
export interface Element<K extends string = string, P = unknown> {
  /** Its ID within the page. */
  id: string;
  /** The block it places. */
  block: K;
  /** The block's props. */
  props: P;
  /** The IDs of the elements inside it, in order. */
  children: readonly string[];
}

/** An element of a block every page has, with its props typed. */
export type BuiltInElement =
  Element<'section', SectionProps> | Element<'tabs', TabsProps> | Element<'region', RegionProps>;

/** Any element a page built from these blocks can hold, with its props typed. */
export type ElementOf<B extends Record<string, BlockSpec>> =
  | BuiltInElement
  | { [K in Extract<keyof B, string>]: Element<K, PropsOf<B[K]>> }[Extract<keyof B, string>];

/** A named query whose result blocks show; several blocks may share one. */
export interface NamedQuery {
  /** Its name, which blocks use in their `data` prop. */
  name: string;
  /** The query. */
  query: Query;
}

/** Any page, with its props unknown: what generic code works with. */
export interface AnyPage {
  /** The ID of the outermost element, usually a section. */
  root: string;
  /** Every element, the root included. */
  elements: readonly Element[];
  /** The queries its blocks show. */
  data: readonly NamedQuery[];
}

/**
 * A whole page, flat: elements keyed by ID, each listing its children. Nesting goes as deep as
 * the page allows while the planner schema stays free of recursion and of maps.
 */
export interface PageValue<
  B extends Record<string, BlockSpec> = Record<string, BlockSpec>,
> extends AnyPage {
  /** Every element, the root included, with its props typed. */
  elements: readonly ElementOf<B>[];
}

/** The first page format: sections of blocks, two levels. Still accepted, and converted. */
export interface SectionsPage {
  /** The page's sections, each with its blocks. */
  sections: readonly {
    title: string;
    layout: Layout;
    blocks: readonly { block: string; props: unknown }[];
  }[];
}

/** Converts a page of sections into the flat format: a root section holding one per section. */
export function fromSections(page: SectionsPage): PageValue {
  const elements: Element[] = [
    {
      id: 'page',
      block: 'section',
      props: { title: '', layout: 'stack' },
      children: page.sections.map((_, index) => `s${index + 1}`),
    },
  ];
  page.sections.forEach((section, index) => {
    const id = `s${index + 1}`;
    elements.push({
      id,
      block: 'section',
      props: { title: section.title, layout: section.layout },
      children: section.blocks.map((_, at) => `${id}b${at + 1}`),
    });
    section.blocks.forEach((placed, at) => {
      elements.push({
        id: `${id}b${at + 1}`,
        block: placed.block,
        props: placed.props,
        children: [],
      });
    });
  });
  return { root: 'page', elements, data: [] };
}

/** A page in the flat format, whichever format it came in. */
export function toPage(value: unknown): unknown {
  const sections = (value as { sections?: unknown } | null | undefined)?.sections;
  return Array.isArray(sections) ? fromSections(value as SectionsPage) : value;
}

/** A page written as a tree, for standard pages in code. */
export interface Node {
  /** The block it places. */
  block: string;
  /** The block's props. */
  props: unknown;
  /** For sections and tabs: what is inside, in order. */
  children?: readonly Node[];
  /** Its ID within the page. @default the block's name and a number */
  id?: string;
}

/** Builds pages as trees and flattens them: `ui.page(ui.section('', 'stack', [ui.region('main')]))`. */
export const ui = {
  /** A section: a title, which may be empty, a layout and its children. */
  section: (title: string, layout: Layout, children: readonly Node[], id?: string): Node => ({
    block: 'section',
    props: { title, layout },
    children,
    ...(id === undefined ? {} : { id }),
  }),
  /** Tabs: one section shown at a time, picked by the sections' titles. */
  tabs: (title: string, children: readonly Node[], id?: string): Node => ({
    block: 'tabs',
    props: { title },
    children,
    ...(id === undefined ? {} : { id }),
  }),
  /** One of the contract's regions: part of the application as it is. */
  region: (name: string, id?: string): Node => ({
    block: 'region',
    props: { name },
    ...(id === undefined ? {} : { id }),
  }),
  /** A block, generic or the application's own, with its props. */
  block: (name: string, props: unknown = {}, id?: string): Node => ({
    block: name,
    props,
    ...(id === undefined ? {} : { id }),
  }),
  /** The page: its root element, flattened, and the named queries its blocks show. */
  page: (root: Node, data: readonly NamedQuery[] = []): PageValue => {
    const elements: Element[] = [];
    const counts = new Map<string, number>();
    const visit = (node: Node): string => {
      const count = (counts.get(node.block) ?? 0) + 1;
      counts.set(node.block, count);
      const id = node.id ?? `${node.block}-${count}`;
      const element: { id: string; block: string; props: unknown; children: string[] } = {
        id,
        block: node.block,
        props: node.props,
        children: [],
      };
      elements.push(element);
      element.children = (node.children ?? []).map(visit);
      return id;
    };
    return { root: visit(root), elements, data };
  },
};

/** Why a page was rejected: an unknown name, a broken rule, or something only the user may do. */
export class PageProblem extends Error {
  constructor(
    readonly rule: 'unknown' | 'validator' | 'kind',
    message: string,
  ) {
    super(message);
  }
}

const problem = (rule: 'unknown' | 'validator' | 'kind', message: string): never => {
  throw new PageProblem(rule, message);
};

/**
 * What the user's own pages may hold: built-in and generic blocks, and regions about nothing in
 * particular. Their own validation, like any page's.
 */
export function userPageSpec(): AnyPageSpec {
  return {
    kind: 'page',
    label: 'Your page',
    description: 'A page you made',
    blocks: {},
    generic: true,
    standard: () => ({ root: 'page', elements: [], data: [] }),
  };
}

/** Where a user's page lives in the application. */
export const USER_PAGE_PATH = '/apt/:slug';

/** Where one of the user's pages lives. */
export const userPagePath = (slug: string) => `/apt/${encodeURIComponent(slug)}`;

/** The regions a page may embed: those about nothing in particular, or about its entity. */
export function regionsFor(contract: AnyContract, spec: AnyPageSpec): string[] {
  return Object.entries(contract.regions)
    .filter(([, region]) => region.entity === undefined || region.entity === spec.entity)
    .map(([name]) => name);
}

/** How a page is validated: as the person's own, or as a planner's unasked suggestion. */
export interface ValidateOptions {
  /** A planner placed the page, unasked: no destructive actions, no filled-in writes. */
  planned?: boolean;
}

/**
 * Validates a whole page against its blocks, queries, regions and limits, and returns it in
 * canonical form: canonical names, a single tree from the root, elements in tree order.
 */
export function validatePage(
  contract: AnyContract,
  spec: AnyPageSpec,
  raw: unknown,
  context?: string,
  options: ValidateOptions = {},
): PageValue {
  const value = toPage(raw) as { root?: unknown; elements?: unknown; data?: unknown } | undefined;
  const maxElements = spec.maxElements ?? MAX_ELEMENTS;
  const maxDepth = spec.maxDepth ?? MAX_DEPTH;
  const maxQueries = spec.maxQueries ?? MAX_QUERIES;
  const list = value?.elements;
  if (!Array.isArray(list) || list.length === 0) problem('validator', 'A page needs an element');
  const elements = list as unknown[];
  if (elements.length > maxElements) problem('validator', `At most ${maxElements} elements`);

  // Queries first: blocks refer to them by name.
  const rawData = Array.isArray(value?.data) ? (value.data as unknown[]) : [];
  if (rawData.length > maxQueries) problem('validator', `At most ${maxQueries} queries a page`);
  const queries = new Map<string, Query>();
  for (const entry of rawData) {
    const raw = (entry ?? {}) as { name?: unknown; query?: unknown };
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!DATA_PATTERN.test(name)) {
      problem('validator', `Query names are short words, not "${String(raw.name)}"`);
    }
    if (queries.has(name)) problem('validator', `Two queries are called "${name}"`);
    const checked = checkQuery(
      contract,
      raw.query,
      spec.entity === undefined ? {} : { entity: spec.entity },
    );
    if (!checked.ok) problem('validator', `${name}: ${checked.problem}`);
    queries.set(name, (checked as { ok: true; query: Query }).query);
  }

  const regions = regionsFor(contract, spec);
  const generic = new Set<string>(genericFor(contract, spec));
  const names = new Map<string, string>();
  for (const name of [...BUILT_IN, ...Object.keys(spec.blocks), ...generic]) {
    if (name === 'region' && regions.length === 0) continue;
    names.set(name.toLowerCase(), name);
  }
  const toRegion = new Map(regions.map((name) => [name.toLowerCase(), name]));
  const scope = context === '*' ? undefined : context;
  const used = new Set<string>();

  const byId = new Map<string, Element>();
  for (const entry of elements) {
    const raw = (entry ?? {}) as {
      id?: unknown;
      block?: unknown;
      props?: unknown;
      children?: unknown;
    };
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!ELEMENT_PATTERN.test(id)) {
      problem('validator', `Element IDs are short words, not "${String(raw.id)}"`);
    }
    if (byId.has(id)) problem('validator', `Two elements are called "${id}"`);
    const name =
      names.get(String(raw.block ?? '').toLowerCase()) ??
      problem('unknown', `No block "${String(raw.block)}"`);
    const native = spec.blocks[name] as BlockSpec | undefined;
    const block =
      (builtInBlocks as Record<string, BlockSpec>)[name] ??
      native ??
      (genericBlocks as Record<string, BlockSpec>)[name];
    const parsed = (block as BlockSpec).props.safeParse(raw.props);
    if (!parsed.success) {
      problem('validator', `${block?.label}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    }
    let props = parsed.data as Record<string, unknown>;
    if (name === 'section' || name === 'tabs') {
      const title = String(props.title ?? '').trim();
      if (title.length > TITLE_LENGTH) {
        problem('validator', `Titles stay under ${TITLE_LENGTH} characters`);
      }
      props = { ...props, title };
    } else if (name === 'region') {
      const region =
        toRegion.get(String(props.name ?? '').toLowerCase()) ??
        problem('unknown', `No region "${String(props.name)}" on this page`);
      props = { name: region };
    } else if (native) {
      if (longest(props) > TEXT_LENGTH) problem('validator', `${native.label}: text is too long`);
      const issue = native.validate?.(props, scope);
      if (issue !== undefined) problem('validator', `${native.label}: ${issue}`);
    } else {
      try {
        props = checkGeneric(name as GenericName, props, {
          contract,
          spec,
          data: queries,
          used,
          planned: options.planned ?? false,
        }) as Record<string, unknown>;
      } catch (error) {
        if (error instanceof GenericProblem) problem(error.rule, error.message);
        throw error;
      }
    }
    const children = Array.isArray(raw.children)
      ? raw.children.map((child) => String(child).trim())
      : [];
    if (children.length > 0 && !CONTAINERS.includes(name)) {
      problem('validator', `${block?.label} can't hold other elements`);
    }
    byId.set(id, { id, block: name, props, children });
  }

  const unused = [...queries.keys()].find((name) => !used.has(name));
  if (unused !== undefined) problem('validator', `Nothing shows the query "${unused}"`);

  const root = typeof value?.root === 'string' ? value.root.trim() : '';
  if (!byId.has(root)) problem('validator', `The root "${root}" is not an element`);
  const parents = new Map<string, string>();
  for (const element of byId.values()) {
    for (const child of element.children) {
      if (!byId.has(child)) {
        problem('validator', `${element.id} holds "${child}", which is not an element`);
      }
      if (child === root) problem('validator', 'Nothing can hold the root');
      if (parents.has(child)) problem('validator', `"${child}" has two places on the page`);
      parents.set(child, element.id);
      if (element.block === 'tabs' && byId.get(child)?.block !== 'section') {
        problem('validator', 'Tabs hold sections, one per tab');
      }
    }
  }

  const ordered: Element[] = [];
  const visit = (id: string, depth: number) => {
    if (depth > maxDepth) problem('validator', `Pages nest at most ${maxDepth} levels deep`);
    const element = byId.get(id) as Element;
    ordered.push(element);
    for (const child of element.children) visit(child, depth + 1);
  };
  visit(root, 1);
  if (ordered.length !== byId.size) {
    const lost = [...byId.keys()].find((id) => !ordered.some((element) => element.id === id));
    problem('validator', `"${lost}" is not on the page`);
  }

  return {
    root,
    elements: ordered,
    data: [...queries].map(([name, query]) => ({ name, query })),
  };
}

/** The elements of a page in tree order, with each one's depth. */
export function walk(page: PageValue): { element: Element; depth: number }[] {
  const byId = new Map(page.elements.map((element) => [element.id, element as Element]));
  const out: { element: Element; depth: number }[] = [];
  const visit = (id: string, depth: number) => {
    const element = byId.get(id);
    if (!element || out.some((entry) => entry.element.id === id)) return;
    out.push({ element, depth });
    for (const child of element.children) visit(child, depth + 1);
  };
  visit(page.root, 1);
  return out;
}

export function longest(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return Math.max(0, ...value.map(longest));
  if (value !== null && typeof value === 'object') {
    return Math.max(0, ...Object.values(value).map(longest));
  }
  return 0;
}
