/** @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { action, block, createAptuitive, defineApp, page, ui } from '@plurid/aptuitive-core';
import { Page, type BlockComponents } from './page.js';
import { useSurface } from './hooks.js';

const blocks = {
  heading: block({
    label: 'Heading',
    description: 'A title',
    props: z.object({ text: z.string() }),
  }),
  counter: block({
    label: 'Counter',
    description: 'A number',
    props: z.object({ value: z.number() }),
  }),
};

const contract = defineApp({
  id: 'pages',
  description: 'Pages',
  actions: { open: action({ label: 'Open', description: 'Open' }) },
  surfaces: {
    home: page(blocks)({
      label: 'Home',
      description: 'Home',
      standard: () => ({
        sections: [
          {
            title: 'Welcome',
            layout: 'stack',
            blocks: [{ block: 'heading', props: { text: 'Hello' } }],
          },
        ],
      }),
    }),
  },
});

const components: BlockComponents<typeof blocks> = {
  heading: ({ props }) => <h3>{props.text}</h3>,
  counter: ({ props }) => <output>{props.value}</output>,
};

function Home({ client }: { client: ReturnType<typeof fresh> }) {
  return <Page value={useSurface(client, 'home')} blocks={components} />;
}
const fresh = () => createAptuitive({ contract, now: () => 0 });

describe('Page', () => {
  it('renders a page that is one region as the application itself, with no wrapper', () => {
    const app = defineApp({
      id: 'whole',
      version: '1',
      description: 'A full-height application',
      actions: {},
      regions: { app: { label: 'The application', description: 'Every page as it is' } },
      surfaces: {
        home: page({})({
          label: 'Home',
          description: 'Home',
          standard: () => ui.page(ui.region('app')),
        }),
      },
    });
    const client = createAptuitive({ contract: app, now: () => 0 });
    const { container } = render(
      <Page
        value={client.surface('home')}
        blocks={{}}
        regions={{ app: () => <div data-testid="app">The app</div> }}
      />,
    );
    // Nothing may sit between the host's layout and its application.
    expect(container.firstElementChild).toBe(screen.getByTestId('app'));
  });

  it('renders the standard page, then a redesign, with the application’s components', async () => {
    const client = fresh();
    const view = render(<Home client={client} />);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
    expect(screen.getByText('Hello')).toBeTruthy();

    const { act } = await import('@testing-library/react');
    act(() => {
      client.setPage('home', {
        sections: [
          {
            title: 'Mine',
            layout: 'grid',
            blocks: [
              { block: 'counter', props: { value: 42 } },
              { block: 'heading', props: { text: 'Hi' } },
            ],
          },
        ],
      });
    });
    expect(screen.getByRole('status').textContent).toBe('42');
    expect(view.container.querySelector('[data-layout="grid"]')).toBeTruthy();
    expect(screen.queryByText('Hello')).toBeNull();
  });

  it('demands a component for every block, typed by its props', () => {
    // @ts-expect-error: the counter block has no component.
    const missing: BlockComponents<typeof blocks> = {
      heading: ({ props }) => <h3>{props.text}</h3>,
    };
    const wrong: BlockComponents<typeof blocks> = {
      heading: ({ props }) => <h3>{props.text}</h3>,
      // @ts-expect-error: counter props have no `text`.
      counter: ({ props }) => <output>{props.text}</output>,
    };
    expect([missing, wrong]).toHaveLength(2);
  });
});
