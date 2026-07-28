
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Database, AlertCircle, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSqlHelp, setShowSqlHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Clear offline flag when attempting online account authentication
    localStorage.removeItem('use_offline_mode');
    if (localStorage.getItem('activeCompanyId') === 'local-company-1') {
      localStorage.removeItem('activeCompanyId');
      localStorage.removeItem('activeCompanyName');
    }

    try {
      if (isLogin) {
        const { data: authData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) throw loginError;
        
        // Save user info to 'users' table
        if (authData?.user) {
          try {
            await supabase.from('users').upsert({
              id: authData.user.id,
              email: authData.user.email,
              created_at: authData.user.created_at || new Date().toISOString()
            });
          } catch (upsertErr) {
            console.error("Failed to upsert to users table:", upsertErr);
          }
        }

        // On success, navigate to companies selection immediately
        navigate('/companies');
      } else {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        
        // Save user info to 'users' table
        if (signUpData?.user) {
          try {
            await supabase.from('users').upsert({
              id: signUpData.user.id,
              email: signUpData.user.email,
              created_at: signUpData.user.created_at || new Date().toISOString()
            });
          } catch (upsertErr) {
            console.error("Failed to upsert to users table:", upsertErr);
          }
        }
        alert('Check your email for the confirmation link!');
      }
    } catch (err: any) {
      console.error("Auth error details:", err);
      let errorMessage = err.message || 'Authentication failed';
      
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError') || errorMessage.includes('Invalid path') || err.name === 'TypeError') {
        errorMessage = "Connection Error: Unable to reach the server. Please check your internet connection or ensure the Supabase project URL is valid.";
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FC] flex items-center justify-center p-6 font-sans">
      <div className={`w-full ${showSqlHelp ? 'max-w-2xl' : 'max-w-sm'} bg-primary rounded-[10px] p-2 transition-all duration-300 border border-slate-200/20 shadow-none`}>
        <div className="text-center py-6">
          <h1 className="text-xl font-bold text-white tracking-tight">Bipin Petroleum Co.</h1>
          <p className="text-[11px] font-semibold text-blue-100 tracking-widest uppercase mt-0.5">Powered by ZenterPrime</p>
          <h2 className="text-sm font-medium text-blue-100/80 mt-3 pt-3 border-t border-white/10">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
        </div>

        <div className="bg-white rounded-[10px] p-6 pb-10 shadow-none">
          <form onSubmit={handleLogin} className="space-y-6">
            {error && (
              <div className="space-y-3">
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs rounded-[10px] font-semibold animate-shake flex items-start">
                  <AlertCircle className="w-4 h-4 text-red-500 mr-2 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
                {error.toLowerCase().includes("saving new user") && (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-[10px] space-y-2 leading-relaxed">
                    <p className="font-bold text-amber-950 flex items-center">
                      <Database className="w-4 h-4 mr-1.5" />
                      Trigger / Schema Mismatch Detected
                    </p>
                    <p>An old or mismatched trigger in your Supabase database is blocking registration. Run the complete Database Setup SQL below to clear conflicting triggers and set up the correct schema.</p>
                    <button
                      type="button"
                      onClick={() => setShowSqlHelp(true)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold text-[10px] uppercase tracking-wider"
                    >
                      View Setup SQL Script
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-900 ml-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-[#f9f9f9] border border-slate-200 rounded-[10px] outline-none focus:border-primary font-medium text-slate-900 transition-all placeholder:text-slate-300 text-sm shadow-none"
                  placeholder="Your Email Address"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-900 ml-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[#f9f9f9] border border-slate-200 rounded-[10px] outline-none focus:border-primary font-medium text-slate-900 transition-all placeholder:text-slate-300 text-sm shadow-none"
                  placeholder="Your Password"
                />
              </div>
            </div>

            <div className="pt-2 space-y-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-[10px] font-bold bg-primary text-white hover:bg-primary-dark transition-all flex items-center justify-center disabled:opacity-50 text-xs tracking-[0.15em] border border-transparent active:scale-[0.98] shadow-none"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : 'GET STARTED'} 
              </button>

              <button
                type="button"
                onClick={() => {
                  localStorage.setItem('use_offline_mode', 'true');
                  localStorage.setItem('local_session_user', JSON.stringify({ id: 'local-user-1', email: 'offline@zenterprime.com', created_at: new Date().toISOString() }));
                  localStorage.setItem('activeCompanyId', 'local-company-1');
                  localStorage.setItem('activeCompanyName', 'Local Demo Company');
                  window.location.href = '/';
                }}
                className="w-full py-3.5 rounded-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center justify-center text-xs tracking-[0.1em] border border-slate-200"
              >
                USE OFFLINE LOCAL MODE
              </button>

              <div className="flex flex-col space-y-3">
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="w-full text-center text-[10px] text-slate-400 font-medium text-xs leading-normal"
                >
                  {isLogin ? (
                    <>Don't have an account? <span className="text-primary font-bold uppercase ml-1">SIGN UP</span></>
                  ) : (
                    <>Already have an account? <span className="text-primary font-bold uppercase ml-1">LOGIN</span></>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowSqlHelp(!showSqlHelp)}
                  className="w-full text-center text-[10px] text-slate-400 hover:text-slate-600 font-bold flex items-center justify-center space-x-1 uppercase tracking-wider text-xs leading-normal pt-1"
                >
                  <Database className="w-3.5 h-3.5 mr-1 text-primary/70" />
                  <span>{showSqlHelp ? 'Hide Setup SQL' : 'Database Setup SQL Instructions'}</span>
                  {showSqlHelp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </form>

          {showSqlHelp && (
            <div className="mt-6 p-5 bg-slate-900 text-slate-100 rounded-[10px] border border-slate-800 text-xs space-y-3 animate-in fade-in slide-in-from-top-4 duration-300 text-left">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-400 uppercase tracking-wider text-[10px]">Database Setup SQL Script</span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const sql = `-- 0. Clean up any old/conflicting triggers, functions, and tables
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS on_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS sync_user ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.sync_user() CASCADE;

DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;
DROP TABLE IF EXISTS public.login_verifications CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.vendors CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.purchase_bills CASCADE;
DROP TABLE IF EXISTS public.sales_invoices CASCADE;
DROP TABLE IF EXISTS public.stock_items CASCADE;
DROP TABLE IF EXISTS public.duties_taxes CASCADE;
DROP TABLE IF EXISTS public.cashbooks CASCADE;

-- 1. Create Profiles Table for Multi-tenancy Context
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  active_company_id uuid,
  full_name text,
  created_at timestamptz DEFAULT now()
);

-- 2. Create Core Tables
CREATE TABLE public.companies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, 
  name text NOT NULL, 
  gstin text, 
  address text, 
  is_deleted boolean DEFAULT false, 
  created_at timestamptz DEFAULT now(), 
  user_id uuid DEFAULT auth.uid(),
  created_by uuid DEFAULT auth.uid()
);

-- 2.1 Create OTP Verification Table
CREATE TABLE public.login_verifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  otp text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2.2 Create Users Table
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2.3 Create Vendors and Customers Tables
CREATE TABLE public.vendors (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, name text NOT NULL, email text, phone text, gstin text, pan text, state text, account_number text, account_name text, ifsc_code text, address text, balance numeric DEFAULT 0, party_type text DEFAULT 'vendor', is_customer boolean DEFAULT false, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.customers (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, name text NOT NULL, email text, phone text, gstin text, pan text, state text, account_number text, account_name text, ifsc_code text, address text, balance numeric DEFAULT 0, party_type text DEFAULT 'customer', is_customer boolean DEFAULT true, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());

-- 2.4 Create Bills and Invoices Tables
CREATE TABLE public.purchase_bills (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, vendor_name text NOT NULL, bill_number text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE, total_without_gst numeric DEFAULT 0, total_gst numeric DEFAULT 0, grand_total numeric DEFAULT 0, status text DEFAULT 'Pending', is_deleted boolean DEFAULT false, description text, items jsonb DEFAULT '{}'::jsonb, round_off numeric DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE public.sales_invoices (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, customer_name text NOT NULL, invoice_number text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE, total_without_gst numeric DEFAULT 0, total_gst numeric DEFAULT 0, grand_total numeric DEFAULT 0, status text DEFAULT 'Pending', is_deleted boolean DEFAULT false, description text, items jsonb DEFAULT '{}'::jsonb, round_off numeric DEFAULT 0, created_at timestamptz DEFAULT now());

-- 2.5 Create Stock, Duties and Taxes, and Cashbook Tables
CREATE TABLE public.stock_items (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, name text NOT NULL, hsn text, rate numeric DEFAULT 0, selling_price numeric DEFAULT 0, tax_rate numeric DEFAULT 0, unit text DEFAULT 'PCS', in_stock numeric DEFAULT 0, sku text, description text, kg_per_bag numeric DEFAULT 0, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.duties_taxes (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, name text NOT NULL, type text DEFAULT 'Charge', calc_method text DEFAULT 'Percentage', rate numeric DEFAULT 0, fixed_amount numeric DEFAULT 0, apply_on text DEFAULT 'Subtotal', applicable_to text DEFAULT 'Both', is_default boolean DEFAULT false, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.cashbooks (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE, date date NOT NULL, income_total numeric DEFAULT 0, expense_total numeric DEFAULT 0, balance numeric DEFAULT 0, raw_data jsonb DEFAULT '{}'::jsonb, is_deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());

-- 3. Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duties_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_verifications ENABLE ROW LEVEL SECURITY;

-- 4. Set Policies
CREATE POLICY "Users can manage own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id);
CREATE POLICY "Manage own companies" ON public.companies FOR ALL TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Manage own users" ON public.users FOR ALL TO authenticated USING (auth.uid() = id);
CREATE POLICY "Manage company vendors" ON public.vendors FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company customers" ON public.customers FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company purchase bills" ON public.purchase_bills FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company sales" ON public.sales_invoices FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company stock" ON public.stock_items FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company taxes" ON public.duties_taxes FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage company cashbook" ON public.cashbooks FOR ALL TO authenticated USING (company_id IN (SELECT id FROM companies WHERE created_by = auth.uid()));
CREATE POLICY "Manage own OTPs" ON public.login_verifications FOR ALL TO authenticated USING (auth.uid() = user_id);

-- 5. Auto-create user profiles & records on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at)
  VALUES (new.id, new.email, now())
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.profiles (id, created_at)
  VALUES (new.id, now())
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();`;
                      await navigator.clipboard.writeText(sql);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex items-center space-x-1 px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-[10px] font-bold"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                    {copied ? "COPIED!" : "COPY COMPLETE SQL"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSqlHelp(false)}
                    className="px-2 py-1 text-[10px] text-slate-400 hover:text-white uppercase font-bold"
                  >
                    Hide
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Run this SQL query in your <strong>Supabase Dashboard &gt; SQL Editor &gt; New Query</strong> to set up all tables, enable RLS, configure access control policies, and link auth signup automation.
              </p>
              <pre className="p-2.5 bg-black/50 text-emerald-400 font-mono text-[9px] rounded-lg max-h-[180px] overflow-y-auto select-all leading-normal whitespace-pre-wrap">
{`-- Run this SQL in Supabase SQL Editor to initialize and fix user signup:

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS on_user_created ON auth.users CASCADE;
DROP TRIGGER IF EXISTS sync_user ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.sync_user() CASCADE;

CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  active_company_id uuid,
  full_name text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- (Click "Copy SQL" above for the complete schema, RLS policies, and triggers)`}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;

