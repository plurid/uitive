import { z } from 'zod';
import {
  action,
  block,
  type ActionSpec,
  choice,
  collection,
  defineApp,
  field,
  list,
  page,
  query,
  route,
  source,
  ui,
} from '@plurid/uitive-core';
import { byId, categories, serviceIds, services, verbIds, verbs, type Verb } from './catalog.ts';
import { metricNames, regions, sizes, states } from './data.ts';

const onResource = (label: string, description: string, when?: string) =>
  action({
    label,
    description,
    params: z.object({ resource: field.ref('resources') }),
    effect: 'write',
    ...(when === undefined
      ? {}
      : { when: [{ field: 'resources.state', op: 'eq', values: [when] }] }),
    invalidates: ['resources'],
  });

const actions: Record<string, ActionSpec> = {
  ...Object.fromEntries(
    services.map((service) => [
      service.id,
      action({
        label: service.label,
        description: service.description,
        group: service.categoryLabel,
      }),
    ]),
  ),
  ...Object.fromEntries(
    verbIds.map((verb) => [
      verb,
      action({ label: verbs[verb][0], description: verbs[verb][1], group: 'Service actions' }),
    ]),
  ),
  'resource.start': onResource('Start resource', 'Starts a stopped resource', 'stopped'),
  'resource.stop': onResource('Stop resource', 'Stops a running resource', 'running'),
  'resource.restart': onResource('Restart resource', 'Restarts a running resource', 'running'),
  'resource.delete': action({
    label: 'Delete resource',
    description: 'Deletes a resource for good',
    params: z.object({ resource: field.ref('resources') }),
    effect: 'destructive',
    invalidates: ['resources'],
  }),
};

/** A one-click shortcut: a short sequence of actions, each on a service. */
export const quickAction = z.object({
  label: z.string(),
  steps: z.array(
    z.object({
      service: z.enum(serviceIds as [string, ...string[]]),
      verb: z.enum(verbIds as [Verb, ...Verb[]]),
    }),
  ),
});

export type QuickAction = z.infer<typeof quickAction>;

/** The console's own blocks; everything else on its pages is drawn by Uitive. */
export const blocks = {
  goal: block({
    label: 'Goal',
    description: 'Asks what the user uses the cloud for, or shows the goal they stated',
    props: z.object({}),
  }),
  quickActions: block({
    label: 'Quick actions',
    description: 'The user’s one-click shortcuts, as buttons or a list',
    props: z.object({ style: z.enum(['buttons', 'list']) }),
  }),
};

const thisService = { field: 'resources.service', op: 'eq' as const, values: ['$current'] };
const columns = ['resources.id', 'resources.state', 'resources.region', 'resources.updated'];

export const cloud = defineApp({
  id: 'cloud-console',
  description: `Acme Cloud, a fictional cloud platform with ${services.length} services across compute, storage, databases, networking, security, AI, analytics and more. Every service page offers actions such as deploy, logs, backups or permissions.`,
  actions,
  contexts: { service: serviceIds },
  sources: {
    services: source({
      label: 'Services',
      description: 'Every service of the platform, by category',
      keywords: ['products'],
      row: z.object({
        id: z.string(),
        name: z.string(),
        category: field.enum(categories.map((entry) => entry.id) as [string, ...string[]]),
        description: z.string(),
      }),
      key: 'id',
      title: 'name',
      capabilities: { filter: { id: ['eq', 'in'], category: ['eq'] } },
      scan: 200,
    }),
    resources: source({
      label: 'Resources',
      description:
        'Machines, buckets, databases and the like, each in one service, with their state, load and monthly cost',
      keywords: ['instances', 'machines', 'servers', 'vms'],
      row: z.object({
        id: z.string(),
        service: field.ref('services'),
        state: field.enum(states),
        region: field.enum(regions),
        updated: field.time({ unit: 'ms', label: 'Last change' }),
        cpu: field.number({ label: 'CPU' }),
        memory: field.number({ label: 'Memory' }),
        cost: field.money({ code: 'EUR', label: 'Monthly cost' }),
        size: field.enum(sizes),
        owner: z.string(),
      }),
      key: 'id',
      summary: ['id', 'state'],
      capabilities: { filter: { service: ['eq'], state: ['eq'] } },
      scan: 2000,
      ttl: 5,
    }),
    metrics: source({
      label: 'Metrics',
      description: 'Usage and performance over the last day, hour by hour',
      row: z.object({
        id: z.string(),
        service: field.ref('services'),
        metric: field.enum(metricNames),
        time: field.time({ unit: 'ms' }),
        value: z.number(),
      }),
      key: 'id',
      capabilities: { filter: { service: ['eq'], metric: ['eq'] } },
    }),
    logs: source({
      label: 'Logs',
      description: 'What a service wrote to its log in the last hour',
      row: z.object({
        id: z.string(),
        service: field.ref('services'),
        level: field.enum(['info', 'warning', 'error']),
        time: field.time({ unit: 'ms' }),
        text: z.string(),
      }),
      key: 'id',
      title: 'text',
      capabilities: { filter: { service: ['eq'] } },
    }),
    alerts: source({
      label: 'Alerts',
      description: 'Open alerts, by service and severity',
      row: z.object({
        id: z.string(),
        service: field.ref('services'),
        severity: field.enum(['critical', 'warning']),
        message: z.string(),
        time: field.time({ unit: 'ms' }),
      }),
      key: 'id',
      title: 'message',
    }),
  },
  routes: {
    home: route({ path: '/', page: 'home' }),
    service: route({
      path: '/services/:service',
      entity: 'services',
      key: 'service',
      page: 'servicePage',
    }),
  },
  surfaces: {
    services: list({
      label: 'Your services',
      description:
        'Services in the sidebar, one click away; every other service stays a search away',
      items: serviceIds,
      capacity: 8,
      required: ['billing'],
    }),
    serviceToolbar: list({
      label: 'Service toolbar',
      description: 'Buttons on a service page; the rest wait in its More menu',
      items: verbIds,
      capacity: 6,
      context: 'service',
      available: (service) => byId.get(service)?.verbs ?? [],
    }),
    density: choice({
      label: 'Density',
      description: 'How tightly the console packs information',
      values: ['comfortable', 'compact'],
      default: 'comfortable',
    }),
    home: page(blocks)({
      label: 'Home',
      description: 'The first page of the console: anything the user wants to see first',
      standard: () =>
        ui.page(
          ui.section('', 'stack', [
            ui.block('goal', {}),
            ui.section('Your services', 'stack', [
              ui.block('actions', { list: 'services', items: [], size: 'large' }),
            ]),
            ui.section('Quick actions', 'stack', [ui.block('quickActions', { style: 'buttons' })]),
          ]),
        ),
    }),
    servicePage: page({})({
      label: 'Service page',
      description:
        'The page of one service; it can be redesigned for one service or for every service',
      context: 'service',
      entity: 'services',
      standard: () =>
        ui.page(
          ui.section('', 'stack', [
            ui.section('', 'grid', [
              ui.block('metric', { data: 'count', label: 'Resources', compare: 'none' }),
              ui.block('metric', { data: 'running', label: 'Running', compare: 'none' }),
              ui.block('metric', { data: 'cost', label: 'Monthly cost', compare: 'none' }),
            ]),
            ui.block('actions', { list: 'serviceToolbar', items: [], size: 'regular' }),
            ui.block('table', {
              data: 'resources',
              columns,
              lookups: [],
              rowActions: [
                { action: 'resource.start', set: [] },
                { action: 'resource.stop', set: [] },
              ],
              density: 'comfortable',
              link: 'none',
            }),
          ]),
          [
            {
              name: 'count',
              query: query('resources', { filter: [thisService], aggregate: { measure: 'count' } }),
            },
            {
              name: 'running',
              query: query('resources', {
                filter: [thisService, { field: 'resources.state', op: 'eq', values: ['running'] }],
                aggregate: { measure: 'count' },
              }),
            },
            {
              name: 'cost',
              query: query('resources', {
                filter: [thisService],
                aggregate: { measure: 'sum', of: 'resources.cost' },
              }),
            },
            {
              name: 'resources',
              query: query('resources', {
                fields: columns,
                filter: [thisService],
                sort: [{ field: 'resources.id', direction: 'asc' }],
                limit: 20,
              }),
            },
          ],
        ),
    }),
    quickActions: collection({
      label: 'Quick actions',
      description: 'One-click shortcuts that run a short sequence of service actions',
      item: quickAction,
      max: 6,
      title: (item) => item.label,
      validate: (item) => {
        if (item.steps.length < 1 || item.steps.length > 5)
          return 'Quick actions have one to five steps';
        if (item.label.length > 40) return 'Keep the name under forty characters';
        const unavailable = item.steps.find(
          (step) => !byId.get(step.service)?.verbs.includes(step.verb),
        );
        return unavailable
          ? `${verbs[unavailable.verb][0]} isn't available on ${unavailable.service}`
          : undefined;
      },
    }),
  },
});
