/* Очередь хранится отдельно для пользователя и воркспейса; данные удаляются только после ответа сервера. */
export interface QueuedAction {
  clientId: string;
  workspaceId: string;
  userId: string;
  path: string;
  body: Record<string, unknown>;
  sequence?: number;
}

export async function flushQueue(actions: QueuedAction[], send: (action: QueuedAction) => Promise<unknown>, remove: (id: string) => Promise<void>) {
  for (const action of actions) {
    try {
      await send(action);
    } catch {
      break;
    }
    await remove(action.clientId);
  }
}

const db = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('gr8r-driver', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('actions', { keyPath: 'sequence', autoIncrement: true });
      store.createIndex('clientId', 'clientId', { unique: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('actions', mode);
    const request = run(transaction.objectStore('actions'));
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}
export const enqueue = (action: QueuedAction) => operation('readwrite', store => store.add(action));
export async function removeQueued(id: string): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('actions', 'readwrite');
    const store = transaction.objectStore('actions');
    const request = store.index('clientId').getKey(id);
    request.onsuccess = () => {
      if (request.result !== undefined) store.delete(request.result);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}
export async function queuedFor(workspaceId: string, userId: string) {
  const all = await operation<QueuedAction[]>('readonly', store => store.getAll());
  return all.filter(a => a.workspaceId === workspaceId && a.userId === userId).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}
