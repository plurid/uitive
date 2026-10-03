import type { Persona } from '@plurid/aptuitive-core';
import { byId } from './catalogue.ts';

function persona(
  name: string,
  description: string,
  services: Record<string, number>,
  verbs: Record<string, number>,
): Persona {
  const own = Object.keys(services);
  return {
    name,
    description,
    weights: { ...services, ...verbs },
    actions: [16, 28],
    contexts(action, draw) {
      if (action in services) return { service: action };
      // A verb happens on one of the persona's services that offers it.
      const offering = own.filter((service) =>
        byId.get(service)?.verbs.some((verb) => verb === action),
      );
      const service = offering[Math.floor(draw() * offering.length)];
      return service === undefined ? undefined : { service };
    },
  };
}

export const personas: Persona[] = [
  persona(
    'static-site owner',
    'Hosts a marketing website and keeps an eye on costs',
    {
      'static-sites': 6,
      cdn: 5,
      dns: 3,
      certificates: 2,
      domains: 1,
      'cost-explorer': 2,
      billing: 1,
    },
    { upload: 6, invalidate: 5, logs: 2, settings: 1, costs: 2 },
  ),
  persona(
    'data engineer',
    'Builds pipelines into the warehouse',
    {
      warehouse: 6,
      etl: 5,
      'data-lake': 4,
      'workflow-orchestration': 4,
      'serverless-query': 3,
      'object-storage': 2,
    },
    { query: 6, schedule: 4, logs: 3, metrics: 2, scale: 1 },
  ),
  persona(
    'ML researcher',
    'Trains and serves models',
    {
      notebooks: 6,
      training: 5,
      'gpu-machines': 4,
      datasets: 3,
      'model-hosting': 3,
      'language-models': 2,
    },
    { create: 4, deploy: 3, logs: 4, metrics: 3, stop: 3, costs: 1 },
  ),
  persona(
    'billing admin',
    'Watches spending across the organisation',
    {
      billing: 6,
      'cost-explorer': 6,
      budgets: 4,
      'cost-alerts': 3,
      'usage-reports': 3,
      organisations: 2,
    },
    { export: 5, costs: 4, settings: 2, permissions: 2 },
  ),
];
