import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, CheckCircle2, Clock, RefreshCw, AlertTriangle, Cloud } from 'lucide-react';
import { subscribeSyncStatus, SyncStatusInfo, processOfflineSyncQueue } from '../lib/syncEngine';

export const SyncStatusBadge: React.FC = () => {
  const [syncInfo, setSyncInfo] = useState<SyncStatusInfo>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    state: 'ONLINE',
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null
  });
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeSyncStatus((info) => {
      setSyncInfo(info);
    });
    return unsubscribe;
  }, []);

  const handleManualSync = async () => {
    if (isManualSyncing || !syncInfo.isOnline) return;
    setIsManualSyncing(true);
    try {
      await processOfflineSyncQueue();
    } catch (err) {
      console.warn('[SyncStatusBadge] Manual sync error:', err);
    } finally {
      setIsManualSyncing(false);
    }
  };

  const renderBadgeContent = () => {
    if (!syncInfo.isOnline) {
      return (
        <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 font-bold rounded-full text-[11px] tracking-tight">
          <WifiOff className="w-3.5 h-3.5 text-red-500" />
          <span>Offline</span>
          {syncInfo.pendingCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 bg-red-500 text-white rounded-full text-[9px] font-extrabold">
              {syncInfo.pendingCount}
            </span>
          )}
        </span>
      );
    }

    if (syncInfo.state === 'SYNCING' || isManualSyncing) {
      return (
        <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 font-bold rounded-full text-[11px] tracking-tight">
          <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />
          <span>Syncing...</span>
        </span>
      );
    }

    if (syncInfo.state === 'SYNC_FAILED') {
      return (
        <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 font-bold rounded-full text-[11px] tracking-tight cursor-pointer hover:bg-amber-500/20 transition-colors" onClick={handleManualSync}>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Sync Failed</span>
          {syncInfo.pendingCount > 0 && (
            <span className="ml-0.5 text-[10px] opacity-80">({syncInfo.pendingCount} left)</span>
          )}
        </span>
      );
    }

    if (syncInfo.pendingCount > 0 || syncInfo.state === 'PENDING_SYNC') {
      return (
        <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 font-bold rounded-full text-[11px] tracking-tight cursor-pointer hover:bg-amber-500/20 transition-colors" onClick={handleManualSync}>
          <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
          <span>Pending Sync ({syncInfo.pendingCount})</span>
        </span>
      );
    }

    // Default Synced / Online state
    return (
      <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold rounded-full text-[11px] tracking-tight cursor-pointer hover:bg-emerald-500/20 transition-colors" onClick={handleManualSync}>
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
        <span>Synced</span>
      </span>
    );
  };

  const formattedLastSynced = syncInfo.lastSyncedAt
    ? new Date(syncInfo.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Never in this session';

  return (
    <div className="relative inline-block" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      <button 
        type="button" 
        onClick={handleManualSync}
        className="focus:outline-none transition-transform active:scale-95"
        title="Click to process pending offline sync queue"
      >
        {renderBadgeContent()}
      </button>

      {showTooltip && (
        <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-slate-900 text-white text-xs rounded-lg shadow-xl z-50 border border-slate-700 animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2 mb-2 font-bold text-slate-200">
            <span className="flex items-center gap-1.5">
              <Cloud className="w-4 h-4 text-primary" />
              Offline Sync Status
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${syncInfo.isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
              {syncInfo.isOnline ? 'Online' : 'Offline'}
            </span>
          </div>

          <div className="space-y-1.5 text-slate-300 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">Queue Items:</span>
              <span className="font-mono font-bold text-white">{syncInfo.pendingCount} pending</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Last Synced:</span>
              <span className="font-mono text-slate-200">{formattedLastSynced}</span>
            </div>
            {syncInfo.lastError && (
              <div className="mt-2 p-1.5 bg-red-950/60 border border-red-800/80 rounded text-red-300 text-[10px] font-mono break-all">
                {syncInfo.lastError}
              </div>
            )}
          </div>

          {syncInfo.isOnline && syncInfo.pendingCount > 0 && (
            <button
              onClick={handleManualSync}
              disabled={isManualSyncing}
              className="mt-2.5 w-full py-1 bg-primary text-white font-bold text-[11px] rounded hover:bg-primary/90 transition-colors flex items-center justify-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${isManualSyncing ? 'animate-spin' : ''}`} />
              <span>Sync Now</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SyncStatusBadge;
