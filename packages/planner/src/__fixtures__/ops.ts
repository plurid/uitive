import { z } from 'zod';
import {
  action,
  block,
  choice,
  defineApp,
  list,
  page,
  type ActionSpec,
} from '@plurid/aptuitive-core';

const machines = Array.from({ length: 20 }, (_, index) => `machine-${index}`);

const blocks = {
  table: block({
    label: 'Table',
    description: 'Resources as rows',
    props: z.object({
      machine: z.enum(['current', ...machines] as [string, ...string[]]),
      columns: z.array(z.enum(['name', 'state'])),
      limit: z.number().int(),
    }),
  }),
  note: block({ label: 'Note', description: 'Text', props: z.object({ text: z.string() }) }),
};

const actions: Record<string, ActionSpec> = {
  ...Object.fromEntries(
    machines.map((id) => [id, action({ label: id, description: `Machine ${id}` })]),
  ),
  start: action({ label: 'Start', description: 'Start machines' }),
  stop: action({ label: 'Stop', description: 'Stop machines' }),
};

export const ops = defineApp({
  id: 'ops',
  description: 'An operations console',
  actions,
  contexts: { machine: machines },
  surfaces: {
    nav: list({ label: 'Nav', description: 'Sidebar', items: machines, capacity: 5 }),
    toolbar: list({
      label: 'Toolbar',
      description: 'Buttons',
      items: ['start', 'stop'],
      capacity: 1,
      context: 'machine',
    }),
    density: choice({
      label: 'Density',
      description: 'Spacing',
      values: ['comfortable', 'compact'],
      default: 'comfortable',
    }),
    home: page(blocks)({
      label: 'Home',
      description: 'First page',
      standard: () => ({
        sections: [
          { title: '', layout: 'stack', blocks: [{ block: 'note', props: { text: 'Hi' } }] },
        ],
      }),
    }),
    detail: page(blocks)({
      label: 'Machine page',
      description: 'One machine',
      context: 'machine',
      standard: () => ({
        sections: [
          {
            title: '',
            layout: 'stack',
            blocks: [
              { block: 'table', props: { machine: 'current', columns: ['name'], limit: 5 } },
            ],
          },
        ],
      }),
    }),
  },
});
