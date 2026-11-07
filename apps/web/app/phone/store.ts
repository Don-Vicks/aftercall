import { isPhonePairing, type PhonePairing } from "@aftercall/core";

/**
 * The phone's one record, in IndexedDB (database `aftercall-phone`, store `pairing`):
 * docs/design/phone-protocol.md, section 6. Every access is wrapped: a private window or
 * blocked storage gives `kept: false`, and the page still works until it's closed.
 */
const DB = "aftercall-phone";
const STORE = "pairing";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    } catch (e) {
      reject(e);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The stored pairing, or null when there is none or storage can't be read. */
export async function loadPairing(): Promise<PhonePairing | null> {
  try {
    const value = await run("readonly", (s) => s.get(KEY));
    return isPhonePairing(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the pairing. False when this browser won't keep it. */
export async function savePairing(p: PhonePairing): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put(p, KEY));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the pairing: the keys, the token and the last snapshot. */
export async function clearPairing(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    // Nothing kept, nothing to clear.
  }
}
