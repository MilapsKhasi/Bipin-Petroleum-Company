import React, { useEffect, useState } from 'react';
import { Search, Loader2, ShoppingCart, Package, Users, Receipt, Clock, BadgeIndianRupee, LayoutDashboard } from 'lucide-react';
import { getActiveCompanyId, formatDate, normalizeBill, formatCurrency } from '../utils/helpers';
import DateFilter from '../components/DateFilter';
import Modal from '../components/Modal';
import BillForm from '../components/BillForm';
import SalesInvoiceForm from '../components/SalesInvoiceForm';
import PaymentVoucherModal from '../components/PaymentVoucherModal';
import NewVoucherDropdown from '../components/NewVoucherDropdown';
import { supabase } from '../lib/supabase';

const Dashboard = () => {
  const [stats, setStats] = useState({ 
    totalSales: 0,
    totalPurchases: 0, 
    payables: 0,
    receivables: 0,
    gstPaid: 0,
    totalVendors: 0,
    totalCustomers: 0,
    stockItems: 0
  });
  const [recentVouchers, setRecentVouchers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentVoucherType, setPaymentVoucherType] = useState<'Receipt' | 'Payment'>('Receipt');
  const [dateRange, setDateRange] = useState<{ startDate: string | null, endDate: string | null }>({ startDate: null, endDate: null });
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = async () => {
    setLoading(true);
    const cid = getActiveCompanyId();
    if (!cid) {
      setLoading(false);
      return;
    }

    try {
      let billQuery = supabase.from('purchase_bills').select('*').eq('company_id', cid).eq('is_deleted', false);
      let saleQuery = supabase.from('sales_invoices').select('*').eq('company_id', cid).eq('is_deleted', false);

      if (dateRange.startDate && dateRange.endDate) {
        billQuery = billQuery.gte('date', dateRange.startDate).lte('date', dateRange.endDate);
        saleQuery = saleQuery.gte('date', dateRange.startDate).lte('date', dateRange.endDate);
      }
      
      const [{ data: bills }, { data: sales }] = await Promise.all([billQuery, saleQuery]);
      
      const { data: allParties } = await supabase.from('vendors').select('party_type, is_customer').eq('company_id', cid).eq('is_deleted', false);
      const customerCount = (allParties || []).filter((p: any) => {
        const pt = (p.party_type || '').toLowerCase();
        return pt === 'customer' || pt === 'both' || (p.is_customer === true && pt !== 'vendor');
      }).length;
      const vendorCount = (allParties || []).filter((p: any) => {
        const pt = (p.party_type || '').toLowerCase();
        return pt === 'vendor' || pt === 'both' || (p.is_customer === false && pt !== 'customer');
      }).length;
      const { count: itemCount } = await supabase.from('stock_items').select('*', { count: 'exact', head: true }).eq('company_id', cid).eq('is_deleted', false);

      const allPaymentVouchers = [
        ...(bills || []).map((b: any) => normalizeBill(b)).filter((b: any) => b?.items_raw?.is_payment_voucher === true),
        ...(sales || []).map((s: any) => normalizeBill(s)).filter((s: any) => s?.items_raw?.is_payment_voucher === true)
      ];

      const actualPurchases = (bills || []).map((b: any) => {
        const norm = normalizeBill(b);
        return norm ? { ...norm, type: 'Purchase' } : null;
      }).filter((b: any) => b && !b.items_raw?.is_payment_voucher) as any[];

      const actualSales = (sales || []).map((s: any) => {
        const norm = normalizeBill(s);
        return norm ? { ...norm, type: 'Sale' } : null;
      }).filter((s: any) => s && !s.items_raw?.is_payment_voucher) as any[];

      const getInvoiceOutstanding = (invoice: any) => {
        const isSale = invoice.type === 'Sale';
        const linkedVouchers = allPaymentVouchers.filter(v => {
          const isCorrectType = isSale ? (v.type === 'Sale' || v.customer_name) : (v.type === 'Purchase' || v.vendor_name);
          return isCorrectType && v.items_raw?.linked_bills?.includes(invoice.id);
        });
        const totalPaid = linkedVouchers.reduce((sum, v) => {
          const pDetails = v.items_raw?.payment_details;
          const pArray = Array.isArray(pDetails) ? pDetails : (pDetails ? [pDetails] : []);
          const amt = pArray.reduce((s: number, p: any) => s + (Number(p.payment_amount) || 0), 0);
          return sum + amt;
        }, 0);
        return Math.max(0, Number(invoice.grand_total || 0) - totalPaid);
      };

      const payables = actualPurchases.reduce((acc, v) => acc + getInvoiceOutstanding(v), 0);
      const receivables = actualSales.reduce((acc, v) => acc + getInvoiceOutstanding(v), 0);

      setStats({ 
        totalSales: actualSales.reduce((acc, b) => acc + Number(b.grand_total || 0), 0), 
        totalPurchases: actualPurchases.reduce((acc, b) => acc + Number(b.grand_total || 0), 0), 
        payables, 
        receivables, 
        gstPaid: actualPurchases.reduce((acc, v) => acc + Number(v.total_gst || 0), 0),
        totalVendors: vendorCount || 0,
        totalCustomers: customerCount || 0,
        stockItems: itemCount || 0
      });

      const combined = [
        ...actualPurchases.map(p => ({ ...p, status: getInvoiceOutstanding(p) === 0 && Number(p.grand_total || 0) > 0 ? 'Paid' : 'Pending' })),
        ...actualSales.map(s => ({ ...s, status: getInvoiceOutstanding(s) === 0 && Number(s.grand_total || 0) > 0 ? 'Paid' : 'Pending' }))
      ];
      setRecentVouchers(combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (err: any) {
      console.error("Dashboard error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    window.addEventListener('appSettingsChanged', loadData);
    return () => window.removeEventListener('appSettingsChanged', loadData);
  }, [dateRange]);

  const filteredVouchers = recentVouchers.filter(v => {
    const search = searchQuery.toLowerCase();
    const partyName = v.vendor_name || v.customer_name || '';
    return v.bill_number?.toLowerCase().includes(search) || partyName.toLowerCase().includes(search);
  }).slice(0, 10);

  const StatBox = ({ label, value, subLabel, icon: Icon }: any) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded hover:border-slate-300 dark:hover:border-slate-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 capitalize tracking-tight">{label}</span>
        <Icon className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" />
      </div>
      <div className="text-xl font-medium text-slate-900 dark:text-white leading-none mb-1">{value}</div>
      {subLabel && <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium capitalize">{subLabel}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Sales Invoice Modal */}
      <Modal isOpen={isSalesModalOpen} onClose={() => setIsSalesModalOpen(false)} title="New Sales Invoice" maxWidth="max-w-5xl">
        <SalesInvoiceForm 
          onSubmit={(inv, shouldPrint, isSaveAndNew) => { 
            if (!isSaveAndNew) setIsSalesModalOpen(false); 
            loadData(); 
          }} 
          onCancel={() => setIsSalesModalOpen(false)} 
        />
      </Modal>

      {/* Purchase Bill Modal */}
      <Modal isOpen={isPurchaseModalOpen} onClose={() => setIsPurchaseModalOpen(false)} title="New Purchase Bill" maxWidth="max-w-5xl">
        <BillForm 
          onSubmit={(bill, isSaveAndNew) => { 
            if (!isSaveAndNew) setIsPurchaseModalOpen(false); 
            loadData(); 
          }} 
          onCancel={() => setIsPurchaseModalOpen(false)} 
        />
      </Modal>

      {/* Payment / Receipt Voucher Modal */}
      <PaymentVoucherModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        initialType={paymentVoucherType}
        onSuccess={loadData}
      />

      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-[20px] font-medium text-slate-900 dark:text-white capitalize">Executive Summary</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">Real-time overview of sales, purchases, payables, receivables, and recent activity</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
          <DateFilter onFilterChange={setDateRange} />
          <NewVoucherDropdown
            onSelectSalesInvoice={() => setIsSalesModalOpen(true)}
            onSelectPurchaseBill={() => setIsPurchaseModalOpen(true)}
            onSelectReceivePayment={() => { setPaymentVoucherType('Receipt'); setIsPaymentModalOpen(true); }}
            onSelectMakePayment={() => { setPaymentVoucherType('Payment'); setIsPaymentModalOpen(true); }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBox label="Sales (Gross)" value={formatCurrency(stats.totalSales)} subLabel={`Net Recv: ${formatCurrency(stats.receivables)}`} icon={BadgeIndianRupee} />
        <StatBox label="Purchases" value={formatCurrency(stats.totalPurchases)} subLabel={`Net Payable: ${formatCurrency(stats.payables)}`} icon={ShoppingCart} />
        <StatBox label="Active Partners" value={stats.totalVendors + stats.totalCustomers} subLabel={`${stats.totalVendors} Vendors / ${stats.totalCustomers} Customers`} icon={Users} />
        <StatBox label="Inventory" value={stats.stockItems} subLabel="Registered SKU Items" icon={Package} />
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/50">
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize">Recent Transactions</h2>
          <div className="relative w-full sm:w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600 w-3.5 h-3.5" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Filter list..." className="pl-7 pr-3 py-1 border border-slate-200 dark:border-slate-700 rounded text-xs outline-none focus:border-slate-300 dark:focus:border-slate-600 w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="clean-table min-w-[800px] sm:min-w-full">
            <thead>
              <tr>
                <th className="font-medium capitalize">Date</th>
                <th className="font-medium capitalize">Type</th>
                <th className="font-medium capitalize">Document #</th>
                <th className="font-medium capitalize">Party Name</th>
                <th className="text-right font-medium capitalize">Total Amount</th>
                <th className="text-center font-medium capitalize">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-20 text-slate-400 capitalize text-[10px] font-medium tracking-widest">Refreshing Data...</td></tr>
              ) : filteredVouchers.map((v) => (
                <tr key={v.id}>
                  <td className="text-slate-500 dark:text-slate-400">{formatDate(v.date)}</td>
                  <td className={`text-[10px] font-medium capitalize ${v.type === 'Sale' ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>{v.type}</td>
                  <td className="font-mono font-medium text-slate-900 dark:text-slate-100">{v.bill_number}</td>
                  <td className="capitalize font-medium text-slate-700 dark:text-slate-300">{v.vendor_name || v.customer_name}</td>
                  <td className="text-right font-mono font-medium text-slate-900 dark:text-slate-100">{formatCurrency(v.grand_total, false)}</td>
                  <td className="text-center">
                    <span className={`text-[9px] px-2 py-0.5 rounded-sm font-medium capitalize ${v.status === 'Paid' ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'}`}>{v.status}</span>
                  </td>
                </tr>
              ))}
              {!loading && filteredVouchers.length === 0 && (
                <tr><td colSpan={6} className="py-20 text-center text-slate-300 italic">No transactions found for the selected period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;