import React, { useEffect, useState, useRef } from 'react';
import { Printer, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getActiveCompanyId, formatDate } from '../utils/helpers';

interface InvoicePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any;
}

export function numberToWords(num: number): string {
  if (isNaN(num) || num === 0) return 'Rupees Zero only...';

  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const inWords = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + inWords(n % 100) : '');
    if (n < 100000) return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + inWords(n % 1000) : '');
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + inWords(n % 100000) : '');
    return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + inWords(n % 10000000) : '');
  };

  const integerPart = Math.floor(Math.abs(num));
  const decimalPart = Math.round((Math.abs(num) - integerPart) * 100);

  let str = 'Rupees ' + inWords(integerPart);
  if (decimalPart > 0) {
    str += ' and ' + inWords(decimalPart) + ' Paise';
  }
  str += ' only...';
  return str;
}

export const InvoicePrintModal: React.FC<InvoicePrintModalProps> = ({ isOpen, onClose, invoice }) => {
  const cid = getActiveCompanyId();
  const [company, setCompany] = useState<any>({});
  const [customer, setCustomer] = useState<any>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !invoice) return;

    const fetchDetails = async () => {
      if (cid) {
        const { data: comp } = await supabase.from('companies').select('*').eq('id', cid).maybeSingle();
        if (comp) setCompany(comp);
      }
      const partyName = invoice.customer_name || invoice.vendor_name;
      if (partyName && cid) {
        let { data: cust } = await supabase.from('vendors').select('*').eq('company_id', cid).eq('name', partyName).eq('is_deleted', false).maybeSingle();
        if (!cust) {
          const res = await supabase.from('customers').select('*').eq('company_id', cid).eq('name', partyName).eq('is_deleted', false).maybeSingle();
          cust = res.data;
        }
        if (cust) setCustomer(cust);
      }
    };
    fetchDetails();
  }, [isOpen, invoice, cid]);

  if (!isOpen || !invoice) return null;

  const itemsRaw = invoice?.items_raw || invoice?.items || {};
  let lineItems: any[] = [];
  if (Array.isArray(invoice?.items)) {
    lineItems = invoice.items;
  } else if (Array.isArray(itemsRaw?.line_items)) {
    lineItems = itemsRaw.line_items;
  }

  let dutiesAndTaxes: any[] = [];
  if (Array.isArray(invoice?.duties_and_taxes)) {
    dutiesAndTaxes = invoice.duties_and_taxes;
  } else if (Array.isArray(itemsRaw?.duties_and_taxes)) {
    dutiesAndTaxes = itemsRaw.duties_and_taxes;
  } else if (Array.isArray(invoice?.items?.duties_and_taxes)) {
    dutiesAndTaxes = invoice.items.duties_and_taxes;
  }

  const payment = itemsRaw?.payment_details || invoice?.payment_details || {};

  // Company Details
  const companyName = company?.name || '';
  const companyAddress = company?.address || '';
  const companyPhone = company?.phone || '';
  const companyGstin = company?.gstin || '';

  // Customer Details
  const customerName = invoice.customer_name || invoice.vendor_name || customer?.name || '';
  const customerAddress = customer?.address || '';
  const customerPhone = customer?.phone || '';
  const customerGstin = customer?.gstin || '';
  const customerState = customer?.state || '';
  const customerCountry = customer?.country || 'India';
  const customerStateCountry = [customerState, customerCountry].filter(Boolean).join(', ');

  const shipToName = customerName;
  const shipToAddress = customer?.shipping_address || customerAddress;

  // Invoice Details
  const invoiceNo = invoice.invoice_number || invoice.bill_number || '';
  const invoiceDate = invoice.date ? formatDate(invoice.date) : '';
  const poNumber = payment?.po_number || invoice.po_number || itemsRaw?.po_number || '';

  // GST & Tax Calculations
  const gstType = itemsRaw?.gst_type || invoice.gst_type || 'Intra-State';
  const isInterState = gstType === 'Inter-State' || gstType === 'IGST';

  let totalQty = 0;
  let totalAmount = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalSubtotal = 0;

  const calculatedItems = lineItems.map((item: any) => {
    const qty = parseFloat(item.qty || item.quantity) || 0;
    const rate = parseFloat(item.rate) || 0;
    const taxRate = parseFloat(item.tax_rate || item.gst || item.tax) || 0;
    const amount = parseFloat(item.taxableAmount) || (qty * rate);

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (isInterState) {
      igst = amount * (taxRate / 100);
    } else {
      cgst = amount * (taxRate / 2 / 100);
      sgst = amount * (taxRate / 2 / 100);
    }

    const subtotal = amount + (isInterState ? igst : (cgst + sgst));

    totalQty += qty;
    totalAmount += amount;
    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;
    totalSubtotal += subtotal;

    return {
      name: item.itemName || item.name || '',
      hsn: item.hsnCode || item.hsn || '',
      qty,
      rate,
      amount,
      taxRate,
      cgst,
      sgst,
      igst,
      subtotal
    };
  });

  // Additional Charges
  const appliedCharges = dutiesAndTaxes.filter((d: any) => {
    const amt = parseFloat(d.amount) || 0;
    return amt !== 0 && !['CGST', 'SGST', 'IGST'].includes((d.name || '').toUpperCase());
  });

  const sumAdditionalCharges = appliedCharges.reduce((acc: number, d: any) => {
    const amt = parseFloat(d.amount) || 0;
    return acc + (d.type === 'Deduction' ? -Math.abs(amt) : amt);
  }, 0);

  const taxableVal = invoice.total_without_gst !== undefined ? parseFloat(invoice.total_without_gst) : totalAmount;
  const gstVal = invoice.total_gst !== undefined ? parseFloat(invoice.total_gst) : (isInterState ? totalIgst : (totalCgst + totalSgst));
  const grandTotalVal = invoice.grand_total !== undefined ? parseFloat(invoice.grand_total) : (taxableVal + gstVal + sumAdditionalCharges);

  // Bank Details
  const bankName = payment?.bank_name || company?.bank_name || company?.raw_data?.bank_name || '';
  const bankHolder = payment?.account_holder || company?.account_holder || company?.account_name || company?.raw_data?.account_holder || '';
  const bankAccount = payment?.account_number || company?.account_number || company?.raw_data?.account_number || '';
  const bankIfsc = payment?.ifsc || company?.ifsc_code || company?.ifsc || company?.raw_data?.ifsc || '';
  const bankUpi = payment?.upi_id || company?.upi_id || company?.raw_data?.upi_id || '';

  // Dynamic compression for single-page print layout when items > 8
  const itemCount = calculatedItems.length;
  let sheetPadding = 'p-8';
  let sectionMb = 'mb-6';
  let sectionGap = 'gap-8';
  let rowHeight = 'h-9';
  let cellPy = 'py-2';
  let headerPy = 'py-2';
  let titleSize = 'text-[24px]';
  let textSize = 'text-[12px]';
  let spaceY = 'space-y-1.5';
  const blankRowsNeeded = Math.max(0, 8 - itemCount);

  if (itemCount > 8 && itemCount <= 12) {
    sheetPadding = 'p-6';
    sectionMb = 'mb-4';
    sectionGap = 'gap-6';
    rowHeight = 'h-7';
    cellPy = 'py-1';
    headerPy = 'py-1.5';
    titleSize = 'text-[21px]';
    textSize = 'text-[11px]';
    spaceY = 'space-y-1';
  } else if (itemCount > 12 && itemCount <= 16) {
    sheetPadding = 'p-5';
    sectionMb = 'mb-3';
    sectionGap = 'gap-4';
    rowHeight = 'h-6';
    cellPy = 'py-0.5';
    headerPy = 'py-1';
    titleSize = 'text-[18px]';
    textSize = 'text-[10px]';
    spaceY = 'space-y-0.5';
  } else if (itemCount > 16) {
    sheetPadding = 'p-4';
    sectionMb = 'mb-2';
    sectionGap = 'gap-2';
    rowHeight = 'h-5';
    cellPy = 'py-[1px]';
    headerPy = 'py-0.5';
    titleSize = 'text-[16px]';
    textSize = 'text-[9px]';
    spaceY = 'space-y-0.5';
  }

  const handlePrint = () => {
    if (!invoiceRef.current) return;
    const htmlContent = invoiceRef.current.outerHTML;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Tax Invoice - ${invoiceNo}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
              * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                box-sizing: border-box;
              }
              html, body {
                font-family: 'Inter', system-ui, -apple-system, sans-serif;
                margin: 0;
                padding: 0;
                background-color: #ffffff;
                color: #1e293b;
                height: 100%;
                overflow: hidden !important;
              }
              @page {
                size: A4 portrait;
                margin: 5mm !important;
              }
              @media print {
                body {
                  background: white;
                  color: black;
                }
                .print\\:hidden {
                  display: none !important;
                }
                .single-page-wrapper {
                  max-height: 100vh !important;
                  overflow: hidden !important;
                  page-break-inside: avoid !important;
                  page-break-before: avoid !important;
                  page-break-after: avoid !important;
                }
              }
            </style>
          </head>
          <body class="p-2 bg-white print:p-0">
            <div class="max-w-[850px] mx-auto bg-white print:max-w-none print:w-full single-page-wrapper">
              ${htmlContent}
            </div>
            <script>
              window.addEventListener('load', () => {
                setTimeout(() => {
                  window.print();
                  window.close();
                }, 400);
              });
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center bg-slate-900/80 backdrop-blur-sm p-4 pt-20 pb-8 overflow-y-auto print:p-0 print:bg-white print:fixed print:inset-0 font-sans">
      {/* Top Floating Control Bar */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 flex items-center space-x-3 bg-slate-950 text-white px-5 py-2.5 rounded-full shadow-2xl print:hidden z-[101] border border-slate-800">
        <span className="font-bold text-[12px] text-slate-300 mr-2">Tax Invoice Print Preview</span>
        <button
          onClick={handlePrint}
          className="flex items-center space-x-1.5 bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-full font-bold text-[12px] transition-all shadow-md active:scale-95"
        >
          <Printer className="w-4 h-4" />
          <span>Print Invoice</span>
        </button>
        <button
          onClick={onClose}
          className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white rounded-full transition-colors"
          title="Close Preview"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Invoice Printable Sheet */}
      <div
        ref={invoiceRef}
        className={`bg-white text-slate-900 w-full max-w-[800px] mx-auto ${sheetPadding} border border-slate-200 ${textSize} leading-snug flex flex-col justify-between ${itemCount <= 8 ? 'min-h-[1050px]' : 'min-h-0'}`}
      >
        <div>
          {/* 1. Top Header Grid */}
          <div className={`grid grid-cols-2 ${sectionGap} border-b border-slate-300 pb-4 ${sectionMb}`}>
            {/* Left Column: Company Info */}
            <div className={`pr-4 ${spaceY}`}>
              <h1 className={`${titleSize} font-semibold text-[#dc2626] tracking-tight leading-none`}>
                {companyName}
              </h1>
              <div className={`${spaceY} ${textSize}`}>
                <div className="flex justify-between">
                  <span className="text-slate-500">Phone</span>
                  <span className="font-normal text-slate-800">{companyPhone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">GSTIN</span>
                  <span className="font-normal text-slate-800">{companyGstin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Address</span>
                  <span className="font-normal text-slate-800 text-right max-w-[220px]">{companyAddress}</span>
                </div>
              </div>
            </div>

            {/* Right Column: Invoice Info */}
            <div className={`pl-6 border-l border-slate-300 ${spaceY}`}>
              <h2 className={`${titleSize} font-normal text-slate-900 tracking-tight leading-none`}>
                Tax Invoice
              </h2>
              <div className={`${spaceY} ${textSize}`}>
                <div className="flex justify-between">
                  <span className="text-slate-500">Invoice Number</span>
                  <span className="font-normal text-slate-800">{invoiceNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Invoice Date</span>
                  <span className="font-normal text-slate-800">{invoiceDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Purchase Order Number</span>
                  <span className="font-normal text-slate-800">{poNumber}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Billed To / Shipped To Grid */}
          <div className={sectionMb}>
            {/* Gray Title Bar */}
            <div className={`grid grid-cols-2 bg-[#f1f5f9] px-4 py-1.5 ${textSize} border border-slate-300`}>
              <div className="flex justify-between pr-4">
                <span className="text-slate-500">Billed to</span>
                <span className="font-semibold text-slate-900">{customerName}</span>
              </div>
              <div className="flex justify-between pl-4 border-l border-slate-300">
                <span className="text-slate-500">Shipped to</span>
                <span className="font-semibold text-slate-900">{shipToName}</span>
              </div>
            </div>

            {/* Content Below Bar */}
            <div className={`grid grid-cols-2 px-4 py-2 ${textSize} border-x border-b border-slate-300`}>
              <div className={`pr-4 ${spaceY}`}>
                <div className="flex justify-between">
                  <span className="text-slate-500">GSTIN</span>
                  <span className="font-normal text-slate-800">{customerGstin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Phone</span>
                  <span className="font-normal text-slate-800">{customerPhone}</span>
                </div>
              </div>
              <div className={`pl-4 border-l border-slate-300 ${spaceY}`}>
                <div className="flex justify-between">
                  <span className="text-slate-500">Address</span>
                  <span className="font-normal text-slate-800 text-right max-w-[220px]">{shipToAddress}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">State & Country</span>
                  <span className="font-normal text-slate-800">{customerStateCountry}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Items Table */}
          <div className={sectionMb}>
            <table className={`w-full text-left ${textSize} border-collapse`}>
              <thead>
                <tr className="bg-[#dc2626] text-white font-medium">
                  <th className={`${headerPy} px-2 text-center w-[4%] font-medium`}>Sr</th>
                  <th className={`${headerPy} px-3 text-left w-[28%] font-medium`}>Particulars</th>
                  <th className={`${headerPy} px-2 text-center w-[9%] font-medium`}>HSN</th>
                  <th className={`${headerPy} px-2 text-right w-[7%] font-medium`}>QTY</th>
                  <th className={`${headerPy} px-2 text-right w-[10%] font-medium`}>Rate</th>
                  <th className={`${headerPy} px-2 text-right w-[11%] font-medium`}>Amount</th>
                  <th className={`${headerPy} px-2 text-right w-[7%] font-medium`}>Tax %</th>
                  <th className={`${headerPy} px-2 text-right w-[8%] font-medium`}>{isInterState ? 'IGST' : 'CGST'}</th>
                  <th className={`${headerPy} px-2 text-right w-[8%] font-medium`}>{isInterState ? '—' : 'SGST'}</th>
                  <th className={`${headerPy} px-2 text-right w-[8%] font-medium`}>Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {calculatedItems.map((item: any, idx: number) => (
                  <tr key={`item-${idx}`} className={rowHeight}>
                    <td className={`${cellPy} px-2 text-center text-slate-500`}>{idx + 1}</td>
                    <td className={`${cellPy} px-3 text-left font-normal text-slate-900`}>{item.name}</td>
                    <td className={`${cellPy} px-2 text-center text-slate-600`}>{item.hsn}</td>
                    <td className={`${cellPy} px-2 text-right`}>{item.qty}</td>
                    <td className={`${cellPy} px-2 text-right`}>{item.rate.toFixed(2)}</td>
                    <td className={`${cellPy} px-2 text-right`}>{item.amount.toFixed(2)}</td>
                    <td className={`${cellPy} px-2 text-right`}>{item.taxRate}%</td>
                    <td className={`${cellPy} px-2 text-right`}>{isInterState ? item.igst.toFixed(2) : item.cgst.toFixed(2)}</td>
                    <td className={`${cellPy} px-2 text-right`}>{isInterState ? '—' : item.sgst.toFixed(2)}</td>
                    <td className={`${cellPy} px-2 text-right text-slate-900`}>{item.subtotal.toFixed(2)}</td>
                  </tr>
                ))}
                {Array.from({ length: blankRowsNeeded }).map((_, idx) => (
                  <tr key={`blank-${idx}`} className={rowHeight}>
                    <td className={`${cellPy} px-2 text-center text-slate-300`}>&nbsp;</td>
                    <td className={`${cellPy} px-3 text-left`}>&nbsp;</td>
                    <td className={`${cellPy} px-2 text-center`}>&nbsp;</td>
                    <td className={`${cellPy} px-2 text-right`}>&nbsp;</td>
                    <td className={`${cellPy} px-2 text-right`}>&nbsp;</td>
                    <td className={`${cellPy} px-2 text-right`}>&nbsp;</td>
                    <td className={`${cellPy} px-2 text-right`}>&nbsp;</td>
                    <td className={`${cellPy} px-2 text-right`}>&nbsp;</td>
                    <td className={`${cellPy} px-2 text-right`}>&nbsp;</td>
                    <td className={`${cellPy} px-2 text-right`}>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
              {/* Total Row */}
              <tfoot>
                <tr className={`bg-[#f1f5f9] font-semibold text-slate-900 ${textSize} border-t border-b border-slate-300`}>
                  <td className={`${headerPy} px-2`}></td>
                  <td className={`${headerPy} px-3 text-left`}>Total</td>
                  <td className={`${headerPy} px-2`}></td>
                  <td className={`${headerPy} px-2 text-right`}>{totalQty}</td>
                  <td className={`${headerPy} px-2`}></td>
                  <td className={`${headerPy} px-2 text-right`}>{totalAmount.toFixed(2)}</td>
                  <td className={`${headerPy} px-2`}></td>
                  <td className={`${headerPy} px-2 text-right`}>{isInterState ? totalIgst.toFixed(2) : totalCgst.toFixed(2)}</td>
                  <td className={`${headerPy} px-2 text-right`}>{isInterState ? '—' : totalSgst.toFixed(2)}</td>
                  <td className={`${headerPy} px-2 text-right`}>{totalSubtotal.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 4. Grand Total in Words & Calculations Grid */}
          <div className={`grid grid-cols-2 ${sectionGap} ${sectionMb} pt-1`}>
            {/* Left: Grand Total in Words */}
            <div className="pr-4">
              <div className={`${textSize} italic text-slate-500 mb-1`}>
                Grand Total in words
              </div>
              <div className="border-b border-slate-300 pb-1 mb-2"></div>
              <div className={`${textSize} font-normal text-slate-900`}>
                {numberToWords(grandTotalVal)}
              </div>
            </div>

            {/* Right: Amounts & Additional Charges */}
            <div className={`pl-4 ${spaceY} ${textSize}`}>
              <div className="flex justify-between">
                <span className="text-slate-600">Taxable Amount</span>
                <span className="text-slate-900">{taxableVal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">GST Amount</span>
                <span className="text-slate-900">{gstVal.toFixed(2)}</span>
              </div>

              {/* Additional Charges Block */}
              {appliedCharges.length > 0 && (
                <div className="pt-2">
                  <div className="font-semibold text-slate-800 mb-1">
                    Additional Charges
                  </div>
                  <div className="border-b border-slate-300 mb-2"></div>
                  <div className={spaceY}>
                    {appliedCharges.map((ch: any, idx: number) => (
                      <div key={idx} className={`flex justify-between ${textSize}`}>
                        <span className="text-slate-600">{ch.name}</span>
                        <span className="text-slate-900">
                          {ch.type === 'Deduction' ? `-${Math.abs(ch.amount).toFixed(2)}` : parseFloat(ch.amount || 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Grand Total Bar */}
              <div className={`bg-[#f1f5f9] px-3 py-1.5 flex justify-between font-bold ${textSize} text-slate-900 border border-slate-300 mt-2`}>
                <span>Grand Total</span>
                <span>{grandTotalVal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 5. Footer: Bank Details & Authorized Signatory */}
        <div className={`grid grid-cols-2 ${sectionGap} border-t border-slate-300 pt-4 mt-auto`}>
          {/* Left: Bank Details */}
          <div className="pr-4 space-y-1.5">
            <div className={`${textSize} italic text-slate-500 mb-1`}>
              Bank Details
            </div>
            <div className="border-b border-slate-300 pb-0.5 mb-1.5"></div>
            <div className={`space-y-0.5 ${textSize}`}>
              <div className="flex justify-between">
                <span className="text-slate-500">Bank</span>
                <span className="font-semibold text-slate-800">{bankName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">A/c Holder</span>
                <span className="font-semibold text-slate-800">{bankHolder}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">A/c Number</span>
                <span className="font-semibold text-slate-800">{bankAccount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">IFSC Code</span>
                <span className="font-semibold text-slate-800">{bankIfsc}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">UPI ID</span>
                <span className="font-semibold text-slate-800">{bankUpi}</span>
              </div>
            </div>
          </div>

          {/* Right: Authorized Signatory */}
          <div className="pl-4 flex flex-col justify-between items-end text-right">
            <div className={`${textSize} italic text-slate-600`}>
              for {companyName}
            </div>
            <div className="w-48 border-b border-slate-300 mt-8 mb-1"></div>
            <div className={`${textSize} italic text-slate-600 w-48 text-center`}>
              Authorized Signatory
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoicePrintModal;
