import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Save, 
  Loader2, 
  Trash2, 
  Building2, 
  MapPin, 
  Fingerprint, 
  Moon, 
  Sun, 
  Percent, 
  CheckCircle2, 
  RotateCcw, 
  ShieldCheck, 
  BadgeCheck, 
  Download, 
  FileSpreadsheet, 
  FileCode, 
  Clock, 
  Upload, 
  Check, 
  Layers, 
  Database, 
  Calendar, 
  Zap, 
  FileText,
  AlertCircle
} from 'lucide-react';
import { getActiveCompanyId, safeSupabaseSave, getAppSettings, formatDate } from '../utils/helpers';
import { supabase } from '../lib/supabase';
import { 
  getBackupConfig, 
  saveBackupConfig, 
  getBackupHistory, 
  executeManualBackup, 
  restoreDatabaseFromJson, 
  getPopulatedWorkspaceData, 
  subscribeBackupEvents, 
  BackupConfig, 
  BackupFrequency, 
  BackupFormat, 
  MODULE_DISPLAY_NAMES,
  WorkspaceBackupData 
} from '../lib/backupEngine';
import ConfirmDialog from '../components/ConfirmDialog';

const Settings = () => {
  const navigate = useNavigate();
  const cid = getActiveCompanyId();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceInfo, setWorkspaceInfo] = useState({ name: '', gstin: '', address: '' });
  const [theme, setTheme] = useState(() => localStorage.getItem('app_theme') || 'light');
  
  const [gstConfig, setGstConfig] = useState(() => {
    const s = getAppSettings();
    return { enabled: s.gstEnabled, type: s.gstType || 'CGST - SGST' };
  });

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [licenseId, setLicenseId] = useState('26401');
  
  // Backup Engine State
  const [backupConfig, setBackupConfig] = useState<BackupConfig>(getBackupConfig());
  const [backupHistory, setBackupHistory] = useState(getBackupHistory());
  const [workspaceData, setWorkspaceData] = useState<WorkspaceBackupData | null>(null);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [backupActionMsg, setBackupActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Recycle Bin State
  const [recycleTab, setRecycleTab] = useState('All');
  const [deletedItems, setDeletedItems] = useState<any[]>([]);
  const [recycleLoading, setRecycleLoading] = useState(false);

  const recycleTabs = [
    'All', 'Workspace', 'Sales Invoices', 'Purchase Bills', 
    'Customers', 'Vendors', 'Stock Master', 'Cashbook', 'Additional Charges'
  ];

  const refreshBackupData = async () => {
    try {
      setBackupConfig(getBackupConfig());
      setBackupHistory(getBackupHistory());
      const data = await getPopulatedWorkspaceData(cid || undefined);
      setWorkspaceData(data);
    } catch (err) {
      console.warn('[Settings] Failed to refresh backup data:', err);
    }
  };

  const loadProfile = async () => {
    if (!cid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.from('companies').select('*').eq('id', cid).single();
      if (error) throw error;
      if (data) {
        setWorkspaceInfo({ name: data.name || '', gstin: data.gstin || '', address: data.address || '' });
      }

      const settings = getAppSettings();
      setGstConfig({
        enabled: settings.gstEnabled,
        type: settings.gstType || 'CGST - SGST'
      });
      
      const { data: allCompanies } = await supabase
        .from('companies')
        .select('id, created_at')
        .eq('is_deleted', false)
        .order('created_at', { ascending: true });
      
      if (allCompanies) {
        const index = allCompanies.findIndex((c: any) => c.id === cid);
        if (index !== -1) {
          setLicenseId(`${26401 + index}`);
        }
      }

      await refreshBackupData();
      await fetchRecycleData();
    } catch (err) {
      console.error("Settings load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecycleData = async () => {
    if (!cid) return;
    setRecycleLoading(true);
    
    try {
      const queries = [
        supabase.from('companies').select('id, name, created_at').eq('is_deleted', true).eq('id', cid), 
        supabase.from('companies').select('id, name, created_at').eq('is_deleted', true).not('id', 'eq', cid), 
        supabase.from('sales_invoices').select('id, invoice_number, customer_name, date').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('purchase_bills').select('id, bill_number, vendor_name, date').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('vendors').select('id, name, party_type, is_customer').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('stock_items').select('id, name').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('cashbooks').select('id, date').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('duties_taxes').select('id, name').eq('is_deleted', true).eq('company_id', cid),
        supabase.from('customers').select('id, name, party_type, is_customer').eq('is_deleted', true).eq('company_id', cid)
      ];

      const results = await Promise.all(queries) as any[];
      const allItems: any[] = [];
      
      results[0].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Workspace', label: i.name, table: 'companies' }));
      results[1].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Workspace', label: i.name, table: 'companies' }));
      results[2].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Sales Invoices', label: `${i.invoice_number} (${i.customer_name})`, table: 'sales_invoices' }));
      results[3].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Purchase Bills', label: `${i.bill_number} (${i.vendor_name})`, table: 'purchase_bills' }));
      results[4].data?.forEach((i: any) => {
        allItems.push({ ...i, origin: 'Vendors', label: i.name, table: 'vendors' });
      });
      results[5].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Stock Master', label: i.name, table: 'stock_items' }));
      results[6].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Cashbook', label: `Statement ${i.date}`, table: 'cashbooks' }));
      results[7].data?.forEach((i: any) => allItems.push({ ...i, origin: 'Additional Charges', label: i.name, table: 'duties_taxes' }));
      results[8].data?.forEach((i: any) => {
        allItems.push({ ...i, origin: 'Customers', label: i.name, table: 'customers' });
      });

      setDeletedItems(allItems);
    } catch (err) {
      console.error("Recycle fetch error:", err);
    } finally {
      setRecycleLoading(false);
    }
  };

  useEffect(() => { 
    loadProfile(); 
    const unsub = subscribeBackupEvents(() => {
      refreshBackupData();
    });
    return () => unsub();
  }, [cid]);

  const handleUpdateFrequency = (freq: BackupFrequency) => {
    const updated = saveBackupConfig({ frequency: freq });
    setBackupConfig(updated);
    setBackupActionMsg({
      type: 'success',
      text: `Auto-backup frequency updated to: ${getFrequencyDisplay(freq)}`
    });
  };

  const handleUpdateFormat = (format: BackupFormat) => {
    const updated = saveBackupConfig({ format });
    setBackupConfig(updated);
    setBackupActionMsg({
      type: 'success',
      text: `Default backup format updated to: ${format.toUpperCase()}`
    });
  };

  const handleToggleAutoDownload = () => {
    const nextVal = !backupConfig.autoDownload;
    const updated = saveBackupConfig({ autoDownload: nextVal });
    setBackupConfig(updated);
    setBackupActionMsg({
      type: 'success',
      text: nextVal ? 'Automatic browser download enabled for scheduled backups.' : 'Silent background backup enabled (no popup download).'
    });
  };

  const handleManualBackup = async (format: BackupFormat) => {
    setIsExporting(format);
    setBackupActionMsg(null);
    try {
      const res = await executeManualBackup(format, { autoDownload: true });
      setBackupActionMsg({
        type: 'success',
        text: `Exported ${res.totalRecords} records across ${res.totalModules} active modules to ${res.filename}!`
      });
      await refreshBackupData();
    } catch (err: any) {
      setBackupActionMsg({
        type: 'error',
        text: `Backup failed: ${err.message || 'Error creating file'}`
      });
    } finally {
      setIsExporting(null);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(`Are you sure you want to restore data from "${file.name}"? This will import records into your local database.`)) {
      e.target.value = '';
      return;
    }

    setIsRestoring(true);
    setBackupActionMsg(null);
    try {
      const res = await restoreDatabaseFromJson(file);
      setBackupActionMsg({
        type: 'success',
        text: res.message
      });
      await refreshBackupData();
      await fetchRecycleData();
    } catch (err: any) {
      setBackupActionMsg({
        type: 'error',
        text: `Restore failed: ${err.message || 'Invalid backup file'}`
      });
    } finally {
      setIsRestoring(false);
      e.target.value = '';
    }
  };

  const handleRecover = async (item: any) => {
    try {
      const { error } = await supabase.from(item.table).update({ is_deleted: false }).eq('id', item.id);
      if (error) throw error;
      await fetchRecycleData();
      await refreshBackupData();
      window.dispatchEvent(new Event('appSettingsChanged'));
    } catch (err: any) {
      alert("Recovery failed: " + err.message);
    }
  };

  const handlePermanentDelete = async (item: any) => {
    if (!confirm(`Permanently delete "${item.label}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from(item.table).delete().eq('id', item.id);
      if (error) throw error;
      await fetchRecycleData();
      await refreshBackupData();
    } catch (err: any) {
      alert("Delete failed: " + err.message);
    }
  };

  const applyTheme = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('app_theme', newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    window.dispatchEvent(new Event('appSettingsChanged'));
  };

  const toggleGST = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    const newEnabled = !gstConfig.enabled;
    const newConfig = { ...gstConfig, enabled: newEnabled };
    setGstConfig(newConfig);
    
    if (cid) {
      const currentSettings = getAppSettings();
      const updatedSettings = { 
        ...currentSettings, 
        gstEnabled: newEnabled, 
        gstType: newConfig.type 
      };
      localStorage.setItem(`appSettings_${cid}`, JSON.stringify(updatedSettings));
      window.dispatchEvent(new Event('appSettingsChanged'));
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cid) return;
    setSaving(true);
    try {
      await safeSupabaseSave('companies', workspaceInfo, cid);
      localStorage.setItem('activeCompanyName', workspaceInfo.name);

      const currentSettings = getAppSettings();
      const updatedSettings = { 
        ...currentSettings, 
        gstEnabled: gstConfig.enabled, 
        gstType: gstConfig.type 
      };
      localStorage.setItem(`appSettings_${cid}`, JSON.stringify(updatedSettings));

      if (gstConfig.enabled) {
        const ledgersToEnsure = gstConfig.type === 'CGST - SGST' ? ['CGST', 'SGST'] : ['IGST'];
        for (const name of ledgersToEnsure) {
          const { data: existing } = await supabase.from('duties_taxes').select('id').eq('company_id', cid).eq('name', name).eq('is_deleted', false).maybeSingle();
          if (!existing) {
            await safeSupabaseSave('duties_taxes', {
              name, type: 'Charge', calc_method: 'Fixed', fixed_amount: 0, rate: 0, apply_on: 'Subtotal', is_default: true, is_deleted: false
            });
          }
        }
      }

      window.dispatchEvent(new Event('appSettingsChanged'));
      alert("Settings updated successfully!");
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!cid) return;
    try {
      const { error } = await supabase.from('companies').update({ is_deleted: true }).eq('id', cid);
      if (error) throw error;
      localStorage.removeItem('activeCompanyId');
      localStorage.removeItem('activeCompanyName');
      navigate('/companies', { replace: true });
    } catch (err: any) {
      alert(`Delete Failed: ${err.message}`);
    }
  };

  const getFrequencyDisplay = (freq: BackupFrequency) => {
    switch (freq) {
      case 'every_transaction': return 'After Every Transaction';
      case 'daily': return 'Once a Day (Daily)';
      case 'weekly': return 'Once a Week (Weekly)';
      case 'monthly': return 'Once a Month (Monthly)';
      case 'manual_only': return 'Manual Only (Disabled)';
      default: return freq;
    }
  };

  const formatLastBackupTime = (ts: number | null | undefined) => {
    if (!ts) return 'Never';
    try {
      const d = new Date(ts);
      return `${formatDate(d.toISOString())} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return 'Never';
    }
  };

  const filteredDeleted = deletedItems.filter(item => recycleTab === 'All' || item.origin === recycleTab);

  if (loading) return <div className="py-40 text-center"><Loader2 className="w-8 h-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-5xl">
      <div className="flex flex-col text-left">
        <h1 className="text-[20px] font-medium text-slate-900 dark:text-slate-100 capitalize">Workspace & Backup Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">Configure your business profile, theme preferences, and local automated/manual backup policies.</p>
      </div>

      <form onSubmit={handleUpdate} className="space-y-6">
        {/* License Information Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden shadow-sm">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/50">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">License Information</h3>
          </div>
          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center border border-primary/20">
                  <ShieldCheck className="w-6 h-6 text-primary-dark" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Plan - <span className="text-link">Active Local License</span></h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-wider font-mono">License ID: {licenseId}</p>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 px-4 py-2 rounded-lg flex items-center">
                  <BadgeCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mr-2" />
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-tighter">Version v1.0</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Data Backup & Auto-Backup System Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden shadow-sm text-left">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">
                Data Backup & Automated Schedule
              </h3>
            </div>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded flex items-center border border-emerald-200/60 dark:border-emerald-800/60">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              {backupConfig.frequency === 'manual_only' ? 'Manual Backup Mode' : `Auto-Backup: ${getFrequencyDisplay(backupConfig.frequency)}`}
            </span>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              All application data is securely stored locally on your device. Choose when you want the system to create backups automatically, or download instant Excel and JSON exports at any time. <strong className="text-slate-700 dark:text-slate-300 font-semibold">Empty modules with 0 records are automatically skipped</strong> to keep your backups lightweight and focused.
            </p>

            {/* Notification alert */}
            {backupActionMsg && (
              <div className={`p-3.5 rounded-lg text-xs font-medium border flex items-center justify-between animate-in fade-in duration-200 ${
                backupActionMsg.type === 'success' 
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              }`}>
                <span className="flex items-center gap-2">
                  {backupActionMsg.type === 'success' ? <Check className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                  {backupActionMsg.text}
                </span>
                <button type="button" onClick={() => setBackupActionMsg(null)} className="font-bold opacity-70 hover:opacity-100 ml-4">✕</button>
              </div>
            )}

            {/* Auto-Backup Frequency Selection */}
            <div className="space-y-3">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                1. Select Auto-Backup Frequency
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  {
                    id: 'every_transaction' as BackupFrequency,
                    title: 'After Every Transaction',
                    desc: 'Instant backup whenever any invoice, bill, item or voucher is saved',
                    icon: Zap,
                    badge: 'Recommended'
                  },
                  {
                    id: 'daily' as BackupFrequency,
                    title: 'Once a Day (Daily)',
                    desc: 'Automated snapshot every 24 hours',
                    icon: Calendar,
                    badge: 'Popular'
                  },
                  {
                    id: 'weekly' as BackupFrequency,
                    title: 'Once a Week (Weekly)',
                    desc: 'Automated snapshot every 7 days',
                    icon: Clock
                  },
                  {
                    id: 'monthly' as BackupFrequency,
                    title: 'Once a Month (Monthly)',
                    desc: 'Automated snapshot every 30 days',
                    icon: Layers
                  },
                  {
                    id: 'manual_only' as BackupFrequency,
                    title: 'Manual Only',
                    desc: 'Automatic backups paused. Download manually when needed',
                    icon: ShieldCheck
                  }
                ].map((item) => {
                  const isSelected = backupConfig.frequency === item.id;
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleUpdateFrequency(item.id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                        isSelected 
                          ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 shadow-xs ring-1 ring-emerald-500/50' 
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      {item.badge && (
                        <span className="absolute top-2.5 right-2.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                          {item.badge}
                        </span>
                      )}
                      <div className="flex items-start space-x-3 mb-2">
                        <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{item.title}</h4>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{item.desc}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/60 mt-1">
                        <span className="text-[10px] text-slate-400">Status</span>
                        <span className={`text-[10px] font-bold ${isSelected ? 'text-emerald-600 dark:text-emerald-400 flex items-center gap-1' : 'text-slate-400'}`}>
                          {isSelected && <Check className="w-3 h-3" />} {isSelected ? 'Active' : 'Click to select'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Default Format & Auto-Download Preferences */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  2. Default Format for Auto-Backup
                </label>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => handleUpdateFormat('excel')}
                    className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg border text-xs font-semibold transition-all ${
                      backupConfig.format === 'excel'
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    <span>Excel Workbook (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateFormat('json')}
                    className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg border text-xs font-semibold transition-all ${
                      backupConfig.format === 'json'
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <FileCode className="w-4 h-4 text-amber-600" />
                    <span>JSON Archive (.json)</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  3. Browser Download On Schedule
                </label>
                <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850">
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">Prompt File Download</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">Trigger browser save dialog when automated backup runs</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={handleToggleAutoDownload} 
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none items-center ${backupConfig.autoDownload ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${backupConfig.autoDownload ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* Manual One-Click Export Actions */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    Manual Immediate Backup Export
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Download complete snapshot of your active database entries right now.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  disabled={isExporting !== null}
                  onClick={() => handleManualBackup('excel')}
                  className="flex items-center justify-between p-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-emerald-700/60 rounded-lg">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold">Download Excel File (.xlsx)</div>
                      <div className="text-[10px] text-emerald-100">Multi-sheet workbook with all populated data</div>
                    </div>
                  </div>
                  {isExporting === 'excel' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                </button>

                <button
                  type="button"
                  disabled={isExporting !== null}
                  onClick={() => handleManualBackup('json')}
                  className="flex items-center justify-between p-4 bg-slate-800 hover:bg-slate-900 active:bg-black text-white rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 bg-slate-700 rounded-lg">
                      <FileCode className="w-5 h-5 text-amber-300" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs font-bold">Download JSON File (.json)</div>
                      <div className="text-[10px] text-slate-300">Clean portable data archive with metadata</div>
                    </div>
                  </div>
                  {isExporting === 'json' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Real-time Workspace Data Inventory */}
            {workspaceData && (
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Layers className="w-4 h-4 text-slate-500" />
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                      Current Data Backup Scope & Inventory
                    </h4>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded">
                    {workspaceData.metadata.totalRecords} total active entries across {workspaceData.metadata.totalModules} modules
                  </span>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  The following populated modules will be packaged into your backup files. Any module with 0 records is omitted automatically:
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                  {workspaceData.metadata.modulesIncluded.map((mod) => (
                    <div key={mod} className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                        {MODULE_DISPLAY_NAMES[mod] || mod}
                      </span>
                      <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600 shadow-2xs">
                        {workspaceData.tables[mod]?.length || 0}
                      </span>
                    </div>
                  ))}
                  {workspaceData.metadata.modulesIncluded.length === 0 && (
                    <div className="col-span-full py-4 text-center text-xs text-slate-400">
                      No records created yet. Start creating invoices, parties, or stock items to automatically include them.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Restore / Import Section */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Restore from JSON Backup
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Select any previous JSON backup file to restore records directly into your workspace.
                </p>
              </div>

              <label className="inline-flex items-center justify-center px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors shrink-0 shadow-2xs">
                {isRestoring ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Upload className="w-3.5 h-3.5 mr-2" />}
                {isRestoring ? 'Restoring data...' : 'Select Backup File (.json)'}
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleRestoreFile}
                  disabled={isRestoring}
                  className="hidden"
                />
              </label>
            </div>

            {/* Backup Summary & History */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Last successful backup:</span>
                <span className="font-bold font-mono text-slate-800 dark:text-slate-200">
                  {formatLastBackupTime(backupConfig.lastBackupTimestamp)}
                </span>
              </div>

              {backupHistory.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Recent Backup History
                  </span>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {backupHistory.slice(0, 5).map((h) => (
                      <div key={h.id} className="p-2 rounded bg-slate-50 dark:bg-slate-850 border border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
                        <div className="flex items-center space-x-2 truncate">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${h.format === 'excel' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'}`}>
                            {h.format}
                          </span>
                          <span className="font-mono text-slate-700 dark:text-slate-300 truncate">{h.filename}</span>
                        </div>
                        <div className="flex items-center space-x-3 text-slate-400 shrink-0 text-[10px]">
                          <span>{h.totalRecords} records</span>
                          <span>{new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* GST Configuration Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden shadow-sm">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/50">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">GST Configuration</h3>
          </div>
          <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Enable GST</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Turn on GST calculations and automatic tax ledger generation. (Saves Automatically)</p>
              </div>
              <button 
                type="button" 
                onClick={toggleGST} 
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none items-center ${gstConfig.enabled ? 'bg-primary' : 'bg-slate-200 dark:bg-slate-700'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${gstConfig.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {gstConfig.enabled && (
              <div className="animate-in slide-in-from-top-2 duration-300 grid grid-cols-1 md:grid-cols-2 gap-8 items-center border-t border-slate-100 dark:border-slate-800 pt-8">
                <div><h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Select GST Type</h4><p className="text-xs text-slate-500 dark:text-slate-400">Ledgers will be created automatically based on your choice.</p></div>
                <div className="relative">
                  <select 
                    value={gstConfig.type} 
                    onChange={(e) => setGstConfig({ ...gstConfig, type: e.target.value })} 
                    className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded text-sm font-medium outline-none focus:border-slate-400 dark:focus:border-slate-500 appearance-none"
                  >
                    <option value="CGST - SGST" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">CGST - SGST (Intra-State)</option>
                    <option value="IGST" className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">IGST (Inter-State)</option>
                  </select>
                  <Percent className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Business Info Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden shadow-sm text-left">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/30 dark:bg-slate-900/50">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Business Information</h3>
            <button type="submit" disabled={saving} className="bg-primary text-white px-8 py-2 rounded-md font-bold text-[13px] capitalize hover:bg-primary-dark disabled:opacity-50 flex items-center shadow-sm">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Save Changes
            </button>
          </div>
          <div className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-1.5"><label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Legal Business Name</label><div className="relative"><Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600" /><input required value={workspaceInfo.name} onChange={(e) => setWorkspaceInfo({...workspaceInfo, name: e.target.value})} className="w-full pl-10 pr-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded text-sm font-medium capitalize outline-none focus:border-slate-400 dark:focus:border-slate-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" placeholder="Company Name" /></div></div>
              <div className="space-y-1.5"><label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">GSTIN Number</label><div className="relative"><Fingerprint className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600" /><input value={workspaceInfo.gstin} onChange={(e) => setWorkspaceInfo({...workspaceInfo, gstin: e.target.value.toUpperCase()})} className="w-full pl-10 pr-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono outline-none focus:border-slate-400 dark:focus:border-slate-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 uppercase" placeholder="27AAAAA0000A1Z5" /></div></div>
            </div>
            <div className="space-y-1.5"><label className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">Registered Office Address</label><div className="relative"><MapPin className="w-4 h-4 absolute left-3 top-4 text-slate-300 dark:text-slate-600" /><textarea value={workspaceInfo.address} onChange={(e) => setWorkspaceInfo({...workspaceInfo, address: e.target.value})} className="w-full pl-10 pr-4 py-3 border border-slate-200 dark:border-slate-700 rounded text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-none" rows={4} placeholder="Complete office address..." /></div></div>
          </div>
        </div>
      </form>

      {/* Recycle Bin Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/30 dark:bg-slate-900/50">
          <div className="flex items-center space-x-2">
            <Trash2 className="w-4 h-4 text-slate-400" />
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Recycle Bin</h3>
          </div>
          <button onClick={fetchRecycleData} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-400">
            <RotateCcw className={`w-3.5 h-3.5 ${recycleLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        
        <div className="p-0">
          {/* Tabs */}
          <div className="flex overflow-x-auto border-b border-slate-100 dark:border-slate-800 scrollbar-none bg-slate-50/10 dark:bg-slate-900/10">
            {recycleTabs.map(tab => (
              <button 
                key={tab}
                type="button"
                onClick={() => setRecycleTab(tab)}
                className={`px-4 py-3 text-xs font-bold whitespace-nowrap transition-colors border-b-2 ${recycleTab === tab ? 'border-primary text-primary bg-white dark:bg-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-6">
            {recycleLoading ? (
              <div className="py-12 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
            ) : filteredDeleted.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs font-medium">Recycle bin is empty.</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredDeleted.map((item, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.label}</p>
                      <p className="text-[11px] text-slate-400 uppercase tracking-wider">{item.origin}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        type="button" 
                        onClick={() => handleRecover(item)}
                        className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded text-xs font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                      >
                        Restore
                      </button>
                      <button 
                        type="button" 
                        onClick={() => handlePermanentDelete(item)}
                        className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Workspace Danger Zone */}
      <div className="bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 rounded-md p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-rose-800 dark:text-rose-400">Delete This Workspace</h4>
          <p className="text-xs text-rose-600/80 dark:text-rose-400/70 mt-0.5">Deleting will move this entire company workspace to the recycle bin.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsDeleteConfirmOpen(true)}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded shadow-sm transition-colors uppercase tracking-wider shrink-0"
        >
          Delete Workspace
        </button>
      </div>

      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        title="Delete Current Workspace?"
        message={`Are you sure you want to delete "${workspaceInfo.name || 'this workspace'}"? It can be recovered later from the Recycle Bin.`}
        onConfirm={handleDeleteWorkspace}
        onClose={() => setIsDeleteConfirmOpen(false)}
        confirmLabel="Yes, Move to Recycle Bin"
        variant="danger"
      />
    </div>
  );
};

export default Settings;
