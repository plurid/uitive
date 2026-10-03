import { random } from '@plurid/aptuitive-core';
import { byId, services } from './catalogue.ts';

// Deterministic, invented data: every service always shows the same resources, metrics and logs,
// so pages are stable across reloads and redesigns.

const seedOf = (text: string) =>
  [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);

const HOUR = 3_600_000;
const NOW = Math.floor(Date.now() / HOUR) * HOUR;

export const regions = ['eu-west', 'eu-north', 'us-east', 'us-west', 'ap-south'] as const;
export const sizes = ['small', 'medium', 'large', 'xlarge'] as const;
export const states = ['running', 'stopped', 'updating'] as const;
export const metricNames = ['cpu', 'memory', 'requests', 'errors', 'latency', 'storage'] as const;
const owners = ['platform', 'web', 'data', 'research', 'finance'];

export interface Resource {
  id: string;
  service: string;
  state: (typeof states)[number];
  region: (typeof regions)[number];
  /** When it last changed, in milliseconds. */
  updated: number;
  cpu: number;
  memory: number;
  /** Monthly cost in euros. */
  cost: number;
  size: (typeof sizes)[number];
  owner: string;
}

function generate(service: string): Resource[] {
  const draw = random(seedOf(service));
  const count = 3 + Math.floor(draw() * 9);
  return Array.from({ length: count }, (_, index): Resource => {
    const roll = draw();
    return {
      id: `${service}-${(seedOf(service) % 900) + 100 + index * 7}`,
      service,
      state: roll < 0.68 ? 'running' : roll < 0.88 ? 'stopped' : 'updating',
      region: regions[Math.floor(draw() * regions.length)] as Resource['region'],
      updated: NOW - (1 + Math.floor(draw() * 72)) * HOUR,
      cpu: Math.round(draw() * 96),
      memory: Math.round(20 + draw() * 75),
      cost: Math.round(4 + draw() * 380),
      size: sizes[Math.floor(draw() * sizes.length)] as Resource['size'],
      owner: owners[Math.floor(draw() * owners.length)] as string,
    };
  });
}

/** Every resource, kept in memory so runs can change them. */
export const resources: Resource[] = services.flatMap((service) => generate(service.id));

/** What a simulated run does to a resource; the message is for the person. */
export function change(action: string, id: string): string {
  const index = resources.findIndex((resource) => resource.id === id);
  const resource = resources[index];
  if (!resource) return `${id} is gone`;
  if (action === 'resource.delete') {
    resources.splice(index, 1);
    return `${id} deleted (simulated)`;
  }
  const state = action === 'resource.stop' ? 'stopped' : 'running';
  resources[index] = { ...resource, state, updated: Date.now() };
  return `${id} ${action === 'resource.restart' ? 'restarted' : state} (simulated)`;
}

export const serviceRows = services.map((service) => ({
  id: service.id,
  name: service.label,
  category: service.category,
  description: service.description,
}));

const alertTexts = [
  'CPU above 90% for 15 minutes',
  'Error rate rising',
  'Certificate expires in 6 days',
  'Disk 85% full',
  'Latency above target',
  'Backup failed last night',
];

export const alertRows = services.flatMap((service) => {
  const draw = random(seedOf(`alerts|${service.id}`));
  if (draw() > 0.22) return [];
  return [
    {
      id: `alert-${service.id}`,
      service: service.id,
      severity: draw() < 0.35 ? ('critical' as const) : ('warning' as const),
      message: alertTexts[Math.floor(draw() * alertTexts.length)] as string,
      time: NOW - (2 + Math.floor(draw() * 300)) * 60_000,
    },
  ];
});

const scales: Record<string, number> = {
  cpu: 100,
  memory: 100,
  requests: 2400,
  errors: 40,
  latency: 320,
  storage: 900,
};

/** A day of a metric, hour by hour: a seeded random walk with a plausible scale. */
export function metricRows(service: string, metric: string) {
  const draw = random(seedOf(`${service}|${metric}`));
  const top = scales[metric] ?? 100;
  let value = top * (0.3 + draw() * 0.4);
  return Array.from({ length: 24 }, (_, index) => {
    value = Math.max(0, Math.min(top, value + (draw() - 0.5) * top * 0.18));
    return {
      id: `${service}|${metric}|${index}`,
      service,
      metric,
      time: NOW - (23 - index) * HOUR,
      value: Math.round(value * 10) / 10,
    };
  });
}

const logTexts = {
  info: [
    'Request served in 42 ms',
    'Health check passed',
    'Scaled to 3 instances',
    'Configuration reloaded',
    'Deployment finished',
  ],
  warning: ['Retrying connection to upstream', 'Slow response from database', 'Memory above 80%'],
  error: [
    'Upstream timed out after 30 s',
    'Permission denied for role reader',
    'Out of memory; restarting',
  ],
};

/** A service's log lines from the last hour, newest first. */
export function logRows(service: string) {
  const draw = random(seedOf(`logs|${service}`));
  return Array.from({ length: 40 }, (_, index) => {
    const roll = draw();
    const level = roll < 0.7 ? 'info' : roll < 0.9 ? 'warning' : 'error';
    const texts = logTexts[level];
    return {
      id: `${service}|log|${index}`,
      service,
      level,
      time: NOW - index * 90_000 - Math.floor(draw() * 60_000),
      text: texts[Math.floor(draw() * texts.length)] as string,
    };
  });
}

export function labelOf(service: string | undefined): string {
  return service === undefined ? 'No service' : (byId.get(service)?.label ?? service);
}
