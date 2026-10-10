// A stand-in for the parts of the extension APIs Uitive uses, behaving as Chrome's do where it
// matters: writes land later, in order; a change is announced only when a value changes; and
// values come back with their object keys sorted, as Chrome's storage keeps them.

type Change = { oldValue?: unknown; newValue?: unknown };
type ChangeListener = (changes: Record<string, Change>, area: string) => void;

const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .flatMap((key) => {
          const entry = (value as Record<string, unknown>)[key];
          return entry === undefined ? [] : [[key, sorted(entry)]];
        }),
    );
  }
  return value;
};
const copy = (value: unknown) => sorted(JSON.parse(JSON.stringify(value)) as unknown);
const same = (left: unknown, right: unknown) =>
  JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

function area(name: string, listeners: Set<ChangeListener>, delay: () => Promise<void>) {
  const data = new Map<string, unknown>();
  const announce = (changes: Record<string, Change>) => {
    if (Object.keys(changes).length === 0) return;
    for (const listener of [...listeners]) listener(changes, name);
  };
  const keysOf = (keys: string | string[] | null | undefined) =>
    keys === null || keys === undefined
      ? [...data.keys()]
      : typeof keys === 'string'
        ? [keys]
        : keys;
  return {
    data,
    /** Makes the next write fail, as when storage is full. */
    failNext: false,
    async get(keys?: string | string[] | null) {
      return Object.fromEntries(
        keysOf(keys).flatMap((key) => (data.has(key) ? [[key, copy(data.get(key))]] : [])),
      );
    },
    async set(items: Record<string, unknown>) {
      const values = Object.entries(items).map(([key, value]) => [key, copy(value)] as const);
      await delay();
      if (this.failNext) {
        this.failNext = false;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      const changes: Record<string, Change> = {};
      for (const [key, value] of values) {
        if (data.has(key) && same(data.get(key), value)) continue;
        changes[key] = { oldValue: data.get(key), newValue: copy(value) };
        data.set(key, value);
      }
      announce(changes);
    },
    async remove(keys: string | string[]) {
      await delay();
      const changes: Record<string, Change> = {};
      for (const key of keysOf(keys)) {
        if (!data.has(key)) continue;
        changes[key] = { oldValue: data.get(key) };
        data.delete(key);
      }
      announce(changes);
    },
    async clear() {
      await this.remove([...data.keys()]);
    },
  };
}

interface Script {
  id: string;
  matches?: string[];
  js?: string[];
  runAt?: string;
  persistAcrossSessions?: boolean;
}

/** A fresh stand-in; pass it to `vi.stubGlobal('chrome', ...)`. */
export function fakeChrome(options: { delay?: number; manifestHosts?: string[] } = {}) {
  const changeListeners = new Set<ChangeListener>();
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, options.delay ?? 3));
  const scripts = new Map<string, Script>();
  const granted = new Set<string>(options.manifestHosts ?? []);
  const listeners = {
    message: [] as ((
      message: unknown,
      sender: unknown,
      reply: (value: unknown) => void,
    ) => unknown)[],
    connect: [] as ((port: unknown) => void)[],
  };
  const tabs = new Map<number, { id: number; url?: string }>();
  let sendMessage: (message: unknown) => Promise<unknown> = async () => undefined;
  const fake = {
    storage: {
      local: area('local', changeListeners, delay),
      session: area('session', changeListeners, delay),
      onChanged: {
        addListener: (listener: ChangeListener) => changeListeners.add(listener),
        removeListener: (listener: ChangeListener) => changeListeners.delete(listener),
      },
    },
    scripting: {
      scripts,
      async registerContentScripts(list: Script[]) {
        for (const script of list) {
          if (script.id === '' || script.id.startsWith('_')) throw new Error('Bad ID');
          if (scripts.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
        }
        for (const script of list) scripts.set(script.id, script);
      },
      async unregisterContentScripts(filter?: { ids?: string[] }) {
        for (const id of filter?.ids ?? [...scripts.keys()]) {
          if (!scripts.delete(id)) throw new Error(`Nonexistent script ID '${id}'`);
        }
      },
      async getRegisteredContentScripts(filter?: { ids?: string[] }) {
        return [...scripts.values()].filter(
          (script) => !filter?.ids || filter.ids.includes(script.id),
        );
      },
    },
    permissions: {
      granted,
      async contains(permissions: { origins?: string[] }) {
        return (permissions.origins ?? []).every((origin) => granted.has(origin));
      },
      async request(permissions: { origins?: string[] }) {
        for (const origin of permissions.origins ?? []) granted.add(origin);
        return true;
      },
      async remove(permissions: { origins?: string[] }) {
        const fixed = options.manifestHosts ?? [];
        if ((permissions.origins ?? []).some((origin) => fixed.includes(origin))) {
          throw new Error('You cannot remove required permissions.');
        }
        for (const origin of permissions.origins ?? []) granted.delete(origin);
        return true;
      },
      async getAll() {
        return { permissions: [], origins: [...granted] };
      },
    },
    runtime: {
      id: 'uitive-test',
      getURL: (path: string) => `chrome-extension://uitive-test/${path}`,
      getManifest: () => ({ host_permissions: options.manifestHosts ?? [] }),
      onInstalled: { addListener: () => undefined },
      onMessage: {
        addListener: (listener: (typeof listeners.message)[number]) =>
          listeners.message.push(listener),
      },
      onConnect: {
        addListener: (listener: (port: unknown) => void) => listeners.connect.push(listener),
      },
      sendMessage: (message: unknown) => sendMessage(message),
      connect: () => {
        throw new Error('No worker in tests');
      },
    },
    tabs: {
      tabs,
      async get(id: number) {
        const found = tabs.get(id);
        if (!found) throw new Error(`No tab with id: ${id}`);
        return found;
      },
    },
    sidePanel: { setPanelBehavior: async () => undefined },
  };
  return {
    chrome: fake,
    listeners,
    /** Answers the content script's messages to the worker. */
    answer(handler: (message: unknown) => Promise<unknown>) {
      sendMessage = handler;
    },
    /** Sends a message as `sender` would, and waits for the reply. */
    send(message: unknown, sender: object) {
      return new Promise<unknown>((resolve) => {
        let answered = false;
        for (const listener of listeners.message) {
          const async = listener(message, { id: fake.runtime.id, ...sender }, (value) => {
            answered = true;
            resolve(value);
          });
          if (async === true || answered) return;
        }
        resolve(undefined);
      });
    },
  };
}
