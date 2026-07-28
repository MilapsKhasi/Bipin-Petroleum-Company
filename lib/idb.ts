// IndexedDB Engine for Purchase Master App Offline Resilience

const DB_NAME = 'PurchaseMasterIDB';
const DB_VERSION = 2;

export const IDB_STORES = [
  'users',
  'profiles',
  'companies',
  'sales_invoices',
  'purchase_bills',
  'customers',
  'vendors',
  'stock_items',
  'cashbook',
  'cashbooks',
  'duties_taxes',
  'delivery_challans',
  'payment_vouchers',
  'sync_queue',
  'meta'
] as const;

export type IDBStoreName = (typeof IDB_STORES)[number];

// In-memory cache for ultra-fast synchronous queries by MockBuilder
export const idbMemoryCache: Record<string, any[]> = {};
let dbPromise: Promise<IDBDatabase> | null = null;
let isInitialized = false;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      IDB_STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          if (store === 'meta') {
            db.createObjectStore(store, { keyPath: 'key' });
          } else {
            db.createObjectStore(store, { keyPath: 'id' });
          }
        }
      });
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('[IndexedDB] Failed to open database:', (event.target as IDBOpenDBRequest).error);
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

export async function initIndexedDB(): Promise<Record<string, any[]>> {
  if (isInitialized) return idbMemoryCache;

  try {
    const db = await openDB();
    for (const store of IDB_STORES) {
      if (store === 'meta') continue;
      idbMemoryCache[store] = await getAllFromIDB(store);
    }
    isInitialized = true;
    console.log('[IndexedDB] Initialized memory cache with local stored data.');
  } catch (err) {
    console.warn('[IndexedDB] Fallback to empty memory cache:', err);
    IDB_STORES.forEach((store) => {
      if (store !== 'meta' && !idbMemoryCache[store]) {
        idbMemoryCache[store] = [];
      }
    });
  }

  return idbMemoryCache;
}

export async function getAllFromIDB(storeName: IDBStoreName): Promise<any[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Error reading ${storeName}:`, err);
    return idbMemoryCache[storeName] || [];
  }
}

export async function saveAllToIDB(storeName: IDBStoreName, items: any[]): Promise<void> {
  // Update in-memory cache first
  idbMemoryCache[storeName] = items;

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      // Clear existing records in store before replacing
      store.clear();

      items.forEach((item) => {
        if (item && typeof item === 'object') {
          const itemToSave = item.id ? item : { ...item, id: Math.random().toString(36).substring(2, 15) };
          store.put(itemToSave);
        }
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Error saving all to ${storeName}:`, err);
  }
}

export async function upsertToIDB(storeName: IDBStoreName, itemOrItems: any | any[]): Promise<void> {
  const newItems = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
  if (!newItems.length) return;

  const current = idbMemoryCache[storeName] || [];
  const updatedList = [...current];

  newItems.forEach((newItem) => {
    if (!newItem || typeof newItem !== 'object') return;
    const itemId = newItem.id || Math.random().toString(36).substring(2, 15);
    const itemWithId = { ...newItem, id: itemId };

    const idx = updatedList.findIndex((it) => String(it.id) === String(itemId));
    if (idx !== -1) {
      updatedList[idx] = { ...updatedList[idx], ...itemWithId };
    } else {
      updatedList.push(itemWithId);
    }
  });

  idbMemoryCache[storeName] = updatedList;

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      newItems.forEach((item) => {
        if (item && typeof item === 'object') {
          const itemId = item.id || Math.random().toString(36).substring(2, 15);
          store.put({ ...item, id: itemId });
        }
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Error upserting to ${storeName}:`, err);
  }
}

export async function deleteFromIDB(storeName: IDBStoreName, id: string): Promise<void> {
  if (idbMemoryCache[storeName]) {
    idbMemoryCache[storeName] = idbMemoryCache[storeName].filter((it) => String(it.id) !== String(id));
  }

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.delete(id);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Error deleting from ${storeName}:`, err);
  }
}

export async function setMetaIDB(key: string, value: any): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      store.put({ key, value });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Error setting meta ${key}:`, err);
  }
}

export async function getMetaIDB(key: string): Promise<any> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly');
      const store = tx.objectStore('meta');
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Error getting meta ${key}:`, err);
    return null;
  }
}
