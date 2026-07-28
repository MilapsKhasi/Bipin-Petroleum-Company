import React, { useState, useEffect, useMemo } from 'react';
import { Search, ChevronDown, FileText, Loader2, BarChart3, FileDown } from 'lucide-react';
import DateFilter from '../components/DateFilter';
import ExportModal from '../components/ExportModal';
import { getActiveCompanyId, formatDate, normalizeBill } from '../utils/helpers';
import { exportToExcel, exportToCSV, triggerPrint } from '../utils/exportHelper';
import { supabase } from '../lib/supabase';

const Reports = () => {
  const [activeTab, setActiveTab] = useState('Purchases');
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<{ startDate: string | null, endDate: string | null }>({ startDate: null, endDate: null });
  const [searchQuery, setSearchQuery] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [companyInfo, setCompanyInfo] = useState<any>(null);

  const tabs = ['Purchases', 'Sales Register', 'Vendors Summary', 'Customers Summary', 'Gst Summary'];

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) {
      setLoading(false);
      return;
    }

    const { data: company } = await supabase.from('companies').select('*').eq('id', cid).single();
    setCompanyInfo(company);

    const [{ data: purchaseData }, { data: saleData }] = await Promise.all([
      supabase.from('purchase_bills').select('*').eq('company_id', cid).eq('is_deleted', false),
      supabase.from('sales_invoices').select('*').eq('company_id', cid).eq('is_deleted', false)
    ]);
    
    const allPaymentVouchers = [
      ...(purchaseData || []).map((b: any) => normalizeBill(b)).filter((b: any) => b?.items_raw?.is_payment_voucher === true),
      ...(saleData || []).map((s: any) => normalizeBill(s)).filter((s: any) => s?.items_raw?.is_payment_voucher === true)
    ];

    const actualPurchases = (purchaseData || []).map((b: any) => {
      const norm = normalizeBill(b);
      return norm ? { ...norm, type: 'Purchase' } : null;
    }).filter((b: any) => b && !b.items_raw?.is_payment_voucher);

    const actualSales = (saleData || []).map((s: any) => {
      const norm = normalizeBill(s);
      return norm ? { ...norm, type: 'Sale' } : null;
    }).filter((s: any) => s && !s.items_raw?.is_payment_voucher);

    const combined = [
      ...actualPurchases.map((p: any) => {
        const linkedVouchers = allPaymentVouchers.filter((v: any) => v.items_raw?.linked_bills?.includes(p.id));
        const totalPaid = linkedVouchers.reduce((sum: number, v: any) => {
          const pDetails = v.items_raw?.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          const amt = pArray.reduce((s: number, p: any) => s + (Number(p.payment_amount) || 0), 0);
          return sum + amt;
        }, 0);
        const outstanding = Math.max(0, Number(p.grand_total || 0) - totalPaid);
        const status = (outstanding === 0 && Number(p.grand_total || 0) > 0) ? 'Paid' : 'Pending';
        return { ...p, status };
      }),
      ...actualSales.map((s: any) => {
        const linkedVouchers = allPaymentVouchers.filter(v => v.items_raw?.linked_bills?.includes(s.id));
        const totalPaid = linkedVouchers.reduce((sum, v) => {
          const pDetails = v.items_raw?.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          const amt = pArray.reduce((s: number, p: any) => s + (Number(p.payment_amount) || 0), 0);
          return sum + amt;
        }, 0);
        const outstanding = Math.max(0, Number(s.grand_total || 0) - totalPaid);
        const status = (outstanding === 0 && Number(s.grand_total || 0) > 0) ? 'Paid' : 'Pending';
        return { ...s, status };
      })
    ];

    const filterFn = (item: any) => {
        if (dateRange.startDate && dateRange.endDate) {
          const bDate = new Date(item.date);
          const start = new Date(dateRange.startDate);
          const end = new Date(dateRange.endDate);
          if (bDate < start || bDate > end) return false;
        }

        const typeFilter = activeTab === 'Purchases' || activeTab === 'Vendors Summary' ? 'Purchase' : 'Sale';
        if (activeTab === 'Gst Summary') return true;
        if (item.type !== typeFilter) return false;
        
        const search = searchQuery.toLowerCase();
        const partyName = item.vendor_name || item.customer_name || '';
        return (item.bill_number || item.invoice_number)?.toLowerCase().includes(search) || partyName.toLowerCase().includes(search);
    };

    setBills(combined.filter(filterFn));
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    window.addEventListener('appSettingsChanged', loadData);
    return () => window.removeEventListener('appSettingsChanged', loadData);
  }, [dateRange, activeTab, searchQuery]);

  const reportTableData = useMemo(() => {
    if (!bills || bills.length === 0) return [];

    if (activeTab === 'Purchases' || activeTab === 'Sales Register') {
      return bills.map(doc => ({
        "Date": formatDate(doc.date),
        "Doc No": doc.bill_number || doc.invoice_number,
        "Party": doc.vendor_name || doc.customer_name,
        "Taxable": (Number(doc.total_without_gst) || 0).toFixed(2),
        "Gst": (Number(doc.total_gst) || 0).toFixed(2),
        "Net Total": (Number(doc.grand_total) || 0).toFixed(2),
        "Status": doc.status || 'Pending'
      }));
    }

    if (activeTab === 'Vendors Summary' || activeTab === 'Customers Summary') {
      const grouped: Record<string, any> = {};
      bills.forEach(bill => {
        const name = bill.vendor_name || bill.customer_name || 'Unknown';
        if (!grouped[name]) {
          grouped[name] = { "Party Name": name, "Gstin": bill.gstin || 'N/A', "Doc Count": 0, "Taxable": 0, "Gst": 0, "Grand Total": 0 };
        }
        grouped[name]["Doc Count"] += 1;
        grouped[name]["Taxable"] += Number(bill.total_without_gst || 0);
        grouped[name]["Gst"] += Number(bill.total_gst || 0);
        grouped[name]["Grand Total"] += Number(bill.grand_total || 0);
      });
      return Object.values(grouped).map(v => ({
        ...v,
        "Taxable": Number(v["Taxable"]).toFixed(2),
        "Gst": Number(v["Gst"]).toFixed(2),
        "Grand Total": Number(v["Grand Total"]).toFixed(2)
      }));
    }

    return [];
  }, [activeTab, bills]);

  const handleExport = (type: 'excel' | 'csv' | 'pdf') => {
    if (!reportTableData.length || !companyInfo) return;

    const headers = Object.keys(reportTableData[0]);
    const rows = reportTableData.map(obj => Object.values(obj));
    const config = {
        companyName: companyInfo.name,
        gstin: companyInfo.gstin || '',
        email: companyInfo.email || '',
        phone: companyInfo.phone || '',
        address: companyInfo.address || '',
        reportTitle: `${activeTab} Statement`,
        dateRange: dateRange.startDate && dateRange.endDate 
            ? `${dateRange.startDate} to ${dateRange.endDate}` 
            : 'All Time'
    };

    if (type === 'excel') exportToExcel(headers, rows, config);
    else if (type === 'csv') exportToCSV(headers, rows, config);
    else if (type === 'pdf') triggerPrint();
    
    setIsExportModalOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} onExport={handleExport} reportName={`${activeTab}`} />

      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 print:hidden">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-[20px] font-medium text-slate-900 dark:text-white capitalize">Reports Engine</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">Comprehensive business intelligence, tax audit registers, and summary ledgers</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
          <DateFilter onFilterChange={setDateRange} />
          <button 
            onClick={() => setIsExportModalOpen(true)}
            disabled={reportTableData.length === 0}
            className="w-full sm:w-auto px-4 py-2.5 bg-primary text-white font-medium text-sm hover:bg-primary-dark rounded-md shadow-sm transition-all flex items-center justify-center disabled:opacity-50 cursor-pointer"
          >
            <FileDown className="w-4 h-4 mr-2" /> Export Statement
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6 space-y-4">
        <div className="relative print:hidden">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter report data..." 
            className="w-full max-w-md pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>

        <div className="flex flex-col lg:flex-row gap-6 min-h-[500px]">
          <div className="w-full lg:w-64 flex lg:flex-col overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 gap-1 print:hidden scrollbar-none">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap lg:whitespace-normal text-left px-4 py-2.5 text-xs font-semibold transition-all capitalize rounded-lg shrink-0 lg:shrink ${
                  activeTab === tab ? 'bg-primary text-white font-bold shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col print:border-none">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-center">
              <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{activeTab} Register</h3>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">{reportTableData.length} entries matching</span>
            </div>

            <div className="flex-1 overflow-auto bg-white dark:bg-slate-900 custom-scrollbar overflow-x-auto">
              {loading ? (
                <div className="h-full flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : reportTableData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-32 text-center">
                  <FileText className="w-12 h-12 text-slate-200 dark:text-slate-800 mb-4" />
                  <p className="text-slate-400 dark:text-slate-600 italic text-xs capitalize">Report set is currently empty.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      {Object.keys(reportTableData[0] || {}).map(h => (
                        <th key={h} className="py-3.5 px-4 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {reportTableData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all">
                        {Object.values(row).map((val: any, vIdx) => (
                          <td key={vIdx} className="py-3 px-4 whitespace-nowrap font-mono">{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;