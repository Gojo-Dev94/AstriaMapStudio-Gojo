import type { MapDocument } from './domain.ts';
const DB = 'astria-modern-editor';
const STORE = 'drafts';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function putDraft(map: MapDocument): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put({ id: map.id, map, savedAt: Date.now() }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}
export async function getDraft(id: number): Promise<{ map: MapDocument; savedAt: number } | null> {
  const db = await open();
  const value = await new Promise<{ map: MapDocument; savedAt: number } | null>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id); req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error);
  });
  db.close(); return value;
}
export async function deleteDraft(id: number): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}
