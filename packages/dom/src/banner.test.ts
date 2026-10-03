// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, suggesting } from './__fixtures__/notes.js';
import { defineElements } from './index.js';

defineElements();

function mount(aptuitive = client()) {
  const banner = document.createElement('apt-banner');
  document.body.append(banner);
  banner.client = aptuitive;
  const content = () => banner.shadowRoot?.querySelector('[part="content"]');
  return { banner, aptuitive, text: () => content()?.textContent ?? '' };
}

const button = (root: ShadowRoot | null, label: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find(
    (entry) => entry.textContent?.trim() === label,
  );

afterEach(() => document.body.replaceChildren());

describe('<apt-banner>', () => {
  it('stays empty until something changes', () => {
    expect(mount().text().trim()).toBe('');
  });

  it('doesn’t replay what happened before it first showed the client, as after a reload', async () => {
    const aptuitive = client();
    await aptuitive.ask('hide bold');
    const { banner, text } = mount(aptuitive);
    expect(text().trim()).toBe('');
    await aptuitive.ask('hide italic');
    expect(text()).toContain('Italic hidden from Toolbar');
    expect(banner.shadowRoot?.querySelector('[part="heading"]')?.textContent).toBe('Done');
  });

  it('answers a command with what changed and why', async () => {
    const { banner, aptuitive, text } = mount();
    await aptuitive.ask('hide bold');
    expect(text()).toContain('Done');
    expect(text()).toContain('“hide bold”');
    expect(text()).toContain('Bold hidden from Toolbar');
    expect(text()).toContain('You asked: “hide bold”.');
    expect(banner.shadowRoot?.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('reverts a change from the banner', async () => {
    const { banner, aptuitive, text } = mount();
    await aptuitive.ask('hide bold');
    button(banner.shadowRoot, 'Revert')?.click();
    expect(aptuitive.getSnapshot().definition.operations[0]?.status).toBe('reverted');
    expect(text()).toContain('Reverted');
  });

  it('offers new suggestions to accept or dismiss', async () => {
    const { banner, aptuitive, text } = mount(client(suggesting('Weekly summary')));
    await aptuitive.plan();
    expect(text()).toContain('New suggestions');
    expect(text()).toContain('New in Snippets: Weekly summary');
    button(banner.shadowRoot, 'Accept')?.click();
    expect(aptuitive.surface('snippets').items.map((entry) => entry.title)).toEqual([
      'Weekly summary',
    ]);
  });

  it('explains refusals in policy’s words', async () => {
    const { aptuitive, text } = mount();
    await aptuitive.ask('hide share');
    expect(text()).toContain('Not allowed');
    expect(text()).toContain('Share is required by this application');
  });

  it('closes, and stays closed for that adaptation', async () => {
    const { banner, aptuitive, text } = mount();
    const dismissed = vi.fn();
    banner.addEventListener('apt-dismiss', dismissed);
    await aptuitive.ask('hide bold');
    button(banner.shadowRoot, '✕')?.click();
    expect(text().trim()).toBe('');
    expect(dismissed).toHaveBeenCalledOnce();
    aptuitive.record('italic');
    expect(text().trim()).toBe('');
    await aptuitive.ask('compact');
    expect(text()).toContain('Density set to compact');
  });

  it('works whether the client arrives before or after connection, and lets go on removal', async () => {
    const aptuitive = client();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: () => void) => {
      const stop = aptuitive.subscribe(listener);
      return () => {
        unsubscribe();
        stop();
      };
    });
    const banner = document.createElement('apt-banner');
    banner.client = { ...aptuitive, subscribe };
    expect(subscribe).not.toHaveBeenCalled();
    document.body.append(banner);
    expect(subscribe).toHaveBeenCalledOnce();
    await aptuitive.ask('hide bold');
    expect(banner.shadowRoot?.textContent).toContain('Bold hidden from Toolbar');
    banner.remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
