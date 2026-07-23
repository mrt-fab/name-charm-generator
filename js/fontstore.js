// fontstore.js — local-only persistence for user-loaded fonts (IndexedDB).
// Nothing here ever leaves the browser; this is convenience caching, not distribution.

const DB_NAME = 'ncg-fonts';
const STORE = 'fonts';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function saveUserFont(name, arrayBuffer) {
  return tx('readwrite', (s) => s.add({ name, data: arrayBuffer }));
}

export async function loadUserFonts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteUserFont(key) {
  return tx('readwrite', (s) => s.delete(key));
}
