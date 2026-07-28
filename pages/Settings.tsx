
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, Loader2, Trash2, AlertTriangle, Building2, MapPin, Fingerprint, Moon, Sun, Monitor, Percent, CheckCircle2, RotateCcw, Trash, Filter, ShieldCheck, BadgeCheck, HardDrive, Download, Cpu, FolderSymlink, Laptop } from 'lucide-react';
import { getActiveCompanyId, safeSupabaseSave, getAppSettings, formatDate } from '../utils/helpers';
import { supabase } from '../lib/supabase';
import { processOfflineSyncQueue } from '../lib/syncEngine';
import ConfirmDialog from '../components/ConfirmDialog';
import { exportFullDatabaseToFolder, downloadStandaloneOfflineLauncher, downloadWindowsExePackage } from '../utils/offlineHelper';

const Settings = () => {
  const navigate = useNavigate();
  const cid = getActiveCompanyId();

  // Lazy initialize states from localStorage to prevent resets on reload
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
  
  // Offline & Desktop State
  const [offlineActionLoading, setOfflineActionLoading] = useState(false);
  const [offlineStatusMsg, setOfflineStatusMsg] = useState('');

  // Recycle Bin State
  const [recycleTab, setRecycleTab] = useState('All');
  const [deletedItems, setDeletedItems] = useState<any[]>([]);
  const [recycleLoading, setRecycleLoading] = useState(false);

  const handleExportDiskFolder = async () => {
    setOfflineActionLoading(true);
    setOfflineStatusMsg('Syncing all database records to disk folder...');
    try {
      const res = await exportFullDatabaseToFolder();
      if (res?.success) {
        setOfflineStatusMsg(`✅ Data saved successfully to local disk folder (${res.folder || res.filename}).`);
      } else if (res?.aborted) {
        setOfflineStatusMsg('Sync canceled by user.');
      }
    } catch (err: any) {
      setOfflineStatusMsg(`❌ Error: ${err.message}`);
    } finally {
      setOfflineActionLoading(false);
    }
  };

  const handleDownloadOfflineHtml = async () => {
    setOfflineActionLoading(true);
    setOfflineStatusMsg('Generating standalone offline HTML application snapshot...');
    try {
      await downloadStandaloneOfflineLauncher();
      setOfflineStatusMsg('✅ Standalone offline app downloaded to your hard disk.');
    } catch (err: any) {
      setOfflineStatusMsg(`❌ Error: ${err.message}`);
    } finally {
      setOfflineActionLoading(false);
    }
  };

  const handleDownloadExeBuilder = () => {
    downloadWindowsExePackage();
    setOfflineStatusMsg('✅ Desktop .EXE compiler package downloaded. Double-click the file on Windows to launch standalone application.');
  };

  const recycleTabs = [
    'All', 'Workspace', 'Sales Invoices', 'Purchase Bills', 
    'Customers', 'Vendors', 'Stock Master', 'Cashbook', 'Additional Charges'
  ];

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

      // Re-sync local settings from storage just in case
      const settings = getAppSettings();
      setGstConfig({
          enabled: settings.gstEnabled,
          type: settings.gstType || 'CGST - SGST'
      });
      
      // Calculate License ID based on creation order
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

  useEffect(() => { loadProfile(); }, [cid]);

  const handleRecover = async (item: any) => {
    try {
      const { error } = await supabase.from(item.table).update({ is_deleted: false }).eq('id', item.id);
      if (error) throw error;
      await fetchRecycleData();
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

  /**
   * FIX: Toggle function now saves state IMMEDIATELY to localStorage
   * to prevent it from resetting on reload.
   */
  const toggleGST = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    const newEnabled = !gstConfig.enabled;
    const newConfig = { ...gstConfig, enabled: newEnabled };
    setGstConfig(newConfig);
    
    // Immediate Persistence
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
      // Save Workspace Info to Supabase
      await safeSupabaseSave('companies', workspaceInfo, cid);
      localStorage.setItem('activeCompanyName', workspaceInfo.name);

      // Save GST Type to localStorage
      const currentSettings = getAppSettings();
      const updatedSettings = { 
        ...currentSettings, 
        gstEnabled: gstConfig.enabled, 
        gstType: gstConfig.type 
      };
      localStorage.setItem(`appSettings_${cid}`, JSON.stringify(updatedSettings));

      // Auto-create tax ledgers if needed
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

  const filteredDeleted = deletedItems.filter(item => recycleTab === 'All' || item.origin === recycleTab);

  if (loading) return <div className="py-40 text-center"><Loader2 className="w-8 h-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-5xl">
      <div className="flex flex-col text-left">
        <h1 className="text-[20px] font-medium text-slate-900 dark:text-slate-100 capitalize">Workspace Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">Configure your business profile, theme preferences, and workspace lifecycle.</p>
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
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Plan - <span className="text-link">Active</span></h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-wider font-mono">License ID: {licenseId}</p>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 px-4 py-2 rounded-lg flex items-center">
                  <BadgeCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mr-2" />
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-tighter">Version ZP-26.07.01</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Appearance Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden shadow-sm">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/50">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Appearance</h3>
          </div>
          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Visual Theme</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Choose between light, dark, or system-default appearance.</p>
              </div>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit ml-auto">
                <button type="button" onClick={() => applyTheme('light')} className={`flex items-center px-4 py-2 rounded-md text-xs font-bold transition-all ${theme === 'light' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Sun className="w-3.5 h-3.5 mr-2" /> Light</button>
                <button type="button" onClick={() => applyTheme('dark')} className={`flex items-center px-4 py-2 rounded-md text-xs font-bold transition-all ${theme === 'dark' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}><Moon className="w-3.5 h-3.5 mr-2" /> Dark</button>
              </div>
            </div>
          </div>
        </div>

        {/* Connection Mode Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden shadow-sm">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/50">
            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Connection Mode</h3>
          </div>
          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center text-left">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
                  {localStorage.getItem('use_offline_mode') === 'true' ? 'Offline Local Storage' : 'Cloud Database (Supabase)'}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {localStorage.getItem('use_offline_mode') === 'true' 
                    ? 'You are running the app entirely offline. Data is securely persisted in your browser.' 
                    : 'Your workspace is synchronized in real-time with the secure Cloud database.'}
                </p>
              </div>
              <div className="flex justify-end">
                {localStorage.getItem('use_offline_mode') === 'true' ? (
                  <button
                    type="button"
                    onClick={async () => {
                      localStorage.removeItem('use_offline_mode');
                      await processOfflineSyncQueue();
                      window.location.reload();
                    }}
                    className="px-4 py-2.5 bg-primary hover:bg-primary-dark text-white text-xs font-bold rounded shadow-sm transition-colors uppercase tracking-wider"
                  >
                    Switch to Cloud Mode
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem('use_offline_mode', 'true');
                      window.location.reload();
                    }}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded shadow-sm border border-slate-200 dark:border-slate-700 transition-colors uppercase tracking-wider"
                  >
                    Switch to Offline Mode
                  </button>
                )}
              </div>
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
                onClick={() => setRecycleTab(tab)} 
                className={`px-6 py-3 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-all border-b-2 ${recycleTab === tab ? 'border-primary text-slate-900 dark:text-white' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="min-h-[300px] max-h-[500px] overflow-y-auto custom-scrollbar overflow-x-auto">
            {recycleLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : filteredDeleted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-300 dark:text-slate-700 italic">
                <Trash2 className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-xs">Recycle bin is empty for this category.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0 z-10">
                  <tr className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tighter">
                    <th className="px-6 py-3 border-b border-slate-100 dark:border-slate-800">Source Screen</th>
                    <th className="px-6 py-3 border-b border-slate-100 dark:border-slate-800">Name / Reference</th>
                    <th className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredDeleted.map((item, idx) => (
                    <tr key={`${item.table}-${item.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      <td className="px-6 py-4">
                        <span className="text-[9px] font-bold uppercase px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded">{item.origin}</span>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-slate-700 dark:text-slate-300 capitalize">{item.label}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end items-center space-x-2">
                          <button 
                            onClick={() => handleRecover(item)} 
                            className="p-1.5 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded transition-colors"
                            title="Recover Item"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handlePermanentDelete(item)} 
                            className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded transition-colors"
                            title="Delete Permanently"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Offline Execution & Desktop .EXE Package */}
      <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-left">
        <div className="flex items-center space-x-2">
          <HardDrive className="w-4 h-4 text-primary dark:text-red-400" />
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Offline Execution & Desktop (.EXE) Backup</h3>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 space-y-6 shadow-sm">
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Local Hard Disk Sync & Offline Mode</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Run your billing register completely offline without internet. Save live data directly to your local computer folder or compile a standalone Windows Desktop (.EXE) launcher.
            </p>
          </div>

          {offlineStatusMsg && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-md text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-between">
              <span>{offlineStatusMsg}</span>
              <button onClick={() => setOfflineStatusMsg('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 ml-4 font-bold">✕</button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4.5 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col justify-between">
              <div className="space-y-1.5 mb-4">
                <div className="flex items-center space-x-2 text-slate-900 dark:text-slate-100 font-bold text-xs">
                  <FolderSymlink className="w-4 h-4 text-amber-500" />
                  <span>Save Data in Hard Disk Folder</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Export all invoices, inventory, customers, and cashbook records directly to a chosen folder on your local hard disk drive.
                </p>
              </div>
              <button 
                onClick={handleExportDiskFolder} 
                disabled={offlineActionLoading}
                className="w-full py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs rounded shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-all flex items-center justify-center active:scale-95"
              >
                {offlineActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <HardDrive className="w-3.5 h-3.5 mr-2 text-amber-500" />}
                Sync to Hard Disk Folder
              </button>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4.5 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col justify-between">
              <div className="space-y-1.5 mb-4">
                <div className="flex items-center space-x-2 text-slate-900 dark:text-slate-100 font-bold text-xs">
                  <Laptop className="w-4 h-4 text-emerald-500" />
                  <span>Standalone Offline App (.html)</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Download a 100% self-contained single-file offline application. Double click anytime on PC or tablet to view & print statements without server.
                </p>
              </div>
              <button 
                onClick={handleDownloadOfflineHtml} 
                disabled={offlineActionLoading}
                className="w-full py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs rounded shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-all flex items-center justify-center active:scale-95"
              >
                {offlineActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Download className="w-3.5 h-3.5 mr-2 text-emerald-500" />}
                Download Offline App
              </button>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4.5 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-primary text-white text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-bl">Desktop</div>
              <div className="space-y-1.5 mb-4">
                <div className="flex items-center space-x-2 text-slate-900 dark:text-slate-100 font-bold text-xs">
                  <Cpu className="w-4 h-4 text-blue-500" />
                  <span>Windows Desktop (.EXE) File</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Package Stock Register as a native Windows Desktop (.exe) application executable with native window frame and offline storage capability.
                </p>
              </div>
              <button 
                onClick={handleDownloadExeBuilder} 
                className="w-full py-2 px-3 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded shadow transition-all flex items-center justify-center active:scale-95"
              >
                <Download className="w-3.5 h-3.5 mr-2" />
                Build Desktop .EXE
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-left">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-500" />
          <h3 className="text-xs font-bold text-rose-500 uppercase tracking-widest">Danger Zone</h3>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-rose-100 dark:border-rose-900/30 rounded-md p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 capitalize mb-1">Delete Workspace Forever</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">Permanently remove this workspace and all associated data. This action is irreversible.</p>
          </div>
          <button onClick={() => setIsDeleteConfirmOpen(true)} className="px-6 py-2 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-50 rounded-md text-[13px] font-bold hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors flex items-center capitalize">
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Workspace
          </button>
        </div>
      </div>

      <ConfirmDialog isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)} onConfirm={handleDeleteWorkspace} title="Delete Current Workspace" message={`Are you sure you want to permanently delete "${workspaceInfo.name}"? All invoices, ledgers, and inventory data will be wiped out.`} />
    </div>
  );
};

export default Settings;
