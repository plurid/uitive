import { rowParam } from './action.js';
import type { AnyContract } from './contract.js';
import type { PlanRequest } from './planner.js';
import { humanise } from './field.js';

/** One source with everything that belongs to it: what a planner is shown together. */
export interface Area {
  /** The source at its centre. */
  source: string;
  /** Actions that act on its rows, or change it. */
  actions: readonly string[];
  /** Routes that show its rows. */
  routes: readonly string[];
  /** The words it is found by. */
  terms: readonly string[];
}

/** What a request may use: its sources, and the actions and routes that come with them. */
export interface Subset {
  /** The sources a request plans over. */
  sources: readonly string[];
  /** Its areas' actions, and others its words name: at most `MAX_ACTIONS`. */
  actions: readonly string[];
  /** The routes that show them. */
  routes: readonly string[];
}

/** Sources in a subset at most. */
export const MAX_SOURCES = 8;
/** Areas added by relevance, beyond those on screen. */
export const EXTRA_AREAS = 2;
/** Actions in a subset at most, besides those lists hold. */
export const MAX_ACTIONS = 24;

const STOP = new Set(
  'a an and are as at be by for from has have i in is it its me my of on or our show that the their this to was we with you your all any every want see make put get only just like page pages'.split(
    ' ',
  ),
);

/** Lowercase words, split at punctuation, snake_case and camelCase, stemmed lightly. */
export function terms(text: string): string[] {
  return humanise(text.replace(/[^\p{L}\p{N}]+/gu, ' '))
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem);
}

/** A light stemmer: enough that "disputed", "disputes" and "dispute" meet. */
function stem(word: string): string {
  let out = word;
  if (out.length > 4 && out.endsWith('ies')) out = `${out.slice(0, -3)}y`;
  else if (out.length > 4 && /(ches|shes|xes|sses)$/.test(out)) out = out.slice(0, -2);
  else if (out.length > 3 && out.endsWith('s') && !out.endsWith('ss')) out = out.slice(0, -1);
  if (out.length > 5 && out.endsWith('ing')) out = out.slice(0, -3);
  else if (out.length > 4 && out.endsWith('ed')) out = out.slice(0, -2);
  if (out.length > 4 && out.endsWith('e')) out = out.slice(0, -1);
  return out;
}

/** The areas of a contract, one per source. */
export function areasOf(contract: AnyContract): Area[] {
  return contract.sourceIds.map((id) => {
    const source = contract.source(id);
    const actions = contract.actionIds.filter((action) => {
      const spec = contract.actions[action];
      return (
        rowParam(contract.params(action))?.source === id || (spec?.invalidates ?? []).includes(id)
      );
    });
    const routes = contract.routeIds.filter((route) => contract.routes[route]?.entity === id);
    const words = [
      id,
      source?.label ?? '',
      source?.description ?? '',
      ...(source?.keywords ?? []),
      ...(source?.fields ?? []).flatMap((entry) => [entry.name, entry.label, ...entry.values]),
      ...actions.flatMap((action) => [
        contract.actions[action]?.label ?? '',
        contract.actions[action]?.description ?? '',
      ]),
      ...routes.flatMap((route) => [
        contract.routes[route]?.label ?? '',
        contract.routes[route]?.path ?? '',
      ]),
    ];
    return { source: id, actions, routes, terms: terms(words.join(' ')) };
  });
}

const K1 = 1.2;
const B = 0.75;

/** Areas ranked by BM25 against some words, best first; areas with no match are left out. */
export function rankAreas(
  areas: readonly Area[],
  text: string,
): { source: string; score: number }[] {
  const query = [...new Set(terms(text))];
  if (query.length === 0 || areas.length === 0) return [];
  const average = areas.reduce((total, area) => total + area.terms.length, 0) / areas.length || 1;
  const frequency = new Map<string, number>();
  for (const area of areas) {
    for (const term of new Set(area.terms)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  return areas
    .map((area) => {
      const counts = new Map<string, number>();
      for (const term of area.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      let score = 0;
      for (const term of query) {
        const tf = counts.get(term) ?? 0;
        if (tf === 0) continue;
        const df = frequency.get(term) ?? 0;
        const idf = Math.log(1 + (areas.length - df + 0.5) / (df + 0.5));
        score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * area.terms.length) / average));
      }
      return { source: area.source, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source));
}

/**
 * How to scope a large contract for one request: what was said, what is on screen, and how much to
 * keep.
 */
export interface SubsetOptions {
  /** What the person said, and their goal. */
  text?: string;
  /** Sources on screen now, always included. */
  inView?: readonly string[];
  /** Sources the subset may hold. @default 8 */
  maxSources?: number;
  /** Areas added by relevance beyond those on screen. @default 2 */
  extra?: number;
}

/**
 * The part of a contract a request may use: everything, when it is small; otherwise the areas
 * on screen plus the most relevant few. Few distinct subsets keep compiled grammars and prompt
 * caches warm.
 */
export function selectSubset(contract: AnyContract, options: SubsetOptions = {}): Subset {
  const areas = areasOf(contract);
  const most = options.maxSources ?? MAX_SOURCES;
  const known = new Set(contract.sourceIds);
  let picked: string[];
  if (contract.sourceIds.length <= most) {
    picked = [...contract.sourceIds];
  } else {
    picked = [...new Set((options.inView ?? []).filter((id) => known.has(id)))].slice(0, most);
    let added = 0;
    for (const entry of rankAreas(areas, options.text ?? '')) {
      if (picked.length >= most || added >= (options.extra ?? EXTRA_AREAS)) break;
      if (picked.includes(entry.source)) continue;
      picked.push(entry.source);
      added++;
    }
    picked.sort((a, b) => contract.sourceIds.indexOf(a) - contract.sourceIds.indexOf(b));
  }
  const order = (area: Area) => {
    const seen = (options.inView ?? []).indexOf(area.source);
    return seen === -1 ? (options.inView?.length ?? 0) : seen;
  };
  const chosen = areas
    .filter((area) => picked.includes(area.source))
    .sort((a, b) => order(a) - order(b));
  const actions = [...new Set(chosen.flatMap((area) => area.actions))];
  // Actions that belong to no area come in when the request names them.
  if (contract.sourceIds.length > most) {
    const tied = new Set(areas.flatMap((area) => area.actions));
    const loose = contract.actionIds
      .filter((id) => !tied.has(id))
      .map((id) => {
        const spec = contract.actions[id];
        return {
          source: id,
          actions: [],
          routes: [],
          terms: terms(
            `${id} ${spec?.label ?? ''} ${spec?.description ?? ''} ${spec?.group ?? ''}`,
          ),
        };
      });
    for (const entry of rankAreas(loose, options.text ?? '')) actions.push(entry.source);
  }
  return {
    sources: picked,
    actions: contract.sourceIds.length > most ? actions.slice(0, MAX_ACTIONS) : actions,
    routes: [...new Set(chosen.flatMap((area) => area.routes))],
  };
}

/** The actions a scoped request may name: every list's items, and the subset's actions. */
export function actionsInScope(contract: AnyContract, subset: Subset): string[] {
  const listed = contract.surfaceIds.flatMap((id) => {
    const spec = contract.surfaces[id];
    if (spec?.kind !== 'list') return [];
    const values = spec.context === undefined ? [] : (contract.contexts[spec.context] ?? []);
    return [...spec.items, ...values.flatMap((value) => contract.items(id, value))];
  });
  return [...new Set([...listed, ...subset.actions])].sort();
}

/** The sources a request's screen shows: its pages' queries and the row its route is about. */
export function sourcesInView(contract: AnyContract, request: PlanRequest): string[] {
  const found = new Set<string>();
  const pages = [
    ...request.state.pages.map((entry) => entry.value),
    ...(request.state.userPage ? [request.state.userPage.value] : []),
  ];
  for (const page of pages) for (const entry of page.data) found.add(entry.query.source);
  const route = request.route === undefined ? undefined : contract.routes[request.route];
  if (route?.entity !== undefined) found.add(route.entity);
  return [...found];
}
