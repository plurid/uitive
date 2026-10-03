// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client, suggesting } from './__fixtures__/notes.js';
import { defineElements } from './index.js';

defineElements();

function mount(aptuitive = client()) {
  const panel = document.createElement('apt-your-interface');
  document.body.append(panel);
  panel.client = aptuitive;
  const root = panel.shadowRoot?.querySelector('[part="content"]') as HTMLElement;
  return {
    panel,
    aptuitive,
    root,
    text: () => root.textContent ?? '',
    button: (label: string) =>
      [...root.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === label),
  };
}

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:definition'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => document.body.replaceChildren());

describe('<apt-your-interface>', () => {
  it('says plainly when nothing has changed', () => {
    expect(mount().text()).toContain('Nothing has changed yet.');
  });

  it('lists the user’s own change, and reverts it', () => {
    const { aptuitive, text, button } = mount();
    aptuitive.hide('toolbar', 'bold');
    expect(text()).toContain('You');
    expect(text()).toContain('Bold hidden from Toolbar');
    button('Revert')?.click();
    expect(aptuitive.getSnapshot().definition.operations[0]?.status).toBe('reverted');
    expect(text()).toContain('Nothing has changed yet.');
  });

  it('edits the stated goal', () => {
    const { aptuitive, root, button } = mount();
    const setGoal = vi.spyOn(aptuitive, 'setGoal');
    button('Add a goal')?.click();
    const input = root.querySelector<HTMLInputElement>('input[name="goal"]') as HTMLInputElement;
    input.value = '  I write weekly reports  ';
    input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(setGoal).toHaveBeenCalledWith('I write weekly reports');
    expect(aptuitive.getSnapshot().definition.goal).toBe('I write weekly reports');
    expect(root.textContent).toContain('I write weekly reports');
  });

  it('keeps what the user is typing when the client changes underneath', () => {
    const { aptuitive, root, button } = mount();
    button('Add a goal')?.click();
    const input = root.querySelector<HTMLInputElement>('input[name="goal"]') as HTMLInputElement;
    input.focus();
    input.value = 'half-typed';
    aptuitive.hide('toolbar', 'bold');
    const again = root.querySelector<HTMLInputElement>('input[name="goal"]');
    expect(again?.value).toBe('half-typed');
  });

  it('switches between the user’s interface and the standard one', () => {
    const { aptuitive, button } = mount();
    button('Standard')?.click();
    expect(aptuitive.getSnapshot().view).toBe('standard');
    button('Yours')?.click();
    expect(aptuitive.getSnapshot().view).toBe('yours');
  });

  it('exports the definition, and imports it elsewhere', () => {
    const { panel, aptuitive, button } = mount();
    aptuitive.hide('toolbar', 'bold');
    const exported = vi.fn();
    panel.addEventListener('apt-export', exported);
    button('Export')?.click();
    const document_ = exported.mock.calls[0]?.[0].detail.document;
    expect(document_.format).toBe('aptuitive.definition');
    expect(URL.createObjectURL).toHaveBeenCalledOnce();

    const other = mount();
    const result = other.panel.importDocument(JSON.parse(JSON.stringify(document_)));
    expect(result?.applied).toHaveLength(1);
    expect(other.text()).toContain('Imported 1 change.');
    expect(other.text()).toContain('Bold hidden from Toolbar');
    other.panel.importDocument({ nope: true });
    expect(other.text()).toContain("That file isn't a definition for notes.");
  });

  it('forgets everything only on a second press', () => {
    const { aptuitive, button, text } = mount();
    aptuitive.hide('toolbar', 'bold');
    button('Forget my data')?.click();
    expect(aptuitive.getSnapshot().definition.operations).toHaveLength(1);
    button('Press again to forget everything')?.click();
    expect(aptuitive.getSnapshot().definition.operations).toHaveLength(0);
    expect(text()).toContain('Everything is forgotten');
  });

  it('accepts and dismisses suggestions', async () => {
    const aptuitive = client(suggesting('Weekly summary', 'Meeting notes'));
    const { root, text } = mount(aptuitive);
    await aptuitive.plan();
    expect(text()).toContain('Suggestions');
    expect(text()).toContain('Suggested by model');
    const [first, second] = [...root.querySelectorAll<HTMLButtonElement>('button')].filter(
      (entry) => entry.textContent?.trim() === 'Accept',
    );
    expect(second).toBeDefined();
    first?.click();
    const dismiss = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (entry) => entry.textContent?.trim() === 'Dismiss',
    );
    dismiss?.click();
    const value = aptuitive.surface('snippets');
    expect(value.items.map((entry) => entry.title)).toHaveLength(1);
    expect(value.suggestions).toHaveLength(0);
    expect(text()).not.toContain('Suggestions');
  });

  it('renders untrusted text as text', () => {
    const { aptuitive, root, text } = mount();
    aptuitive.addItem('snippets', { title: '<img src=x onerror="alert(1)">' });
    expect(root.querySelector('img')).toBeNull();
    expect(text()).toContain('<img src=x onerror="alert(1)">');
  });
});
