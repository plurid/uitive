import { humanize, terms } from '@plurid/uitive-core';
import type { AnyContract } from '@plurid/uitive-core';
import type { RoleNode } from './aria.js';
import { textOf, walk } from './aria.js';

const LANDMARKS = new Set([
  'banner',
  'navigation',
  'main',
  'complementary',
  'contentinfo',
  'region',
  'search',
  'form',
]);

/**
 * What one page offers, read from its accessibility tree: its title, landmarks, headings, buttons,
 * links, tables, toolbars, navigation and menu triggers. Structure only, never rows.
 */
export interface PageFacts {
  /** The page's URL. */
  url: string;
  /** Its path, without origin, query or fragment. */
  path: string;
  /** The page's main heading. */
  title: string;
  /** Its landmarks, such as the main region and named navigation. */
  landmarks: { role: string; name: string }[];
  /** Its headings, with their levels. */
  headings: { level: number; text: string }[];
  /** Buttons outside navigation, tables, toolbars and dialogs; `opens` for menu triggers. */
  buttons: { name: string; landmark: string; opens?: boolean }[];
  /** Its links, with where they go and the landmark they sit in. */
  links: { name: string; url: string; landmark: string }[];
  /** Its tables: their columns and the buttons on each row, never the rows. */
  tables: { name: string; columns: string[]; rowActions: string[] }[];
  /** Explicit toolbars, and runs of three or more buttons side by side. */
  toolbars: { name: string; landmark: string; items: string[] }[];
  /** Its navigation, with each item's name and where it goes. */
  navigation: { name: string; items: { name: string; url?: string }[] }[];
}

/** The path of a URL, without origin, query or fragment. */
export const pathOf = (url: string) =>
  url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0] || '/';

const landmarkOf = (ancestors: readonly RoleNode[]) => {
  const found = [...ancestors].reverse().find((node) => LANDMARKS.has(node.role));
  return found ? `${found.role}${found.name ? ` "${found.name}"` : ''}` : 'page';
};

const named = (node: RoleNode) =>
  (node.role === 'button' || node.role === 'link') && textOf(node) !== '';

/** Keyboard hints that follow a name, such as "Search ⌘K" or "Accessibility F4". */
const SHORTCUT =
  /\s+(?:(?:[\u2318\u2325\u21e7\u2303]|(?:ctrl|cmd|alt|shift|option|meta)\s*\+)\s*)+\S{1,3}$|\s+F\d{1,2}$/i;

/** A control's name without its keyboard hint. */
export const cleanName = (name: string) => name.replace(SHORTCUT, '').trim();

const unique = (names: readonly string[]) => [...new Set(names.map(cleanName).filter(Boolean))];

const inDialog = (ancestors: readonly RoleNode[]) =>
  ancestors.some((node) => node.role === 'dialog' || node.role === 'alertdialog');

/** What a page offers, read from its accessibility tree. Structure only: rows are never read. */
export function factsOf(tree: readonly RoleNode[], url: string): PageFacts {
  const facts: PageFacts = {
    url,
    path: pathOf(url),
    title: '',
    landmarks: [],
    headings: [],
    buttons: [],
    links: [],
    tables: [],
    toolbars: [],
    navigation: [],
  };
  const claimed = new Set<RoleNode>();
  for (const { node, ancestors } of walk(tree)) {
    if (LANDMARKS.has(node.role)) facts.landmarks.push({ role: node.role, name: node.name });
    if (node.role === 'heading') {
      const level = Number(node.attributes.level ?? 2);
      const text = textOf(node);
      facts.headings.push({ level, text });
      if (level === 1 && facts.title === '') facts.title = text;
    }
    if (node.role === 'navigation') {
      const seen = new Set<string>();
      const items = [...walk(node.children)]
        .map((entry) => entry.node)
        .filter(named)
        .flatMap((item) => {
          claimed.add(item);
          const name = cleanName(textOf(item));
          if (name === '' || seen.has(name)) return [];
          seen.add(name);
          return [{ name, ...(item.properties.url ? { url: item.properties.url } : {}) }];
        });
      if (items.length > 0) facts.navigation.push({ name: node.name, items });
    }
    if (node.role === 'table' || node.role === 'grid') {
      const entries = [...walk(node.children)];
      const inside = entries.map((entry) => entry.node);
      const actions = new Set<string>();
      for (const { node: item, ancestors: above } of entries) {
        if (item.role !== 'button') continue;
        claimed.add(item);
        // Buttons in column headers sort the table; they aren't actions on its rows.
        if (!above.some((entry) => entry.role === 'columnheader'))
          actions.add(cleanName(textOf(item)));
      }
      facts.tables.push({
        name: node.name,
        columns: inside.filter((entry) => entry.role === 'columnheader').map(textOf),
        rowActions: [...actions].filter(Boolean),
      });
    }
    if (node.role === 'toolbar') {
      const items = unique(
        [...walk(node.children)]
          .map((entry) => entry.node)
          .filter(named)
          .map((item) => {
            claimed.add(item);
            return textOf(item);
          }),
      );
      facts.toolbars.push({ name: node.name, landmark: landmarkOf(ancestors), items });
    }
  }
  // Three or more buttons side by side read as a toolbar; a dialog's buttons are a passing flow.
  for (const { node, ancestors } of walk(tree)) {
    if (inDialog([...ancestors, node])) continue;
    let run: RoleNode[] = [];
    const flush = () => {
      if (run.length >= 3) {
        for (const item of run) claimed.add(item);
        facts.toolbars.push({
          name: '',
          landmark: landmarkOf([...ancestors, node]),
          items: unique(run.map(textOf)),
        });
      }
      run = [];
    };
    for (const child of node.children) {
      if (child.role === 'button' && !claimed.has(child) && textOf(child) !== '') run.push(child);
      else flush();
    }
    flush();
  }
  for (const { node, ancestors } of walk(tree)) {
    if (claimed.has(node) || inDialog(ancestors)) continue;
    if (node.role === 'button' && textOf(node) !== '') {
      facts.buttons.push({
        name: cleanName(textOf(node)),
        landmark: landmarkOf(ancestors),
        // An expandable button opens a menu or a panel: what it opens is the part to adapt.
        ...(node.attributes.expanded === undefined ? {} : { opens: true }),
      });
    } else if (node.role === 'link' && node.properties.url) {
      facts.links.push({
        name: textOf(node),
        url: node.properties.url,
        landmark: landmarkOf(ancestors),
      });
    }
  }
  return facts;
}

/** Path segments that are row keys rather than places: numbers, UUIDs, ULIDs, `ord_01H...`. */
const PATTERN =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26}|[a-z]{1,10}_[0-9A-Za-z]{8,}|[0-9A-Za-z]{20,})$/;

/** Ids that mix letters and digits, such as `6Arp2j6Nig9e` or `6-arp2j6-nig9e.project-tracker`. */
const mixed = (segment: string) =>
  segment.length >= 8 &&
  (segment.match(/\d/g)?.length ?? 0) >= 3 &&
  (segment.match(/[a-z]/gi)?.length ?? 0) >= 3;

const KEY = { test: (segment: string) => PATTERN.test(segment) || mixed(segment) };

const singular = (word: string) =>
  word.endsWith('ies')
    ? `${word.slice(0, -3)}y`
    : word.endsWith('s') && !word.endsWith('ss')
      ? word.slice(0, -1)
      : word;
const camel = (value: string) =>
  value.replace(/[-_]+(\w)/g, (_, letter: string) => letter.toUpperCase());

/** A path as a route template: `/orders/ord_01H...` becomes `/orders/:id`. */
export function templateOf(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const keys = segments.filter((segment) => KEY.test(segment)).length;
  const out = segments.map((segment, index) => {
    if (!KEY.test(segment)) return segment;
    const before = segments[index - 1];
    return keys === 1 || before === undefined ? ':id' : `:${camel(singular(before))}`;
  });
  return `/${out.join('/')}`;
}

/**
 * What an application's pages suggest for its contract: routes, a region per route, lists, buttons
 * matched to actions, and what is left over.
 */
export interface Discovery {
  /** Routes from the paths visited, with row keys turned into parameters. */
  routes: {
    id: string;
    path: string;
    examples: string[];
    title: string;
    entity?: string;
    key?: string;
  }[];
  /** One per route: its page as it is, to start every page as a region. */
  regions: { name: string; label: string; description: string; route: string; entity?: string }[];
  /** Navigation and toolbars that could become lists. */
  lists: { name: string; label: string; route: string | null; items: string[] }[];
  /** Buttons that look like the contract's actions, to send through `useAction`. */
  actions: { route: string; button: string; action: string; score: number }[];
  /** Buttons no action matches. */
  unmapped: { route: string; buttons: string[] }[];
  /** Buttons that open menus or panels, which discovery doesn't open: look inside for lists. */
  menus: { route: string; buttons: string[] }[];
}

/** Buttons that open the rest of a list, such as "More tools": the overflow, not an item. */
const TRIGGER = /^(more|more tools|more actions|more options|show more|overflow|\u2026|\.\.\.)$/i;

/** A list's name as the contract takes surface names: camelCase, such as `ordersDetailToolbar`. */
const surfaceName = (value: string) => {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const joined = words
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
  return /^[a-z]/.test(joined) ? joined : `list${joined}`;
};

const kebab = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

// Built through the same stemmer as the words they meet, which turns "create" into "creat".
const stemmed = (word: string) => terms(word)[0] ?? word;
const STOP = new Set(
  [
    'a',
    'an',
    'the',
    'of',
    'to',
    'for',
    'and',
    'or',
    'in',
    'on',
    'by',
    'with',
    'your',
    'my',
    'this',
    'that',
    'all',
  ].map(stemmed),
);
const SYNONYMS = new Map(
  Object.entries({
    new: 'create',
    add: 'create',
    remove: 'delete',
    destroy: 'delete',
    edit: 'update',
    change: 'update',
    modify: 'update',
  }).map(([word, canonical]) => [stemmed(word), stemmed(canonical)]),
);
const words = (text: string) =>
  new Set(
    terms(text)
      .filter((term) => !STOP.has(term))
      .map((term) => SYNONYMS.get(term) ?? term),
  );

/** Verbs that name no action alone: "Create" or "Export" needs the page to say what. */
const GENERIC = new Set(
  [
    'create',
    'update',
    'delete',
    'export',
    'import',
    'save',
    'open',
    'view',
    'show',
    'submit',
    'apply',
  ]
    .map(stemmed)
    .map((term) => SYNONYMS.get(term) ?? term),
);
/** Words that close a dialog or step back: they name an action only when it is called that. */
const DISMISS = new Set(['cancel', 'close', 'dismiss', 'back', 'done', 'ok', 'no'].map(stemmed));

/**
 * How well an action explains a button, from 0 to 1. Every word of the button must appear in the
 * action's label or id, or in what the page is about; the fewer words beyond the button's, the
 * better, and words the page supplies count half. "Create draft order" matches no action that says
 * nothing of drafts; "Create" alone needs the page to say what; "Cancel" only matches "Cancel".
 */
export function matchAction(
  button: string,
  action: { id: string; label: string },
  about: readonly string[] = [],
): number {
  // "Hand (panning tool)": what's in brackets describes the button, it doesn't name it.
  const wanted = words(button.replace(/\([^)]*\)/g, ' '));
  if (wanted.size === 0) return 0;
  const label = words(action.label);
  const offered = new Set([...label, ...words(action.id.replace(/[.:-]/g, ' '))]);
  const context = new Set(about.flatMap((entry) => [...words(entry)]));
  for (const word of wanted) if (!offered.has(word) && !context.has(word)) return 0;
  // Only the label's own extra words count against it: an exact label scores 1.
  const beyond = [...label].filter((word) => !wanted.has(word));
  const missing = beyond.filter((word) => !context.has(word)).length;
  const supplied = beyond.length - missing;
  const only = wanted.size === 1 ? [...wanted][0] : undefined;
  if (only !== undefined && DISMISS.has(only) && beyond.length > 0) return 0;
  if (only !== undefined && GENERIC.has(only) && missing > 0) return 0;
  return 1 / (1 + missing + supplied / 2);
}

/** How much two lists of names share, from 0 to 1. */
const overlap = (a: readonly string[], b: readonly string[]) => {
  const both = a.filter((name) => b.includes(name)).length;
  return both / Math.max(1, new Set([...a, ...b]).size);
};

/**
 * What an application's pages suggest for its contract: routes from the paths visited, a region
 * per route, lists from navigation and toolbars, and buttons matched to actions by name.
 */
export function discoverApp(
  pages: readonly PageFacts[],
  contract?: Pick<AnyContract, 'actions' | 'actionIds' | 'sourceIds'>,
): Discovery {
  const byTemplate = new Map<string, PageFacts[]>();
  for (const page of pages) {
    const template = templateOf(page.path);
    byTemplate.set(template, [...(byTemplate.get(template) ?? []), page]);
  }
  // A base path every page shares, such as `/app`, isn't part of route names.
  const statics = [...byTemplate.keys()].map((template) =>
    template.split('/').filter((segment) => segment !== '' && !segment.startsWith(':')),
  );
  let shared = 0;
  while (
    statics.length > 1 &&
    statics.every((parts) => parts.length > shared && parts[shared] === statics[0]?.[shared])
  ) {
    shared++;
  }
  const sources = new Set(contract?.sourceIds ?? []);
  const discovery: Discovery = {
    routes: [],
    regions: [],
    lists: [],
    actions: [],
    unmapped: [],
    menus: [],
  };
  const seenLists = new Set<string>();

  for (const [template, visits] of byTemplate) {
    const parts = template.split('/').filter(Boolean).slice(shared);
    const names = parts.filter((part) => !part.startsWith(':')).map(kebab);
    const detail = parts.at(-1)?.startsWith(':') ?? false;
    const id =
      names.length === 0
        ? detail
          ? 'detail'
          : 'home'
        : [...names, ...(detail ? ['detail'] : [])].join('.');
    const owner = detail ? names.at(-1) : undefined;
    const entity =
      owner && (sources.has(owner) ? owner : sources.has(`${owner}s`) ? `${owner}s` : undefined);
    // A page keyed by a row is titled by that row, such as "Order #6": name it by its path.
    const first = visits[0];
    const keyed = parts.some((part) => part.startsWith(':'));
    const title = keyed
      ? humanize(singular(names.at(-1) ?? id))
      : first?.title || humanize(names.at(-1) ?? id);
    discovery.routes.push({
      id,
      path: template,
      examples: visits.map((visit) => visit.path).slice(0, 3),
      title,
      ...(entity ? { entity, key: parts.at(-1)?.slice(1) ?? 'id' } : {}),
    });
    discovery.regions.push({
      name: id,
      label: title,
      description: `The ${title} page as it is`,
      route: id,
      ...(entity ? { entity } : {}),
    });

    const buttons = new Set<string>();
    const opens = new Set<string>();
    for (const visit of visits) {
      for (const nav of visit.navigation) {
        const signature = `${nav.name}|${nav.items.map((item) => item.name).join('|')}`;
        if (seenLists.has(signature) || nav.items.length < 2) continue;
        seenLists.add(signature);
        discovery.lists.push({
          name: surfaceName(nav.name || 'navigation'),
          label: nav.name || 'Navigation',
          route: null,
          items: nav.items.map((item) => item.name).filter((name) => !TRIGGER.test(name)),
        });
      }
      for (const toolbar of visit.toolbars) {
        const items = toolbar.items.filter((name) => !TRIGGER.test(name));
        discovery.lists.push({
          name: surfaceName(`${id} ${toolbar.name || 'toolbar'}`),
          label: toolbar.name || `${title} toolbar`,
          route: id,
          items,
        });
        items.forEach((item) => buttons.add(item));
      }
      // Buttons in the page's content, not in its banner, navigation or footer.
      visit.buttons
        .filter((button) => !/^(banner|navigation|contentinfo)/.test(button.landmark))
        .forEach((button) => (button.opens ? opens : buttons).add(button.name));
      visit.tables.flatMap((table) => table.rowActions).forEach((action) => buttons.add(action));
    }
    const unmapped: string[] = [];
    for (const button of buttons) {
      let best: { action: string; score: number } | undefined;
      const about = [...names, ...(entity ? [entity] : [])];
      for (const action of contract?.actionIds ?? []) {
        const label = contract?.actions[action]?.label ?? action;
        const score = matchAction(button, { id: action, label }, about);
        if (score > (best?.score ?? 0)) best = { action, score };
      }
      if (best) {
        discovery.actions.push({
          route: id,
          button,
          action: best.action,
          score: Math.round(best.score * 100) / 100,
        });
      } else {
        unmapped.push(button);
      }
    }
    if (unmapped.length > 0) discovery.unmapped.push({ route: id, buttons: unmapped });
    if (opens.size > 0) discovery.menus.push({ route: id, buttons: [...opens] });
  }
  // Toolbars repeated on every visit to a route are one list, and navigation that differs a little
  // from page to page, such as by a count, is one list with every item it showed.
  const lists: Discovery['lists'] = [];
  for (const list of discovery.lists) {
    const same = lists.find(
      (entry) =>
        entry.name === list.name &&
        entry.route === list.route &&
        overlap(entry.items, list.items) >= 0.6,
    );
    if (same) same.items = [...new Set([...same.items, ...list.items])];
    else lists.push({ ...list, items: [...list.items] });
  }
  discovery.lists = lists;
  return discovery;
}

/**
 * A discovery as text, for people and coding agents: routes, lists, matches with their scores, and
 * buttons left over.
 */
export function discoveryText(discovery: Discovery): string {
  const lines = [`Routes (${discovery.routes.length}):`];
  for (const route of discovery.routes) {
    lines.push(
      `  ${route.id}  ${route.path}  "${route.title}"${route.entity ? `  entity ${route.entity} by ${route.key}` : ''}`,
    );
  }
  if (discovery.lists.length > 0) {
    lines.push('', 'Lists:');
    for (const list of discovery.lists) {
      lines.push(
        `  ${list.name}${list.route ? ` (on ${list.route})` : ''}: ${list.items.join(', ')}`,
      );
    }
  }
  if (discovery.actions.length > 0) {
    lines.push('', 'Buttons that match actions (send them through useAction):');
    for (const entry of discovery.actions) {
      const weak = entry.score < 0.5 ? ', weak: check it' : '';
      lines.push(`  ${entry.route}: "${entry.button}" -> ${entry.action} (${entry.score}${weak})`);
    }
  }
  if (discovery.unmapped.length > 0) {
    lines.push('', 'Buttons no action matches:');
    for (const entry of discovery.unmapped)
      lines.push(`  ${entry.route}: ${entry.buttons.join(', ')}`);
  }
  if (discovery.menus.length > 0) {
    lines.push('', 'Buttons that open menus or panels, not opened here (look inside for lists):');
    for (const entry of discovery.menus)
      lines.push(`  ${entry.route}: ${entry.buttons.join(', ')}`);
  }
  return lines.join('\n');
}
