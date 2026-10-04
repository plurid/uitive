import { action, choice, collection, defineApp, list } from '@plurid/uitive-core';
import { z } from 'zod';

// #region choice
const density = choice({
  label: 'Density',
  description: 'How much space the interface leaves between things',
  values: ['comfortable', 'compact'],
  default: 'comfortable',
});
// #endregion

// #region collection
const views = collection({
  label: 'Saved views',
  description: 'Filters people come back to, such as paid orders from this week',
  item: z.object({ title: z.string(), status: z.enum(['pending', 'paid', 'shipped']) }),
  max: 8,
  title: (view) => view.title,
});
// #endregion

// #region context
export const drawing = defineApp({
  id: 'drawing',
  description: 'A drawing app whose tool options follow the tool in hand',
  contexts: { tool: ['pen', 'shape', 'text'] },
  actions: {
    'stroke.width': action({ label: 'Stroke width', description: 'How thick lines are' }),
    'stroke.color': action({ label: 'Stroke color', description: 'The color of lines' }),
    'fill.color': action({ label: 'Fill color', description: 'The color inside shapes' }),
    'text.size': action({ label: 'Text size', description: 'How large text is' }),
    'shape.duplicate': action({
      label: 'Duplicate',
      description: 'Copies the selected shapes',
      // It was `shape.copy`: usage and changes recorded under that ID still count.
      aliases: ['shape.copy'],
    }),
  },
  surfaces: {
    options: list({
      label: 'Tool options',
      description: 'Options for the tool in hand',
      items: ['stroke.width', 'stroke.color', 'fill.color', 'text.size', 'shape.duplicate'],
      capacity: 3,
      context: 'tool',
      available: (tool) =>
        tool === 'text'
          ? ['text.size', 'stroke.color']
          : ['stroke.width', 'stroke.color', 'fill.color', 'shape.duplicate'],
    }),
    density,
    views,
  },
});
// #endregion
