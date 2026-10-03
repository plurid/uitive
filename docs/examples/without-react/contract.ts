import { action, defineApp, list } from '@plurid/aptuitive-core';

export const contract = defineApp({
  id: 'editor',
  description: 'A document editor',
  actions: {
    table: action({ label: 'Table', description: 'Insert a table' }),
    image: action({ label: 'Image', description: 'Insert an image' }),
    chart: action({ label: 'Chart', description: 'Insert a chart' }),
    divider: action({ label: 'Divider', description: 'Insert a divider' }),
    comment: action({ label: 'Comment', description: 'Comment on the selection' }),
  },
  surfaces: {
    // The markup shows every item, so the capacity is all of them: only people move items out.
    insert: list({
      label: 'Insert',
      description: 'What the Insert menu offers',
      items: ['table', 'image', 'chart', 'divider', 'comment'],
      capacity: 5,
      reorderable: true,
    }),
  },
});
