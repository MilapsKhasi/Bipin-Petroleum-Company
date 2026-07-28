
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { migrateCustomersToParties } from '../utils/partiesMigration';

interface Company {
  id: string;
  name: string;
  gstin?: string;
  address?: string;
}

interface CompanyContextType {
  activeCompany: Company | null;
  loading: boolean;
  setCompany: (company: Company) => Promise<void>;
  refresh: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
          console.warn("Context refresh session offline warning:", error.message);
        } else {
          console.error("Context refresh session error:", error);
        }
        if (!error.message?.includes('Failed to fetch') && !error.message?.includes('NetworkError')) {
          localStorage.clear();
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch (signOutError) {
            console.error("Local sign out error during context recovery:", signOutError);
          }
        }
        setActiveCompany(null);
        return;
      }
      const session = data?.session;
      if (!session) {
        setActiveCompany(null);
        return;
      }

      const isRealUser = session.user.id !== 'local-user-1';

      // 1. Check profiles table for active_company_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_company_id')
        .eq('id', session.user.id)
        .maybeSingle();

      const storedId = localStorage.getItem('activeCompanyId');
      let targetId = profile?.active_company_id || storedId;

      if (isRealUser && targetId === 'local-company-1') {
        targetId = null;
        localStorage.removeItem('activeCompanyId');
        localStorage.removeItem('activeCompanyName');
      }

      if (targetId) {
        const { data: company } = await supabase
          .from('companies')
          .select('*')
          .eq('id', targetId)
          .eq('is_deleted', false)
          .maybeSingle();

        if (company && (!isRealUser || company.id !== 'local-company-1')) {
          setActiveCompany(company);
          localStorage.setItem('activeCompanyId', company.id);
          localStorage.setItem('activeCompanyName', company.name);
          setLoading(false);
          return;
        }
      }

      // If no valid active company target found, load actual user workspaces
      let query = supabase.from('companies').select('*').eq('is_deleted', false);
      if (isRealUser) {
        query = query.or(`created_by.eq.${session.user.id},user_id.eq.${session.user.id}`);
      }
      const { data: userCompanies } = await query.order('name');
      const filtered = (userCompanies || []).filter((c: any) => {
        if (isRealUser && c.id === 'local-company-1') return false;
        return true;
      });

      if (filtered.length > 0) {
        const firstComp = filtered[0];
        setActiveCompany(firstComp);
        localStorage.setItem('activeCompanyId', firstComp.id);
        localStorage.setItem('activeCompanyName', firstComp.name);
        if (isRealUser) {
          await supabase.from('profiles').upsert({ id: session.user.id, active_company_id: firstComp.id });
        }
      } else {
        setActiveCompany(null);
        localStorage.removeItem('activeCompanyId');
        localStorage.removeItem('activeCompanyName');
      }
    } catch (err: any) {
      if (err?.message?.includes('Failed to fetch') || err?.name === 'TypeError') {
        console.warn("Context refresh offline unexpected warning:", err?.message || err);
      } else {
        console.error("Context refresh error:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  const setCompany = async (company: Company) => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Context setCompany session error:", error);
        return;
      }
      const session = data?.session;
      if (!session) return;

      // Sync to Supabase Profile for RLS
      await supabase
        .from('profiles')
        .upsert({ id: session.user.id, active_company_id: company.id });

      localStorage.setItem('activeCompanyId', company.id);
      localStorage.setItem('activeCompanyName', company.name);
      setActiveCompany(company);
    } catch (err) {
      console.error("Context setCompany error:", err);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (activeCompany?.id) {
      migrateCustomersToParties(activeCompany.id);
    }
  }, [activeCompany?.id]);

  return (
    <CompanyContext.Provider value={{ activeCompany, loading, setCompany, refresh }}>
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};
