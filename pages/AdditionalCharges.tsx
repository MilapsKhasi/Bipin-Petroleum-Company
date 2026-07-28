import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Loader2, X, ChevronDown, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getActiveCompanyId, safeSupabaseSave, getSelectedLedgerIds, toggleSelectedLedgerId } from '../utils/helpers';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';

const isGstLedger = (name: string) => {
  const upper = name.toUpperCase();
  return upper.includes('CGST') || upper.includes('SGST') || upper.includes('IGST') || upper.includes('GST');
};

const AdditionalCharges = () => {
  const [taxes, setTaxes] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [isSaveAndNew, setIsSaveAndNew] = useState(false);

  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; tax: any | null }>({
    isOpen: false,
    tax: null
  });
  
  const getInitialFormData = () => ({
    name: '', 
    type: 'Charge', 
    calc_method: 'Percentage', 
    rate: 0, 
    fixed_amount: 0, 
    apply_on: 'Subtotal',
    applicable_to: 'Both',
    is_default: false
  });

  const [formData, setFormData] = useState(getInitialFormData());

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) {
      setLoading(false);
      return;
    }

    try {
      const currentSelected = getSelectedLedgerIds();
      setSelectedIds(currentSelected);
      
      const { data, error } = await supabase
        .from('duties_taxes')
        .select('*')
        .eq('company_id', cid)
        .eq('is_deleted', false)
        .order('name');
      
      if (error) throw error;
      
      // Never show GST-related ledgers here
      const filtered = (data || []).filter((d: any) => !isGstLedger(d.name));
      setTaxes(filtered);
    } catch (err) {
      console.error("Error loading charges:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cid = getActiveCompanyId();
    if (!cid) return alert("No active workspace selected.");
    
    if (isGstLedger(formData.name)) {
      return alert("Additional Charges must never contain GST-related ledgers (CGST, SGST, IGST, or GST).");
    }

    setSaving(true);
    try {
      const payload = { 
        ...formData, 
        name: formData.name.trim(), 
        applicable_to: formData.applicable_to || 'Both',
        company_id: cid, 
        is_deleted: false 
      };
      
      try {
        await safeSupabaseSave('duties_taxes', payload, editingTax?.id);
      } catch (err: any) {
        if (err?.message?.includes('applicable_to') || err?.code === 'PGRST204' || err?.code === '42703') {
          const { applicable_to, ...cleanPayload } = payload;
          await safeSupabaseSave('duties_taxes', cleanPayload, editingTax?.id);
        } else {
          throw err;
        }
      }

      if (!isSaveAndNew) {
        setIsModalOpen(false);
      } else {
        setFormData(getInitialFormData());
      }
      await loadData();
      window.dispatchEvent(new Event('appSettingsChanged'));
    } catch (err: any) {
      alert("Error saving ledger: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <ConfirmDialog 
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, tax: null })}
        onConfirm={async () => {
            const { error } = await supabase.from('duties_taxes').update({ is_deleted: true }).eq('id', deleteDialog.tax.id);
            if (!error) await loadData();
        }}
        title="Archive Charge/Deduction"
        message={`Are you sure you want to delete "${deleteDialog.tax?.name}"?`}
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/30" onClick={() => setIsModalOpen(false)} />
            <div className="relative bg-white w-full max-w-[650px] border border-slate-300 overflow-hidden rounded-md flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
                    <h2 className="text-[18px] font-medium text-slate-900 capitalize">{editingTax ? "Edit Charge/Deduction" : "Create New Charge/Deduction"}</h2>
                    <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-none">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden bg-white">
                    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 bg-white custom-scrollbar">
                        <div className="border border-slate-200 rounded-md p-4 sm:p-8 space-y-6 bg-white">
                            <div className="space-y-1.5">
                                <label className="text-[14px] font-medium text-slate-900 capitalize">Charge/Deduction Name</label>
                                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded outline-none text-[14px] focus:border-slate-400 bg-white" placeholder="Freight, Labour, Discount, etc..." />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="space-y-1.5">
                                    <label className="text-[14px] font-medium text-slate-900 capitalize">Type</label>
                                    <div className="relative">
                                        <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full h-10 px-4 py-2 border border-slate-200 rounded outline-none text-[14px] focus:border-slate-400 bg-white appearance-none">
                                            <option value="Charge">Charge (+)</option>
                                            <option value="Deduction">Deduction (-)</option>
                                        </select>
                                        <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[14px] font-medium text-slate-900 capitalize">Calculation At</label>
                                    <div className="relative">
                                        <select value={formData.calc_method} onChange={e => setFormData({...formData, calc_method: e.target.value})} className="w-full h-10 px-4 py-2 border border-slate-200 rounded outline-none text-[14px] focus:border-slate-400 bg-white appearance-none">
                                            <option value="Percentage">Percentage</option>
                                            <option value="Fixed">Fixed Amount</option>
                                        </select>
                                        <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[14px] font-medium text-slate-900 capitalize">Applicable To</label>
                                <div className="relative">
                                    <select value={formData.applicable_to || 'Both'} onChange={e => setFormData({...formData, applicable_to: e.target.value})} className="w-full h-10 px-4 py-2 border border-slate-200 rounded outline-none text-[14px] focus:border-slate-400 bg-white appearance-none">
                                        <option value="Both">Both (Sales & Purchase)</option>
                                        <option value="Sales Invoices">Sales Invoices</option>
                                        <option value="Purchase Bills">Purchase Bills</option>
                                    </select>
                                    <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[14px] font-medium text-slate-900 capitalize">Default Value</label>
                                <input type="number" step="0.01" value={formData.calc_method === 'Percentage' ? formData.rate : formData.fixed_amount} onChange={e => setFormData({...formData, [formData.calc_method === 'Percentage' ? 'rate' : 'fixed_amount']: parseFloat(e.target.value) || 0})} className="w-full px-4 py-2 border border-slate-200 rounded outline-none text-[14px] focus:border-slate-400 bg-white font-mono" placeholder="0.00" />
                            </div>
                        </div>
                    </div>

                    <div className="px-4 sm:px-8 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-end gap-4 bg-white shrink-0">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="text-[13px] text-slate-500 hover:text-slate-800 transition-none font-medium capitalize w-full sm:w-auto">Discard</button>
                        <button 
                            type="submit"
                            onClick={() => setIsSaveAndNew(true)}
                            disabled={saving}
                            className="bg-emerald-600 text-white px-6 py-2.5 rounded font-medium text-[14px] hover:bg-emerald-700 transition-none flex items-center justify-center capitalize w-full sm:w-auto"
                        >
                            {saving && isSaveAndNew && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                            Save & New
                        </button>
                        <button 
                            type="submit"
                            onClick={() => setIsSaveAndNew(false)}
                            disabled={saving}
                            className="bg-primary text-white px-8 py-2.5 rounded font-medium text-[14px] hover:bg-primary-dark transition-none flex items-center justify-center capitalize w-full sm:w-auto"
                        >
                            {saving && !isSaveAndNew && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                            Save Charge
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-[20px] font-medium text-slate-900 capitalize">Additional Charges</h1>
        {taxes.length > 0 && (
          <button 
            onClick={() => { setEditingTax(null); setFormData(getInitialFormData()); setIsModalOpen(true); }} 
            className="bg-primary text-white px-6 py-2 rounded-md font-medium text-sm hover:bg-primary-dark transition-none capitalize w-full sm:w-auto"
          >
            New Charge
          </button>
        )}
      </div>

      {!loading && taxes.length === 0 ? (
        <EmptyState 
          title="No Additional Charges" 
          message="Configure user-defined adjustments such as Labour, Freight, or Discounts to apply them on your invoices and bills." 
          actionLabel="Create First Charge" 
          onAction={() => { setEditingTax(null); setFormData(getInitialFormData()); setIsModalOpen(true); }} 
        />
      ) : (
        <div className="border border-slate-200 rounded-md overflow-hidden bg-white overflow-x-auto">
            <table className="clean-table min-w-[600px]">
            <thead>
                <tr>
                <th className="w-20 text-center font-medium capitalize">Select</th>
                <th className="font-medium capitalize">Name</th>
                <th className="font-medium capitalize">Type</th>
                <th className="font-medium capitalize">Applicable To</th>
                <th className="font-medium capitalize">Calculation</th>
                <th className="font-medium capitalize">Value</th>
                <th className="text-right font-medium capitalize">Actions</th>
                </tr>
            </thead>
            <tbody>
                {loading ? (
                <tr><td colSpan={7} className="text-center py-20 text-slate-400">Loading charges...</td></tr>
                ) : taxes.map((tax) => {
                const isSelected = selectedIds.includes(tax.id) || tax.is_default;
                return (
                    <tr key={tax.id} className="hover:bg-slate-50/50">
                    <td className="text-center">
                        <button onClick={async () => {
                            const nextIds = toggleSelectedLedgerId(tax.id);
                            setSelectedIds(nextIds);
                            window.dispatchEvent(new Event('appSettingsChanged'));
                        }} className={`w-4 h-4 rounded border ${isSelected ? 'bg-primary border-slate-900' : 'bg-white border-slate-300'} mx-auto transition-none`} />
                    </td>
                    <td className="font-medium text-slate-700">
                      <span>{tax.name}</span>
                    </td>
                    <td className="text-[11px] font-medium capitalize">
                      {tax.type === 'Deduction' ? 'Deduction (-)' : 'Charge (+)'}
                    </td>
                    <td className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        {tax.applicable_to || 'Both'}
                      </span>
                    </td>
                    <td className="text-[11px] text-slate-400 capitalize">{tax.calc_method}</td>
                    <td className="font-mono text-[13px]">{tax.calc_method === 'Percentage' ? `${tax.rate}%` : tax.fixed_amount.toFixed(2)}</td>
                    <td className="text-right">
                        <div className="flex justify-end space-x-2">
                          <button onClick={() => { setEditingTax(tax); setFormData({ ...tax, applicable_to: tax.applicable_to || 'Both' }); setIsModalOpen(true); }} className="text-slate-400 hover:text-slate-900 transition-none"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => setDeleteDialog({ isOpen: true, tax })} className="text-slate-400 hover:text-red-500 transition-none"><Trash2 className="w-4 h-4" /></button>
                        </div>
                    </td>
                    </tr>
                );
                })}
            </tbody>
            </table>
        </div>
      )}
    </div>
  );
};

export default AdditionalCharges;
