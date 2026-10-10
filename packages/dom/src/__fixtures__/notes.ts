import {
  action,
  choice,
  collection,
  createUitive,
  defineApp,
  list,
  type Planner,
} from '@plurid/uitive-core';
import { z } from 'zod';

export const notes = defineApp({
  id: 'notes',
  description: 'A note-taking app',
  actions: {
    bold: action({ label: 'Bold', description: 'Bold the selection' }),
    italic: action({ label: 'Italic', description: 'Italicize the selection' }),
    share: action({ label: 'Share', description: 'Share the note' }),
    table: action({ label: 'Insert table', description: 'Insert a table' }),
    print: action({ label: 'Print', description: 'Print the note' }),
  },
  surfaces: {
    toolbar: list({
      label: 'Toolbar',
      description: 'Formatting',
      items: ['bold', 'italic', 'share', 'table', 'print'],
      capacity: 3,
      required: ['share'],
    }),
    density: choice({
      label: 'Density',
      description: 'Spacing',
      values: ['comfortable', 'compact'],
      default: 'comfortable',
    }),
    snippets: collection({
      label: 'Snippets',
      description: 'Saved text',
      item: z.object({ title: z.string() }),
      max: 3,
      title: (item) => item.title,
    }),
  },
});

/** A client with a clock that only moves when told to. */
export function client(planner?: Planner) {
  let time = 0;
  return createUitive({
    contract: notes,
    now: () => (time += 1000),
    ...(planner === undefined ? {} : { planner }),
  });
}

/** A planner that suggests the given snippets, as a model would. */
export function suggesting(...titles: string[]): Planner {
  return {
    name: 'test',
    async plan() {
      return {
        origin: 'model',
        operations: titles.map((title) => ({
          change: {
            kind: 'collection' as const,
            surface: 'snippets',
            op: 'add' as const,
            item: title.toLowerCase().replace(/\W+/g, '-'),
            value: { title },
          },
          evidence: [{ action: 'bold', metric: 'uses' as const }],
        })),
        meta: { planner: 'test', ms: 0 },
      };
    },
  };
}
