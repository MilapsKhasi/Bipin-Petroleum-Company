import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ReceiptText, BarChart3, Package, Calculator, Users, Wallet, ShoppingBag, Contact } from 'lucide-react';

const Sidebar = () => {
  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, shortcut: 'D' },
    { name: 'Sales Invoices', path: '/sales', icon: ShoppingBag, shortcut: 'I' },
    { name: 'Parties', path: '/parties', icon: Contact, shortcut: 'P' },
    { name: 'Purchase Bills', path: '/bills', icon: ReceiptText, shortcut: 'B' },
    { name: 'Stock Master', path: '/stock', icon: Package, shortcut: 'S' },
    { name: 'Cashbook', path: '/cashbook', icon: Wallet, shortcut: 'K' },
    { name: 'Additional Charges', path: '/additional-charges', icon: Calculator, shortcut: 'T' },
    { name: 'Reports', path: '/reports', icon: BarChart3, shortcut: 'R' },
  ];

  return (
    <aside className="w-64 border-r border-slate-200 h-full py-4 flex flex-col shrink-0 bg-white z-10 overflow-y-auto transition-none">
      <nav className="space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.name + item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center px-6 py-3 text-[14px] font-medium transition-none ${
                isActive
                  ? 'bg-primary text-white border-r-4 border-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`
            }
          >
            <div className="flex items-center space-x-4 min-w-0">
              <item.icon className="w-4 h-4 shrink-0 opacity-70" />
              <span className="truncate capitalize">{item.name}</span>
            </div>
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-3 border-t border-slate-100 text-center shrink-0">
        <p className="text-[11px] font-medium text-slate-500 tracking-wide whitespace-nowrap">
          Powered by <span className="text-primary font-bold">ZenterPrime</span>
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;