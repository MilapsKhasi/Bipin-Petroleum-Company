// Deprecated sync engine - Cloud sync has been replaced with local automated and manual backup system
import { executeManualBackup, getBackupConfig, saveBackupConfig, BackupFrequency, BackupFormat } from './backupEngine';

export interface SyncStatusInfo {
  isOnline: boolean;
  state: string;
  pendingCount: number;
  lastSyncedAt: Date | null;
  lastError: string | null;
}

export const subscribeSyncStatus = (cb: (status: SyncStatusInfo) => void) => {
  return () => {};
};

export const getSyncStatus = (): SyncStatusInfo => ({
  isOnline: true,
  state: 'OFFLINE_LOCAL',
  pendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
});

export const syncAllIDBToSupabase = async () => {
  return { success: true, message: 'Cloud sync removed. Data is stored safely on local device with automated backup.' };
};

export const processOfflineSyncQueue = async () => {};
export const enqueueOfflineOp = async () => {};
export const clearSyncedQueue = async () => {};
export const getPendingSyncQueue = async () => [];
