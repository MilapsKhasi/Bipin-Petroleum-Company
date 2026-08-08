import { realSupabase } from './supabase';
import { 
  getAllFromIDB, 
  upsertToIDB, 
  deleteFromIDB, 
  IDBStoreName 
} from './idb';

export interface PendingSyncOp {
  id: string; // queue item ID
  table: string; // e.g. 'sales_invoices'
  op: 'INSERT' | 'UPDATE' | 'UPSERT' | 'DELETE';
  recordId: string; // PK of record
  payload?: any;
  company_id?: string;
  userId?: string;
  timestamp: number;
  status: 'PENDING' | 'SYNCING' | 'FAILED';
  retryCount: number;
  lastError?: string;
}

export type SyncState = 'ONLINE' | 'OFFLINE' | 'SYNCED' | 'PENDING_SYNC' | 'SYNCING' | 'SYNC_FAILED';

export interface SyncStatusInfo {
  isOnline: boolean;
  state: SyncState;
  pendingCount: number;
  lastSyncedAt: Date | null;
  lastError: string | null;
}

const SYNC_QUEUE_KEY = 'offline_pending_ops_queue';
const LAST_SYNCED_KEY = 'offline_last_synced_time';

let currentSyncState: SyncState = (typeof navigator !== 'undefined' && !navigator.onLine) ? 'OFFLINE' : 'SYNCED';
let lastSyncedAt: Date | null = (() => {
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(LAST_SYNCED_KEY);
  return stored ? new Date(parseInt(stored, 10)) : null;
})();
let lastSyncError: string | null = null;
const statusListeners = new Set<(info: SyncStatusInfo) => void>();

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function notifySyncStatus() {
  getPendingSyncQueue().then((queue) => {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const pendingCount = queue.length;

    let computedState: SyncState = currentSyncState;

    if (!isOnline) {
      computedState = 'OFFLINE';
    } else if (isSyncingQueue) {
      computedState = 'SYNCING';
    } else if (lastSyncError && pendingCount > 0) {
      computedState = 'SYNC_FAILED';
    } else if (pendingCount > 0) {
      computedState = 'PENDING_SYNC';
    } else {
      computedState = 'SYNCED';
    }

    const info: SyncStatusInfo = {
      isOnline,
      state: computedState,
      pendingCount,
      lastSyncedAt,
      lastError: lastSyncError
    };

    statusListeners.forEach((listener) => {
      try {
        listener(info);
      } catch (err) {
        console.error('[SyncEngine] Status listener error:', err);
      }
    });
  }).catch(() => {});
}

export function subscribeSyncStatus(callback: (info: SyncStatusInfo) => void): () => void {
  statusListeners.add(callback);
  notifySyncStatus();
  return () => {
    statusListeners.delete(callback);
  };
}

export async function getPendingSyncQueue(): Promise<PendingSyncOp[]> {
  try {
    const items = await getAllFromIDB('sync_queue' as IDBStoreName);
    if (items && Array.isArray(items) && items.length > 0) {
      return items as PendingSyncOp[];
    }
  } catch {}

  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SYNC_QUEUE_KEY) : null;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  return [];
}

export async function savePendingSyncQueue(queue: PendingSyncOp[]): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch {}

  try {
    for (const item of queue) {
      await upsertToIDB('sync_queue' as IDBStoreName, item);
    }
  } catch {}

  notifySyncStatus();
}

export async function removeQueueItem(id: string): Promise<void> {
  const queue = await getPendingSyncQueue();
  const updated = queue.filter((q) => q.id !== id);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(updated));
    }
  } catch {}
  await deleteFromIDB('sync_queue' as IDBStoreName, id);
  notifySyncStatus();
}

export async function enqueueOfflineOp(params: {
  table: string;
  op: 'INSERT' | 'UPDATE' | 'UPSERT' | 'DELETE';
  recordId: string;
  payload?: any;
  company_id?: string;
  userId?: string;
}) {
  if (!params.table || !params.recordId) return;

  const queue = await getPendingSyncQueue();
  const existingIdx = queue.findIndex(
    (q) => q.table === params.table && String(q.recordId) === String(params.recordId)
  );

  const cid = params.company_id || params.payload?.company_id || (typeof window !== 'undefined' ? localStorage.getItem('activeCompanyId') : undefined);
  const uid = params.userId || params.payload?.created_by || params.payload?.user_id;

  if (params.op === 'DELETE') {
    if (existingIdx !== -1) {
      const existing = queue[existingIdx];
      if (existing.op === 'INSERT') {
        // Created offline and deleted offline before syncing: purge completely
        await removeQueueItem(existing.id);
        return;
      }
      existing.op = 'DELETE';
      delete existing.payload;
      existing.timestamp = Date.now();
      existing.status = 'PENDING';
      await savePendingSyncQueue(queue);
      return;
    }

    const newItem: PendingSyncOp = {
      id: `sync_${generateUUID()}`,
      table: params.table,
      op: 'DELETE',
      recordId: params.recordId,
      company_id: cid || undefined,
      userId: uid || undefined,
      timestamp: Date.now(),
      status: 'PENDING',
      retryCount: 0
    };
    queue.push(newItem);
    await savePendingSyncQueue(queue);
    return;
  }

  // Handle INSERT / UPDATE / UPSERT
  const payloadToSave = { ...params.payload, id: params.recordId };
  if (cid) payloadToSave.company_id = cid;

  if (existingIdx !== -1) {
    const existing = queue[existingIdx];
    existing.payload = { ...existing.payload, ...payloadToSave };
    existing.op = existing.op === 'INSERT' ? 'INSERT' : 'UPSERT';
    existing.timestamp = Date.now();
    existing.status = 'PENDING';
  } else {
    const newItem: PendingSyncOp = {
      id: `sync_${generateUUID()}`,
      table: params.table,
      op: params.op,
      recordId: params.recordId,
      payload: payloadToSave,
      company_id: cid || undefined,
      userId: uid || undefined,
      timestamp: Date.now(),
      status: 'PENDING',
      retryCount: 0
    };
    queue.push(newItem);
  }

  await savePendingSyncQueue(queue);
}

let isSyncingQueue = false;

export async function processOfflineSyncQueue(): Promise<{
  success: boolean;
  processedCount: number;
  remainingCount: number;
}> {
  if (isSyncingQueue) {
    return { success: false, processedCount: 0, remainingCount: -1 };
  }

  if (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true') {
    notifySyncStatus();
    return { success: true, processedCount: 0, remainingCount: 0 };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    currentSyncState = 'OFFLINE';
    notifySyncStatus();
    return { success: false, processedCount: 0, remainingCount: -1 };
  }

  isSyncingQueue = true;
  currentSyncState = 'SYNCING';
  notifySyncStatus();

  try {
    const { data: userData, error: userErr } = await realSupabase.auth.getUser();
    if (userErr || !userData?.user) {
      isSyncingQueue = false;
      notifySyncStatus();
      return { success: false, processedCount: 0, remainingCount: -1 };
    }

    const currentUserId = userData.user.id;

    // Fetch user's accessible workspace IDs for Workspace Isolation
    const { data: userCompanies } = await realSupabase
      .from('companies')
      .select('id')
      .or(`created_by.eq.${currentUserId},user_id.eq.${currentUserId}`);

    const allowedCompanyIds = new Set(
      (userCompanies || []).map((c: any) => String(c.id)).filter(Boolean)
    );

    let queue = await getPendingSyncQueue();
    if (!queue.length) {
      isSyncingQueue = false;
      lastSyncedAt = new Date();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_SYNCED_KEY, String(lastSyncedAt.getTime()));
      }
      lastSyncError = null;
      currentSyncState = 'SYNCED';
      notifySyncStatus();
      return { success: true, processedCount: 0, remainingCount: 0 };
    }

    // Sort queue items chronologically
    queue.sort((a, b) => a.timestamp - b.timestamp);

    let processedCount = 0;

    for (const item of [...queue]) {
      // Workspace Isolation check
      if (item.table !== 'profiles' && item.table !== 'companies') {
        const itemCompanyId = item.company_id || item.payload?.company_id;
        if (itemCompanyId && allowedCompanyIds.size > 0 && !allowedCompanyIds.has(String(itemCompanyId))) {
          console.warn(`[Sync Engine] Skipping item ${item.id} (${item.table}). Workspace ${itemCompanyId} does not belong to logged-in user.`);
          continue;
        }
      }

      console.log(`[Sync Engine] Syncing ${item.op} on ${item.table} (ID: ${item.recordId})...`);

      try {
        let opError: any = null;

        if (item.op === 'DELETE') {
          const { error } = await realSupabase
            .from(item.table)
            .delete()
            .eq('id', item.recordId);
          opError = error;
        } else {
          // INSERT / UPDATE / UPSERT
          const cleanPayload = { ...item.payload };
          delete cleanPayload.ghostColumns;
          delete cleanPayload.displayDate;
          delete cleanPayload.type;

          const isUuid = (str: any) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
          if (cleanPayload.id && !isUuid(cleanPayload.id)) {
            const newUuid = generateUUID();
            console.log(`[Sync Engine] Converting legacy non-UUID id '${cleanPayload.id}' to valid UUID '${newUuid}' for ${item.table}`);
            cleanPayload.id = newUuid;
            item.recordId = newUuid;
            if (item.payload) item.payload.id = newUuid;
          } else if (!cleanPayload.id) {
            cleanPayload.id = generateUUID();
            item.recordId = cleanPayload.id;
            if (item.payload) item.payload.id = cleanPayload.id;
          }

          const { error } = await realSupabase
            .from(item.table)
            .upsert([cleanPayload], { onConflict: 'id' });
          opError = error;
        }

        if (opError) {
          console.warn(`[Sync Engine] Op failed for ${item.table} (${item.recordId}):`, opError);
          item.status = 'FAILED';
          item.retryCount = (item.retryCount || 0) + 1;
          item.lastError = opError.message || String(opError);
          lastSyncError = item.lastError || 'Unknown error';
          await savePendingSyncQueue(queue);
          break; // Partial failure recovery: stop loop, remaining items retry next time
        } else {
          // Successful upload! Immediately remove item from queue
          console.log(`[Sync Engine] Successfully synced ${item.table} (${item.recordId}).`);
          await removeQueueItem(item.id);
          processedCount++;
          if (item.payload && item.op !== 'DELETE') {
            await upsertToIDB(item.table as IDBStoreName, item.payload);
          }
        }
      } catch (err: any) {
        console.warn(`[Sync Engine] Exception syncing item ${item.id}:`, err);
        lastSyncError = err.message || 'Network exception during sync';
        break;
      }
    }

    const remainingQueue = await getPendingSyncQueue();
    isSyncingQueue = false;

    if (remainingQueue.length === 0) {
      lastSyncedAt = new Date();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_SYNCED_KEY, String(lastSyncedAt.getTime()));
      }
      lastSyncError = null;
      currentSyncState = 'SYNCED';
    } else {
      currentSyncState = lastSyncError ? 'SYNC_FAILED' : 'PENDING_SYNC';
    }

    notifySyncStatus();

    return {
      success: true,
      processedCount,
      remainingCount: remainingQueue.length
    };
  } catch (err: any) {
    console.warn('[Sync Engine] Queue processing error:', err);
    isSyncingQueue = false;
    lastSyncError = err.message || 'Failed processing queue';
    currentSyncState = 'SYNC_FAILED';
    notifySyncStatus();
    return { success: false, processedCount: 0, remainingCount: -1 };
  }
}

// Auto listener for returning online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Sync Engine] Network status: ONLINE. Processing queue in background...');
    currentSyncState = 'SYNCING';
    notifySyncStatus();
    processOfflineSyncQueue().catch((err) => console.warn('[Sync Engine] Background sync error:', err));
  });

  window.addEventListener('offline', () => {
    console.log('[Sync Engine] Network status: OFFLINE.');
    currentSyncState = 'OFFLINE';
    notifySyncStatus();
  });

  // Background interval check every 30 seconds
  setInterval(() => {
    if (navigator.onLine && localStorage.getItem('use_offline_mode') !== 'true') {
      processOfflineSyncQueue().catch(() => {});
    }
  }, 30000);
}

