import {
  createUitive,
  fromRows,
  heuristicPlanner,
  localStore,
  remotePlanner,
  type Fetch,
} from '@plurid/uitive-core';
import { byId, verbs } from './catalog.ts';
import { cloud } from './contract.ts';
import {
  alertRows,
  change,
  logRows,
  metricNames,
  metricRows,
  resources,
  serviceRows,
} from './data.ts';

/** What the console does when anything, its own controls or a generated page, runs an action. */
export const handlers = {
  open: (_service: string) => {},
  /** Simulates a service verb; returns what to tell the person. */
  run: (verb: string) => verb,
  navigate: (_href: string) => {},
};

const memory = fromRows({ services: serviceRows, resources, alerts: alertRows });

/** Rows made on demand for the service a query is about, or for every service. */
const generated =
  (make: (service: string) => Record<string, unknown>[]): Fetch =>
  (request, context) => {
    const service = request.filter.find(
      (filter) => filter.field === 'service' && filter.op === 'eq',
    )?.values[0];
    const rows =
      typeof service === 'string' ? make(service) : serviceRows.flatMap((entry) => make(entry.id));
    return fromRows({ [request.source]: rows })(
      { ...request, filter: request.filter.filter((filter) => filter.field !== 'service') },
      context,
    );
  };

const metrics = generated((service) =>
  metricNames.flatMap((metric) => metricRows(service, metric)),
);
const logs = generated(logRows);

export const uitive = createUitive({
  contract: cloud,
  store: localStore('uitive:cloud-console'),
  // A model on the server; the deterministic planner whenever it can't answer. Built as a static
  // site with VITE_UITIVE_PLANNER=none, as at uitive.dev/demo, it has no server to ask.
  planner:
    import.meta.env.VITE_UITIVE_PLANNER === 'none'
      ? heuristicPlanner()
      : remotePlanner({ url: '/api/uitive', fallback: heuristicPlanner() }),
  bindings: {
    fetch: (request, context) =>
      request.source === 'metrics'
        ? metrics(request, context)
        : request.source === 'logs'
          ? logs(request, context)
          : memory(request, context),
    perform: (params, { action }) => {
      if (byId.has(action)) return handlers.open(action);
      if (action in verbs) return { message: handlers.run(action) };
      return { message: change(action, (params as { resource?: string }).resource ?? '') };
    },
    navigate: (href) => handlers.navigate(href),
  },
  onError: (error) => console.warn('[uitive]', error),
});

export type Client = typeof uitive;

// In development only: reach the client from the browser's console.
if (import.meta.env.DEV) (globalThis as { uitive?: Client }).uitive = uitive;
