/** @vitest-environment happy-dom */
import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  action,
  choice,
  createAptuitive,
  defineApp,
  heuristicPlanner,
  list,
  memoryStore,
} from '@plurid/aptuitive-core';
import { useCommand, useLifecycle, useSnapshot, useSurface } from './hooks.js';

const contract = defineApp({
  id: 'notes',
  description: 'A notes app',
  actions: {
    bold: action({ label: 'Bold', description: 'Bold text' }),
    italic: action({ label: 'Italic', description: 'Italic text' }),
    link: action({ label: 'Link', description: 'Insert a link' }),
    share: action({ label: 'Share', description: 'Share the note' }),
  },
  surfaces: {
    toolbar: list({
      label: 'Toolbar',
      description: 'Formatting',
      items: ['bold', 'italic', 'link', 'share'],
      capacity: 3,
      required: ['share'],
    }),
    density: choice({
      label: 'Density',
      description: 'Spacing',
      values: ['comfortable', 'compact'],
      default: 'comfortable',
    }),
  },
});

const fresh = () => createAptuitive({ contract, now: () => 0 });
type Client = ReturnType<typeof fresh>;

function Toolbar({ client, onRender }: { client: Client; onRender?: () => void }) {
  const toolbar = useSurface(client, 'toolbar');
  onRender?.();
  return (
    <div role="toolbar">
      {toolbar.visible.map((item) => (
        <button key={item.id} type="button" onClick={() => client.record(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

describe('useSurface', () => {
  it('re-renders when the surface changes, not on unrelated usage', () => {
    const client = fresh();
    const onRender = vi.fn();
    render(<Toolbar client={client} onRender={onRender} />);
    const before = onRender.mock.calls.length;
    act(() => client.record('bold'));
    expect(onRender.mock.calls.length).toBe(before);
    act(() => {
      client.hide('toolbar', 'bold');
    });
    expect(onRender.mock.calls.length).toBe(before + 1);
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  });

  it('renders the standard layout on the server and the user’s on the client, without mismatch', async () => {
    const store = memoryStore();
    const server = createAptuitive({ contract, now: () => 0, store });
    server.hide('toolbar', 'bold');
    server.flush();

    const html = renderToString(<Toolbar client={server} />);
    expect(html).toContain('Bold');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = createAptuitive({ contract, now: () => 0, store });
    await act(async () => {
      hydrateRoot(container, <Toolbar client={client} />);
    });
    await waitFor(() => expect(container.textContent).not.toContain('Bold'));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('useLifecycle', () => {
  it('starts no session under StrictMode and leaves no listeners behind', async () => {
    const client = fresh();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    function App() {
      useLifecycle(client);
      useSnapshot(client);
      return null;
    }
    const view = await act(async () =>
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    );
    expect(client.getSnapshot().session).toBe(0);
    view.unmount();
    const added = add.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    expect(added).toBe(removed);
    add.mockRestore();
    remove.mockRestore();
  });

  it('plans each session from use once, under StrictMode too', async () => {
    let time = 0;
    const plan = vi.fn(heuristicPlanner().plan);
    const client = createAptuitive({ contract, now: () => time, planner: { name: 'test', plan } });
    function App() {
      useLifecycle(client);
      return null;
    }
    const view = await act(async () =>
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    );
    expect(plan).toHaveBeenCalledOnce();

    const back = async () => {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    await back();
    expect(plan).toHaveBeenCalledOnce();
    time += 31 * 60_000;
    await back();
    expect(client.getSnapshot().session).toBe(1);
    expect(plan).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});

describe('useCommand', () => {
  it('tracks a request and its result', async () => {
    const client = fresh();
    function Ask() {
      const command = useCommand(client);
      return (
        <div>
          <button type="button" onClick={() => void command.ask('compact')}>
            Ask
          </button>
          <output>{command.pending ? 'pending' : (command.result?.status ?? 'idle')}</output>
        </div>
      );
    }
    render(<Ask />);
    expect(screen.getByRole('status').textContent).toBe('idle');
    await act(async () => {
      screen.getByRole('button', { name: 'Ask' }).click();
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('done'));
    expect(client.surface('density')).toBe('compact');
  });
});
