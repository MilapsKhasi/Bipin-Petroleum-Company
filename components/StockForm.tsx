
import React, { useState, useEffect, useRef } from 'react';
import { Save, Package, Tag, Box, Hash, Scale, X, Loader2 } from 'lucide-react';
import { toDisplayValue, toStorageValue, getAppSettings, CURRENCIES } from '../utils/helpers';
import { recordActivity } from '../utils/activityTracker';
import { supabase, getAuthUser } from '../lib/supabase';

interface StockFormProps {
  initialData?: any;
  onSubmit: (item: any, isSaveAndNew?: boolean) => void;
  onCancel: () => void;
  focusStockField?: boolean;
}

const TAX_RATES = [0, 5, 12, 18, 28];

const StockForm: React.FC<StockFormProps> = ({ initialData, onSubmit, onCancel, focusStockField }) => {
  const [loading, setLoading] = useState(false);
  const [isSaveAndNew, setIsSaveAndNew] = useState(false);
  const [formData, setFormData] = useState<any>({
      name: '', sku: '', unit: 'PCS', hsn: '', rate: 0, selling_price: 0, in_stock: 0, description: '', tax_rate: 18, kg_per_bag: 0
  });

  const currencySymbol = CURRENCIES[getAppSettings().currency as keyof typeof CURRENCIES]?.symbol || '₹';
  const firstInputRef = useRef<HTMLInputElement>(null);
  const stockInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialData) {
      setFormData({ 
        name: initialData.name || '',
        sku: initialData.sku || '',
        unit: initialData.unit || 'PCS',
        hsn: initialData.hsn || '',
        rate: toDisplayValue(initialData.rate),
        selling_price: toDisplayValue(initialData.selling_price || 0),
        in_stock: toDisplayValue(initialData.in_stock),
        description: initialData.description || '',
        tax_rate: initialData.tax_rate || 18,
        kg_per_bag: toDisplayValue(initialData.kg_per_bag)
      });
    }
    setTimeout(() => {
      if (focusStockField && stockInputRef.current) {
        stockInputRef.current.focus();
        stockInputRef.current.select();
      } else {
        firstInputRef.current?.focus();
        firstInputRef.current?.select();
      }
    }, 150);
  }, [initialData, focusStockField]);

  const handleInputChange = (field: string, value: any) => { 
    if (field === 'name') {
      setFormData({ ...formData, name: typeof value === 'string' ? value.toUpperCase() : value });
    } else {
      setFormData({ ...formData, [field]: value }); 
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (loading) return;
      if (!formData.name.trim()) return alert("Item name is mandatory.");
      
      setLoading(true);
      try {
        const user = await getAuthUser();
        if (user) recordActivity(user.id, user.email || '');

        const storageData = { 
          ...formData, 
          name: formData.name.trim().toUpperCase(),
          rate: toStorageValue(formData.rate), 
          selling_price: toStorageValue(formData.selling_price),
          in_stock: toStorageValue(formData.in_stock),
          kg_per_bag: toStorageValue(formData.kg_per_bag)
        };
        await onSubmit(storageData, isSaveAndNew);
        if (isSaveAndNew) {
          setFormData({
            name: '', sku: '', unit: 'PCS', hsn: '', rate: 0, selling_price: 0, in_stock: 0, description: '', tax_rate: 18, kg_per_bag: 0
          });
          setTimeout(() => firstInputRef.current?.focus(), 100);
        }
      } catch (err: any) {
        alert("Error saving item: " + err.message);
      } finally {
        setLoading(false);
      }
  }

  return (
    <div className="bg-white dark:bg-slate-900 flex flex-col max-h-[90vh] overflow-hidden">
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8 bg-white dark:bg-slate-900 custom-scrollbar">
            <div className="space-y-6">
                <div className="space-y-1.5">
                    <label className="text-[14px] font-normal text-slate-900 dark:text-slate-300">Item / Product Name</label>
                    <input 
                        ref={firstInputRef} 
                        type="text" 
                        required
                        value={toDisplayValue(formData.name)} 
                        onChange={(e) => handleInputChange('name', e.target.value)} 
                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded outline-none text-base font-bold text-slate-900 dark:text-white focus:border-slate-400 dark:focus:border-slate-600 uppercase" 
                        placeholder="e.g. PREMIUM RICE" 
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                        <label className="text-[14px] font-normal text-slate-900 dark:text-slate-300">SKU Code</label>
                        <input 
                            type="text" 
                            value={toDisplayValue(formData.sku)} 
                            onChange={(e) => handleInputChange('sku', e.target.value)} 
                            className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded outline-none text-sm font-mono focus:border-slate-400 dark:focus:border-slate-600 dark:text-slate-100" 
                            placeholder="Optional" 
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[14px] font-normal text-slate-900 dark:text-slate-300">HSN Code</label>
                        <input 
                            type="text" 
                            value={toDisplayValue(formData.hsnCode || formData.hsn)} 
                            onChange={(e) => handleInputChange('hsn', e.target.value)} 
                            className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded outline-none text-sm font-mono focus:border-slate-400 dark:focus:border-slate-600 dark:text-slate-100" 
                            placeholder="Optional" 
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                        <label className="text-[14px] font-normal text-slate-900 dark:text-slate-300">Unit</label>
                        <div className="relative">
                            <select 
                                value={formData.unit} 
                                onChange={(e) => handleInputChange('unit', e.target.value)} 
                                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded outline-none text-sm bg-white dark:bg-slate-800 appearance-none focus:border-slate-400 dark:focus:border-slate-600 dark:text-slate-100"
                            >
                                {['PCS', 'NOS', 'KGS', 'LTR', 'BAGS', 'BOX', 'DRUMS', 'PACKS'].map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                            <Box className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[14px] font-normal text-slate-900 dark:text-slate-300">Opening Stock</label>
                        <input 
                            ref={stockInputRef}
                            type="number" 
                            step="any" 
                            value={toDisplayValue(formData.in_stock)} 
                            onChange={(e) => handleInputChange('in_stock', e.target.value)} 
                            className="w-full px-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded outline-none text-sm font-mono font-bold focus:border-slate-400 dark:focus:border-slate-600 dark:text-slate-100" 
                        />
                    </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-6 grid grid-cols-1 sm:grid-cols-2 gap-6 shadow-inner">
                    <div className="space-y-1.5">
                        <label className="text-[14px] font-normal text-slate-700 dark:text-slate-400">Purchase Rate ({currencySymbol})</label>
                        <input 
                            type="number" 
                            step="any" 
                            value={toDisplayValue(formData.rate)} 
                            onChange={(e) => handleInputChange('rate', e.target.value)} 
                            className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded outline-none text-lg font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800" 
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[14px] font-normal text-slate-700 dark:text-slate-400">Selling Price ({currencySymbol})</label>
                        <input 
                            type="number" 
                            step="any" 
                            value={toDisplayValue(formData.selling_price)} 
                            onChange={(e) => handleInputChange('selling_price', e.target.value)} 
                            className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded outline-none text-lg font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800" 
                        />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-[14px] font-normal text-slate-700 dark:text-slate-400">Default GST %</label>
                        <select 
                            value={formData.tax_rate} 
                            onChange={(e) => handleInputChange('tax_rate', Number(e.target.value))} 
                            className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded outline-none text-lg font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 appearance-none"
                        >
                            {TAX_RATES.map(r => <option key={r} value={r}>{r}% GST</option>)}
                        </select>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="text-[14px] font-normal text-slate-900 dark:text-slate-300">Item Description</label>
                    <textarea 
                        rows={3} 
                        value={toDisplayValue(formData.description)} 
                        onChange={(e) => handleInputChange('description', e.target.value)} 
                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded outline-none text-sm focus:border-slate-400 dark:focus:border-slate-600 dark:text-slate-100 resize-none" 
                        placeholder="Optional remarks..." 
                    />
                </div>
            </div>

            <div className="pt-6 border-t border-slate-100 dark:border-slate-800 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} disabled={loading} className="text-[13px] text-slate-400 dark:text-slate-500 font-normal hover:text-slate-700 dark:hover:text-slate-300 transition-none disabled:opacity-50 disabled:cursor-not-allowed">Discard Changes</button>
                <button type="submit" onClick={() => setIsSaveAndNew(true)} disabled={loading} className="bg-emerald-600 text-white px-6 py-2.5 rounded font-normal text-[14px] hover:bg-emerald-700 transition-none flex items-center disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading && isSaveAndNew && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save & New
                </button>
                <button type="submit" onClick={() => setIsSaveAndNew(false)} disabled={loading} className="bg-primary text-white px-10 py-2.5 rounded font-normal text-[14px] hover:bg-primary-dark transition-none flex items-center disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading && !isSaveAndNew ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} {initialData ? 'Update Record' : 'Create Item'}
                </button>
            </div>
        </form>
    </div>
  );
};

export default StockForm;
