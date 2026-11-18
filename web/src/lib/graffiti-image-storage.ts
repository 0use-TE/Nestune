import type { StencilImage } from './graffiti-image';

const storeName = 'imports';
let database: Promise<IDBDatabase> | undefined;

function openImageStorage() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nestune-graffiti', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

export async function loadStencilImage(user: number) {
  const db = await openImageStorage();
  return new Promise<StencilImage | null>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(user);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStencilImage(user: number, image: StencilImage | null) {
  const db = await openImageStorage();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    const store = transaction.objectStore(storeName);
    if (image) store.put(image, user);
    else store.delete(user);
  });
}
