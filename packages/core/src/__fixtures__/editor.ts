import { z } from 'zod';
import { action, choice, collection, defineApp, list } from '../contract.js';

const names = {
  save: 'Save',
  undo: 'Undo',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  heading: 'Heading',
  quote: 'Quote',
  code: 'Code block',
  link: 'Link',
  table: 'Insert table',
  image: 'Insert image',
  comment: 'Comment',
  share: 'Share',
  'export-pdf': 'Export PDF',
  'export-csv': 'Export CSV',
  print: 'Print',
} as const;

type Id = keyof typeof names;

const actions = Object.fromEntries(
  Object.entries(names).map(([id, label]) => [
    id,
    action({ label, description: `${label} in the document`, group: 'editing' }),
  ]),
) as Record<Id, ReturnType<typeof action>>;

export const macro = z.object({ label: z.string(), steps: z.array(z.string()) });

export const editor = defineApp({
  id: 'editor',
  description: 'A document editor',
  actions,
  contexts: { tool: ['text', 'table'] },
  surfaces: {
    toolbar: list({
      label: 'Toolbar',
      description: 'Formatting and insertion',
      items: [
        'bold',
        'italic',
        'underline',
        'strike',
        'heading',
        'quote',
        'code',
        'link',
        'table',
        'image',
        'comment',
        'share',
        'export-pdf',
        'print',
      ],
      capacity: 6,
      required: ['share'],
    }),
    file: list({
      label: 'File menu',
      description: 'Document actions',
      items: ['save', 'export-pdf', 'export-csv', 'print', 'share'],
      capacity: 3,
      required: ['save'],
    }),
    tableBar: list({
      label: 'Table bar',
      description: 'Actions for the active tool',
      items: ['bold', 'italic', 'table', 'comment'],
      capacity: 2,
      context: 'tool',
      available: (tool) =>
        tool === 'table' ? ['table', 'bold', 'italic'] : ['bold', 'italic', 'comment'],
    }),
    density: choice({
      label: 'Density',
      description: 'How tightly controls are packed',
      values: ['comfortable', 'compact'],
      default: 'comfortable',
    }),
    macros: collection({
      label: 'Macros',
      description: 'One-click sequences of actions',
      item: macro,
      max: 2,
      title: (item) => item.label,
      validate: (item) =>
        item.steps.length < 2
          ? 'A macro needs at least two steps'
          : item.steps.every((step) => step in names)
            ? undefined
            : 'Macros may only use known actions',
    }),
  },
});
