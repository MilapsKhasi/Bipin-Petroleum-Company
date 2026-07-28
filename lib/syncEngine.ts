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
}

const SYNC_QUEUE_KEY = 'offline_pending_ops_queue';

export async function getPendingSyncQueue(): Promise<PendingSyncOp[]> {
  try {
    const items = await getAllFromIDB('sync_queue' as IDBStoreName);
    if (items && Array.isArray(items) && items.length > 0) {
      return items as PendingSyncOp[];
    }
  } catch {}

  const raw = localStorage.getItem(SYNC_QUEUE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  return [];
}

export async function savePendingSyncQueue(queue: PendingSyncOp[]): Promise<void> {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch {}

  try {
    for (const item of queue) {
      await upsertToIDB('sync_queue' as IDBStoreName, item);
    }
  } catch {}
}

export async function removeQueueItem(id: string): Promise<void> {
  const queue = await getPendingSyncQueue();
  const updated = queue.filter((q) => q.id !== id);
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(updated));
  } catch {}
  await deleteFromIDB('sync_queue' as IDBStoreName, id);
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
        // Created offline and deleted offline before syncing to cloud: purge completely!
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
      id: `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
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
      id: `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
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
    return { success: true, processedCount: 0, remainingCount: 0 };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, processedCount: 0, remainingCount: -1 };
  }

  isSyncingQueue = true;

  try {
    const { data: userData, error: userErr } = await realSupabase.auth.getUser();
    if (userErr || !userData?.user) {
      isSyncingQueue = false;
      return { success: false, processedCount: 0, remainingCount: -1 };
    }

    const currentUserId = userData.user.id;

    // Fetch user's accessible workspace IDs for Workspace Isolation (Requirement 8)
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

      console.log(`[Sync Engine] Processing ${item.op} on ${item.table} (ID: ${item.recordId})...`);

      try {
        let opError = null;

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

          const { error } = await realSupabase
            .from(item.table)
            .upsert([cleanPayload], { onConflict: 'id' });
          opError = error;
        }

        if (opError) {
          console.warn(`[Sync Engine] Op failed for ${item.table} (${item.recordId}):`, opError);
          item.status = 'FAILED';
          item.retryCount = (item.retryCount || 0) + 1;
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
      } catch (err) {
        console.warn(`[Sync Engine] Exception syncing item ${item.id}:`, err);
        break;
      }
    }

    const remainingQueue = await getPendingSyncQueue();
    isSyncingQueue = false;

    return {
      success: true,
      processedCount,
      remainingCount: remainingQueue.length
    };
  } catch (err) {
    console.warn('[Sync Engine] Queue processing error:', err);
    isSyncingQueue = false;
    return { success: false, processedCount: 0, remainingCount: -1 };
  }
}

// Auto listener for returning online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Sync Engine] Network status: ONLINE. Processing queue in background...');
    processOfflineSyncQueue().catch((err) => console.warn('[Sync Engine] Background sync error:', err));
  });

  // Background interval check every 30 seconds
  setInterval(() => {
    if (navigator.onLine && localStorage.getItem('use_offline_mode') !== 'true') {
      processOfflineSyncQueue().catch(() => {});
    }
  }, 30000);
}
