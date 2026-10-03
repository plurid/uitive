// Keys live in the extension's own IndexedDB, which no content script or page can read. They go
// in from the side panel and are used here; nothing hands them back out.

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('aptuitive', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('secrets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'));
  });

async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction('secrets', mode).objectStore('secrets'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
    });
  } finally {
    db.close();
  }
}

export const getSecret = (name: string) =>
  transact<string | undefined>(
    'readonly',
    (store) => store.get(name) as IDBRequest<string | undefined>,
  );
export const setSecret = (name: string, value: string) =>
  transact('readwrite', (store) => store.put(value, name)).then(() => undefined);
export const clearSecret = (name: string) =>
  transact('readwrite', (store) => store.delete(name)).then(() => undefined);
export const secretNames = () =>
  transact<IDBValidKey[]>('readonly', (store) => store.getAllKeys()).then((keys) =>
    keys.map(String),
  );

export const clearSecrets = () =>
  transact('readwrite', (store) => store.clear()).then(() => undefined);
