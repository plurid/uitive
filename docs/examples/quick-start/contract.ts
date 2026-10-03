import { action, defineApp, list } from '@plurid/uitive-core';

export const contract = defineApp({
  id: 'notes',
  description: 'A notes editor',
  actions: {
    bold: action({ label: 'Bold', description: 'Make the selection bold' }),
    italic: action({ label: 'Italic', description: 'Make the selection italic' }),
    link: action({ label: 'Link', description: 'Link the selection' }),
    heading: action({ label: 'Heading', description: 'Turn the line into a heading' }),
    share: action({ label: 'Share', description: 'Share the note' }),
    quote: action({ label: 'Quote', description: 'Turn the paragraph into a quote' }),
    code: action({ label: 'Code', description: 'Format the selection as code' }),
    table: action({ label: 'Table', description: 'Insert a table' }),
  },
  surfaces: {
    toolbar: list({
      label: 'Toolbar',
      description: 'Formatting and insertion, above the note',
      items: ['bold', 'italic', 'link', 'heading', 'share', 'quote', 'code', 'table'],
      capacity: 5,
      required: ['share'],
      reorderable: true,
    }),
  },
});
