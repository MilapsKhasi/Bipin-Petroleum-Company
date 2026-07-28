import React, { useState, useEffect } from 'react';
import { X, Gift, Zap, Shield, Layout } from 'lucide-react';

const CURRENT_VERSION = 'ZP-26.07.01';
const STORAGE_KEY = `version_popup_shown_${CURRENT_VERSION}`;

const UpdateNotification = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const hasShown = localStorage.getItem(STORAGE_KEY);
    if (!hasShown) {
      // Small delay to not overwhelm user immediately upon login/load
      const timer = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={handleClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-slate-800">
        <div className="relative h-32 bg-primary overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent" />
            <Gift className="w-16 h-16 text-white animate-bounce" />
            <button 
                onClick={handleClose}
                className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
        
        <div className="p-8">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Bipin Petroleum Co. - Version ZP-26.07.01 Released!</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Experience the next evolution of your digital finance desk with our latest update.</p>
            
            <div className="space-y-4 mb-8">
                <div className="flex items-start space-x-3">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg shrink-0"><Layout className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                    <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wide">Fresh New Look</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Complete transition to Bipin Petroleum Co. with a modern, accessible color palette.</p>
                    </div>
                </div>
                <div className="flex items-start space-x-3">
                    <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg shrink-0"><Zap className="w-4 h-4 text-purple-600 dark:text-purple-400" /></div>
                    <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wide">Enhanced Performance</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Optimized workflows for faster billing and inventory management.</p>
                    </div>
                </div>
                <div className="flex items-start space-x-3">
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg shrink-0"><Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /></div>
                    <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wide">Improved Stability</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Critical bug fixes and security enhancements.</p>
                    </div>
                </div>
            </div>

            <button 
                onClick={handleClose}
                className="w-full py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:bg-primary-dark transition-all active:scale-95"
            >
                Explore Now
            </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateNotification;
