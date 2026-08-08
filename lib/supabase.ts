import { createClient } from '@supabase/supabase-js';
import { 
  initIndexedDB, 
  idbMemoryCache, 
  saveAllToIDB, 
  upsertToIDB, 
  deleteFromIDB, 
  IDBStoreName 
} from './idb';
import { enqueueOfflineOp } from './syncEngine';

if (typeof window !== 'undefined') {
  initIndexedDB().catch((err) => console.warn('[IndexedDB] Init warning:', err));
}

const rawUrl = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_URL.trim().length > 0)
  ? import.meta.env.VITE_SUPABASE_URL
  : 'https://blbaolnlzohguwqiyflg.supabase.co';

const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY && import.meta.env.VITE_SUPABASE_ANON_KEY.trim().length > 0)
  ? import.meta.env.VITE_SUPABASE_ANON_KEY
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsYmFvbG5sem9oZ3V3cWl5ZmxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxMjY2ODgsImV4cCI6MjA4MzcwMjY4OH0.nGCG_M3-m2hNnP8Nu0aftZ1Ug0OheU5GmbGNr-Iwxxg';

const supabaseUrl = rawUrl.trim().replace(/['"]/g, '').replace(/\/+$/, '');
const supabaseAnonKey = rawKey.trim().replace(/['"]/g, '');

const finalUrl = supabaseUrl.startsWith('http') ? supabaseUrl : `https://${supabaseUrl}`;

export const realSupabase = createClient(finalUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  global: {
    fetch: (...args) => fetch(...args)
  }
});

function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : (err.message || err.details || err.toString() || '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('fetch failed') ||
    lower.includes('invalid path') ||
    lower.includes('invalid url') ||
    lower.includes('invalid request') ||
    err.name === 'TypeError'
  );
}

function enableOfflineMode() {
  if (typeof window !== 'undefined') {
    seedLocalStorage();
  }
}

export async function clearOfflineWorkspaceCache() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('activeCompanyId');
    localStorage.removeItem('activeCompanyName');
    localStorage.removeItem('local_session_user');
    localStorage.removeItem('use_offline_mode');
    const tables = [
      'companies',
      'profiles',
      'sales_invoices',
      'purchase_bills',
      'customers',
      'vendors',
      'stock_items',
      'cashbook',
      'cashbooks',
      'duties_taxes',
      'delivery_challans',
      'payment_vouchers'
    ] as const;
    for (const t of tables) {
      localStorage.removeItem(`local_db_${t}`);
      idbMemoryCache[t] = [];
      await saveAllToIDB(t as IDBStoreName, []);
    }
  }
}

let isSyncingWorkspaces = false;

export async function syncUserWorkspaceDataToIndexedDB(userId: string) {
  if (!userId || isSyncingWorkspaces || (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true')) {
    return;
  }
  isSyncingWorkspaces = true;

  try {
    console.log(`[IndexedDB Sync] Syncing workspace data for user: ${userId}`);

    // Fetch user's accessible companies
    const { data: companies, error: compErr } = await realSupabase
      .from('companies')
      .select('*')
      .or(`created_by.eq.${userId},user_id.eq.${userId}`)
      .eq('is_deleted', false);

    if (compErr || !companies) {
      console.warn('[IndexedDB Sync] Could not fetch companies:', compErr);
      isSyncingWorkspaces = false;
      return;
    }

    // Save ONLY user's accessible companies to storage
    await saveAllToIDB('companies', companies);
    idbMemoryCache['companies'] = companies;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('local_db_companies', JSON.stringify(companies));
    }

    const companyIds = companies.map((c: any) => c.id).filter(Boolean);

    // Validate activeCompanyId
    if (typeof localStorage !== 'undefined') {
      const currentActiveId = localStorage.getItem('activeCompanyId');
      const isValidActive = companyIds.includes(currentActiveId);
      if (!isValidActive && companyIds.length > 0) {
        localStorage.setItem('activeCompanyId', companies[0].id);
        localStorage.setItem('activeCompanyName', companies[0].name || '');
      } else if (companyIds.length === 0) {
        localStorage.removeItem('activeCompanyId');
        localStorage.removeItem('activeCompanyName');
      }
    }

    // Fetch user profile
    const { data: profile } = await realSupabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (profile) {
      await saveAllToIDB('profiles', [profile]);
      idbMemoryCache['profiles'] = [profile];
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('local_db_profiles', JSON.stringify([profile]));
      }
    }

    const workspaceTables = [
      'sales_invoices',
      'purchase_bills',
      'customers',
      'vendors',
      'stock_items',
      'cashbook',
      'cashbooks',
      'duties_taxes',
      'delivery_challans',
      'payment_vouchers'
    ] as const;

    if (companyIds.length === 0) {
      for (const table of workspaceTables) {
        await saveAllToIDB(table as IDBStoreName, []);
        idbMemoryCache[table] = [];
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`local_db_${table}`, JSON.stringify([]));
        }
      }
      isSyncingWorkspaces = false;
      return;
    }

    // Sync workspace-specific data for these company IDs only
    for (const table of workspaceTables) {
      try {
        const { data: rows } = await realSupabase
          .from(table)
          .select('*')
          .in('company_id', companyIds);

        const validRows = (rows && Array.isArray(rows)) ? rows : [];
        await saveAllToIDB(table as IDBStoreName, validRows);
        idbMemoryCache[table] = validRows;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`local_db_${table}`, JSON.stringify(validRows));
        }
      } catch (tableErr) {
        console.warn(`[IndexedDB Sync] Error syncing table ${table}:`, tableErr);
      }
    }

    console.log(`[IndexedDB Sync] Finished caching ${companyIds.length} workspace(s) for user ${userId}.`);
  } catch (err) {
    console.warn('[IndexedDB Sync] Unexpected error during sync:', err);
  } finally {
    isSyncingWorkspaces = false;
  }
}

function autoCacheOnlineResult(table: string, result: any) {
  if (!result || result.error || !result.data) return;
  const data = result.data;
  if (Array.isArray(data)) {
    if (data.length > 0) {
      upsertToIDB(table as IDBStoreName, data);
    }
  } else if (typeof data === 'object') {
    upsertToIDB(table as IDBStoreName, data);
  }
}

// --- Mock Offline Supabase Client ---
class MockBuilder {
  table: string;
  filters: Array<(item: any) => boolean> = [];
  orderByField: string | null = null;
  orderAscending: boolean = true;
  limitNum: number | null = null;
  isHead: boolean = false;
  pendingOp: (() => any) | null = null;

  constructor(table: string) {
    this.table = table;
  }

  getItems() {
    let items: any[] = [];
    if (idbMemoryCache[this.table] && Array.isArray(idbMemoryCache[this.table]) && idbMemoryCache[this.table].length > 0) {
      items = idbMemoryCache[this.table];
    } else {
      const key = `local_db_${this.table}`;
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            items = parsed;
            idbMemoryCache[this.table] = parsed;
            saveAllToIDB(this.table as IDBStoreName, parsed);
          }
        } catch {}
      }
    }

    if (!items || !Array.isArray(items)) items = [];

    // Safety filter for companies: if real user session exists, filter out local-company-1
    if (this.table === 'companies' && typeof localStorage !== 'undefined') {
      const userJson = localStorage.getItem('local_session_user');
      if (userJson) {
        try {
          const u = JSON.parse(userJson);
          if (u && u.id && u.id !== 'local-user-1') {
            return items.filter((c: any) => c && c.id !== 'local-company-1');
          }
        } catch {}
      }
    }

    return items;
  }

  saveItems(items: any[]) {
    idbMemoryCache[this.table] = items;
    saveAllToIDB(this.table as IDBStoreName, items);
    const key = `local_db_${this.table}`;
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {}
  }

  select(columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) {
      this.isHead = true;
    }
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push((item: any) => {
      if (value === null || value === undefined) {
        return item[column] === null || item[column] === undefined;
      }
      return String(item[column]) === String(value);
    });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push((item: any) => String(item[column]) !== String(value));
    return this;
  }

  not(column: string, operator: string, value: any) {
    if (operator === 'eq') {
      this.filters.push((item: any) => String(item[column]) !== String(value));
    }
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push((item: any) => {
      const val = item[column];
      if (val === null || val === undefined) return false;
      return String(val) >= String(value);
    });
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push((item: any) => {
      const val = item[column];
      if (val === null || val === undefined) return false;
      return String(val) <= String(value);
    });
    return this;
  }

  gt(column: string, value: any) {
    this.filters.push((item: any) => {
      const val = item[column];
      if (val === null || val === undefined) return false;
      return String(val) > String(value);
    });
    return this;
  }

  lt(column: string, value: any) {
    this.filters.push((item: any) => {
      const val = item[column];
      if (val === null || val === undefined) return false;
      return String(val) < String(value);
    });
    return this;
  }

  ilike(column: string, pattern: string) {
    const cleanPattern = pattern ? String(pattern).replace(/%/g, '').toLowerCase() : '';
    this.filters.push((item: any) => {
      const val = item[column];
      if (val === null || val === undefined) return false;
      const strVal = String(val).toLowerCase();
      return pattern && pattern.includes('%') ? strVal.includes(cleanPattern) : strVal === cleanPattern;
    });
    return this;
  }

  like(column: string, pattern: string) {
    const cleanPattern = pattern ? String(pattern).replace(/%/g, '') : '';
    this.filters.push((item: any) => {
      const val = item[column];
      if (val === null || val === undefined) return false;
      const strVal = String(val);
      return pattern && pattern.includes('%') ? strVal.includes(cleanPattern) : strVal === cleanPattern;
    });
    return this;
  }

  in(column: string, values: any[]) {
    const set = new Set((values || []).map((v) => String(v)));
    this.filters.push((item: any) => set.has(String(item[column])));
    return this;
  }

  is(column: string, value: any) {
    this.filters.push((item: any) => item[column] === value);
    return this;
  }

  or(filtersString: string) {
    if (!filtersString) return this;

    const clauses = filtersString.split(',').map((c) => c.trim()).filter(Boolean);
    const parsedConditions = clauses.map((clause) => {
      const parts = clause.split('.');
      if (parts.length >= 3) {
        const column = parts[0];
        const operator = parts[1];
        const value = parts.slice(2).join('.');
        return { column, operator, value };
      }
      return null;
    }).filter((x): x is { column: string; operator: string; value: string } => x !== null);

    if (parsedConditions.length > 0) {
      this.filters.push((item: any) => {
        if (!item) return false;
        return parsedConditions.some(({ column, operator, value }) => {
          const itemVal = item[column];
          if (operator === 'eq') {
            return String(itemVal) === String(value);
          }
          if (operator === 'neq') {
            return String(itemVal) !== String(value);
          }
          if (operator === 'is') {
            if (value === 'null') return itemVal === null || itemVal === undefined;
            if (value === 'true') return itemVal === true;
            if (value === 'false') return itemVal === false;
            return String(itemVal) === String(value);
          }
          if (operator === 'in') {
            const cleanVals = value.replace(/^\(|\)$/g, '').split(';');
            return cleanVals.map((v) => String(v).trim()).includes(String(itemVal));
          }
          return false;
        });
      });
    }

    return this;
  }

  match(query: Record<string, any>) {
    this.filters.push((item: any) => {
      for (const key of Object.keys(query)) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
    return this;
  }

  filter(column: string, operator: string, value: any) {
    if (operator === 'eq') return this.eq(column, value);
    if (operator === 'neq') return this.neq(column, value);
    if (operator === 'gt') return this.gt(column, value);
    if (operator === 'gte') return this.gte(column, value);
    if (operator === 'lt') return this.lt(column, value);
    if (operator === 'lte') return this.lte(column, value);
    if (operator === 'ilike') return this.ilike(column, value);
    if (operator === 'like') return this.like(column, value);
    if (operator === 'in') return this.in(column, value);
    if (operator === 'is') return this.is(column, value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderByField = column;
    this.orderAscending = options?.ascending !== false;
    return this;
  }

  limit(num: number) {
    this.limitNum = num;
    return this;
  }

  insert(rows: any | any[]) {
    this.pendingOp = () => {
      const items = this.getItems();
      const newRows = Array.isArray(rows) ? rows : [rows];
      const inserted: any[] = [];
      for (const row of newRows) {
        const newRow = {
          id: row.id || ('loc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)),
          created_at: new Date().toISOString(),
          ...row
        };
        items.push(newRow);
        inserted.push(newRow);
        enqueueOfflineOp({
          table: this.table,
          op: 'INSERT',
          recordId: newRow.id,
          payload: newRow
        }).catch(() => {});
      }
      this.saveItems(items);
      return { data: inserted, error: null };
    };
    return this;
  }

  update(payload: any) {
    this.pendingOp = () => {
      const items = this.getItems();
      let updatedCount = 0;
      const updatedItems: any[] = [];
      const modified = items.map((item: any) => {
        let match = true;
        for (const filter of this.filters) {
          if (!filter(item)) {
            match = false;
            break;
          }
        }
        if (match) {
          updatedCount++;
          const updated = { ...item, ...payload };
          updatedItems.push(updated);
          enqueueOfflineOp({
            table: this.table,
            op: 'UPSERT',
            recordId: updated.id,
            payload: updated
          }).catch(() => {});
          return updated;
        }
        return item;
      });
      this.saveItems(modified);
      return { data: updatedItems, error: null, count: updatedCount };
    };
    return this;
  }

  upsert(payload: any) {
    this.pendingOp = () => {
      const items = this.getItems();
      const payloads = Array.isArray(payload) ? payload : [payload];
      const upserted: any[] = [];
      for (const p of payloads) {
        const index = items.findIndex((item: any) => item.id === p.id);
        let itemToSave: any;
        if (index !== -1) {
          items[index] = { ...items[index], ...p };
          itemToSave = items[index];
          upserted.push(items[index]);
        } else {
          itemToSave = {
            id: p.id || ('loc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)),
            created_at: new Date().toISOString(),
            ...p
          };
          items.push(itemToSave);
          upserted.push(itemToSave);
        }
        enqueueOfflineOp({
          table: this.table,
          op: 'UPSERT',
          recordId: itemToSave.id,
          payload: itemToSave
        }).catch(() => {});
      }
      this.saveItems(items);
      return { data: upserted, error: null };
    };
    return this;
  }

  delete() {
    this.pendingOp = () => {
      const items = this.getItems();
      const remaining: any[] = [];
      for (const item of items) {
        let match = true;
        for (const filter of this.filters) {
          if (!filter(item)) {
            match = false;
            break;
          }
        }
        if (match) {
          enqueueOfflineOp({
            table: this.table,
            op: 'DELETE',
            recordId: item.id
          }).catch(() => {});
        } else {
          remaining.push(item);
        }
      }
      this.saveItems(remaining);
      return { data: null, error: null };
    };
    return this;
  }

  execute() {
    if (this.pendingOp) {
      const res = this.pendingOp();
      this.pendingOp = null;
      return res;
    }

    let items = this.getItems();
    for (const filter of this.filters) {
      items = items.filter(filter);
    }
    if (this.orderByField) {
      const col = this.orderByField;
      const asc = this.orderAscending;
      items.sort((a: any, b: any) => {
        const valA = a[col];
        const valB = b[col];
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
          return asc ? valA - valB : valB - valA;
        }
        return asc 
          ? String(valA).localeCompare(String(valB)) 
          : String(valB).localeCompare(String(valA));
      });
    }
    const count = items.length;
    if (this.isHead) {
      items = [];
    } else if (this.limitNum !== null) {
      items = items.slice(0, this.limitNum);
    }
    return { data: items, error: null, count };
  }

  async then(resolve: any, reject?: any) {
    try {
      const result = await this.execute();
      return resolve(result);
    } catch (err) {
      if (reject) return reject(err);
      throw err;
    }
  }

  async maybeSingle() {
    const { data } = await this.execute();
    const arr = Array.isArray(data) ? data : (data ? [data] : []);
    return { data: arr[0] || null, error: null };
  }

  async single() {
    const { data } = await this.execute();
    const arr = Array.isArray(data) ? data : (data ? [data] : []);
    if (arr.length === 0) {
      return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
    }
    return { data: arr[0], error: null };
  }
}

function seedLocalStorage() {
  if (typeof localStorage === 'undefined') return;

  const userJson = localStorage.getItem('local_session_user');
  if (userJson) {
    try {
      const u = JSON.parse(userJson);
      if (u && u.id && u.id !== 'local-user-1') {
        // Real user session exists! Do not inject demo company or demo user.
        return;
      }
    } catch {}
  }

  // Only seed demo data if offline mode is explicitly requested
  if (localStorage.getItem('use_offline_mode') === 'true') {
    if (!localStorage.getItem('local_db_users')) {
      localStorage.setItem('local_db_users', JSON.stringify([
        { id: 'local-user-1', email: 'offline@zenterprime.com', created_at: new Date().toISOString() }
      ]));
    }
    if (!localStorage.getItem('local_session_user')) {
      localStorage.setItem('local_session_user', JSON.stringify({
        id: 'local-user-1',
        email: 'offline@zenterprime.com',
        created_at: new Date().toISOString()
      }));
    }
    if (!localStorage.getItem('local_db_companies')) {
      localStorage.setItem('local_db_companies', JSON.stringify([
        {
          id: 'local-company-1',
          name: 'Local Demo Company',
          gstin: '22AAAAA0000A1Z1',
          address: '123 Main Street',
          is_deleted: false,
          created_at: new Date().toISOString(),
          created_by: 'local-user-1'
        }
      ]));
    }
    if (!localStorage.getItem('activeCompanyId')) {
      localStorage.setItem('activeCompanyId', 'local-company-1');
      localStorage.setItem('activeCompanyName', 'Local Demo Company');
    }
    if (!localStorage.getItem('local_db_profiles')) {
      localStorage.setItem('local_db_profiles', JSON.stringify([
        { id: 'local-user-1', active_company_id: 'local-company-1', full_name: 'Local User', created_at: new Date().toISOString() }
      ]));
    }
  }

  const tables = ['sales_invoices', 'purchase_bills', 'customers', 'vendors', 'stock_items', 'cashbook', 'duties_taxes'] as const;
  tables.forEach((t) => {
    if (!localStorage.getItem(`local_db_${t}`)) {
      localStorage.setItem(`local_db_${t}`, JSON.stringify([]));
    }
  });
}

const authListeners = new Set<(event: string, session: any) => void>();

function notifyAuthListeners(event: string, session: any) {
  authListeners.forEach((cb) => {
    try { cb(event, session); } catch (e) { console.error("Auth listener error:", e); }
  });
}

const mockAuth = {
  async getSession() {
    seedLocalStorage();
    const userJson = localStorage.getItem('local_session_user');
    if (!userJson) {
      return { data: { session: null }, error: null };
    }
    const user = JSON.parse(userJson);
    const session = {
      user,
      access_token: 'local-token',
      refresh_token: 'local-refresh-token'
    };
    return { data: { session }, error: null };
  },
  async getUser() {
    seedLocalStorage();
    const userJson = localStorage.getItem('local_session_user');
    if (!userJson) {
      return { data: { user: null }, error: null };
    }
    return { data: { user: JSON.parse(userJson) }, error: null };
  },
  async signInWithPassword({ email }: any) {
    seedLocalStorage();
    const user = { id: 'local-user-1', email: email || 'offline@zenterprime.com', created_at: new Date().toISOString() };
    const session = { user, access_token: 'local-token', refresh_token: 'local-refresh-token' };
    localStorage.setItem('local_session_user', JSON.stringify(user));
    localStorage.setItem('activeCompanyId', 'local-company-1');
    localStorage.setItem('activeCompanyName', 'Local Demo Company');
    notifyAuthListeners('SIGNED_IN', session);
    return { data: { user, session }, error: null };
  },
  async signUp({ email }: any) {
    seedLocalStorage();
    const user = { id: 'local-user-1', email: email || 'offline@zenterprime.com', created_at: new Date().toISOString() };
    const session = { user, access_token: 'local-token', refresh_token: 'local-refresh-token' };
    localStorage.setItem('local_session_user', JSON.stringify(user));
    localStorage.setItem('activeCompanyId', 'local-company-1');
    localStorage.setItem('activeCompanyName', 'Local Demo Company');
    notifyAuthListeners('SIGNED_IN', session);
    return { data: { user, session }, error: null };
  },
  async signOut() {
    await clearOfflineWorkspaceCache();
    notifyAuthListeners('SIGNED_OUT', null);
    return { error: null };
  },
  onAuthStateChange(callback: any) {
    seedLocalStorage();
    authListeners.add(callback);
    const userJson = localStorage.getItem('local_session_user');
    const user = userJson ? JSON.parse(userJson) : null;
    const session = user ? { user, access_token: 'local-token', refresh_token: 'local-refresh-token' } : null;
    
    setTimeout(() => {
      callback(user ? 'SIGNED_IN' : 'SIGNED_OUT', session);
    }, 0);

    return {
      data: {
        subscription: {
          unsubscribe() {
            authListeners.delete(callback);
          }
        }
      }
    };
  }
};

const mockSupabase = {
  auth: mockAuth,
  from(table: string) {
    return new MockBuilder(table);
  }
};

class ResilientQueryBuilder {
  realQb: any;
  mockQb: MockBuilder;
  table: string;

  constructor(table: string) {
    this.table = table;
    this.realQb = realSupabase.from(table);
    this.mockQb = new MockBuilder(table);
  }

  select(...args: any[]) {
    if (this.realQb?.select) this.realQb = this.realQb.select(...args);
    this.mockQb.select(...args);
    return this;
  }

  eq(...args: any[]) {
    if (this.realQb?.eq) this.realQb = (this.realQb.eq as any)(...args);
    (this.mockQb.eq as any)(...args);
    return this;
  }

  neq(...args: any[]) {
    if (this.realQb?.neq) this.realQb = (this.realQb.neq as any)(...args);
    (this.mockQb.neq as any)(...args);
    return this;
  }

  not(...args: any[]) {
    if (this.realQb?.not) this.realQb = (this.realQb.not as any)(...args);
    (this.mockQb.not as any)(...args);
    return this;
  }

  gte(...args: any[]) {
    if (this.realQb?.gte) this.realQb = (this.realQb.gte as any)(...args);
    (this.mockQb.gte as any)(...args);
    return this;
  }

  lte(...args: any[]) {
    if (this.realQb?.lte) this.realQb = (this.realQb.lte as any)(...args);
    (this.mockQb.lte as any)(...args);
    return this;
  }

  gt(...args: any[]) {
    if (this.realQb?.gt) this.realQb = (this.realQb.gt as any)(...args);
    (this.mockQb.gt as any)(...args);
    return this;
  }

  lt(...args: any[]) {
    if (this.realQb?.lt) this.realQb = (this.realQb.lt as any)(...args);
    (this.mockQb.lt as any)(...args);
    return this;
  }

  ilike(...args: any[]) {
    if (this.realQb?.ilike) this.realQb = (this.realQb.ilike as any)(...args);
    (this.mockQb.ilike as any)(...args);
    return this;
  }

  like(...args: any[]) {
    if (this.realQb?.like) this.realQb = (this.realQb.like as any)(...args);
    (this.mockQb.like as any)(...args);
    return this;
  }

  in(...args: any[]) {
    if (this.realQb?.in) this.realQb = (this.realQb.in as any)(...args);
    (this.mockQb.in as any)(...args);
    return this;
  }

  is(...args: any[]) {
    if (this.realQb?.is) this.realQb = (this.realQb.is as any)(...args);
    (this.mockQb.is as any)(...args);
    return this;
  }

  or(...args: any[]) {
    if (this.realQb?.or) this.realQb = (this.realQb.or as any)(...args);
    (this.mockQb.or as any)(...args);
    return this;
  }

  match(...args: any[]) {
    if (this.realQb?.match) this.realQb = (this.realQb.match as any)(...args);
    (this.mockQb.match as any)(...args);
    return this;
  }

  filter(...args: any[]) {
    if (this.realQb?.filter) this.realQb = (this.realQb.filter as any)(...args);
    (this.mockQb.filter as any)(...args);
    return this;
  }

  order(...args: any[]) {
    if (this.realQb?.order) this.realQb = (this.realQb.order as any)(...args);
    (this.mockQb.order as any)(...args);
    return this;
  }

  limit(...args: any[]) {
    if (this.realQb?.limit) this.realQb = (this.realQb.limit as any)(...args);
    (this.mockQb.limit as any)(...args);
    return this;
  }

  insert(...args: any[]) {
    if (this.realQb?.insert) this.realQb = (this.realQb.insert as any)(...args);
    (this.mockQb.insert as any)(...args);
    return this;
  }

  update(...args: any[]) {
    if (this.realQb?.update) this.realQb = (this.realQb.update as any)(...args);
    (this.mockQb.update as any)(...args);
    return this;
  }

  upsert(...args: any[]) {
    if (this.realQb?.upsert) this.realQb = (this.realQb.upsert as any)(...args);
    (this.mockQb.upsert as any)(...args);
    return this;
  }

  delete(...args: any[]) {
    if (this.realQb?.delete) this.realQb = (this.realQb.delete as any)(...args);
    (this.mockQb.delete as any)(...args);
    return this;
  }

  async execute() {
    const isOffline = (typeof navigator !== 'undefined' && !navigator.onLine) ||
                      (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true');
    if (isOffline) {
      return this.mockQb.execute();
    }
    try {
      const res = await this.realQb;
      if (res?.error && isNetworkError(res.error)) {
        console.warn(`[Supabase Network Warning] Query on '${this.table}' failed, using local offline storage.`, res.error);
        enableOfflineMode();
        return this.mockQb.execute();
      }
      if (res && !res.error) {
        autoCacheOnlineResult(this.table, res);
      }
      return res;
    } catch (err: any) {
      console.warn(`[Supabase Network Warning] Query on '${this.table}' threw exception, using local offline storage.`, err.message || err);
      enableOfflineMode();
      return this.mockQb.execute();
    }
  }

  async then(resolve: any, reject?: any) {
    try {
      const res = await this.execute();
      return resolve(res);
    } catch (err) {
      enableOfflineMode();
      return resolve(this.mockQb.execute());
    }
  }

  async single() {
    const isOffline = (typeof navigator !== 'undefined' && !navigator.onLine) ||
                      (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true');
    if (isOffline) {
      return await this.mockQb.single();
    }
    try {
      const res = await (this.realQb?.single ? this.realQb.single() : this.realQb);
      if (res?.error && isNetworkError(res.error)) {
        enableOfflineMode();
        return await this.mockQb.single();
      }
      if (res && !res.error) {
        autoCacheOnlineResult(this.table, res);
      }
      return res;
    } catch (err: any) {
      enableOfflineMode();
      return await this.mockQb.single();
    }
  }

  async maybeSingle() {
    const isOffline = (typeof navigator !== 'undefined' && !navigator.onLine) ||
                      (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true');
    if (isOffline) {
      return await this.mockQb.maybeSingle();
    }
    try {
      const res = await (this.realQb?.maybeSingle ? this.realQb.maybeSingle() : this.realQb);
      if (res?.error && isNetworkError(res.error)) {
        enableOfflineMode();
        return await this.mockQb.maybeSingle();
      }
      if (res && !res.error) {
        autoCacheOnlineResult(this.table, res);
      }
      return res;
    } catch (err: any) {
      enableOfflineMode();
      return await this.mockQb.maybeSingle();
    }
  }
}

const resilientAuth = {
  async getSession() {
    const isOffline = (typeof navigator !== 'undefined' && !navigator.onLine) || 
                      (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true');
    if (isOffline) {
      return await mockAuth.getSession();
    }
    try {
      const res = await realSupabase.auth.getSession();
      if (res?.error && (isNetworkError(res.error) || (typeof navigator !== 'undefined' && !navigator.onLine))) {
        return await mockAuth.getSession();
      }
      if (!res?.data?.session && typeof window !== 'undefined' && localStorage.getItem('local_session_user')) {
        return await mockAuth.getSession();
      }
      if (res?.data?.session?.user) {
        if (res.data.session.user.id !== 'local-user-1') {
          localStorage.removeItem('use_offline_mode');
          if (localStorage.getItem('activeCompanyId') === 'local-company-1') {
            localStorage.removeItem('activeCompanyId');
            localStorage.removeItem('activeCompanyName');
          }
        }
        localStorage.setItem('local_session_user', JSON.stringify(res.data.session.user));
        syncUserWorkspaceDataToIndexedDB(res.data.session.user.id).catch(() => {});
      }
      return res;
    } catch (err: any) {
      if (isNetworkError(err) || (typeof navigator !== 'undefined' && !navigator.onLine) || (typeof window !== 'undefined' && localStorage.getItem('local_session_user'))) {
        return await mockAuth.getSession();
      }
      return { data: { session: null }, error: err };
    }
  },
  async getUser() {
    const isOffline = (typeof navigator !== 'undefined' && !navigator.onLine) || 
                      (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true');
    if (isOffline) {
      return await mockAuth.getUser();
    }
    try {
      const res = await realSupabase.auth.getUser();
      if (res?.error && (isNetworkError(res.error) || (typeof navigator !== 'undefined' && !navigator.onLine))) {
        return await mockAuth.getUser();
      }
      if (!res?.data?.user && typeof window !== 'undefined' && localStorage.getItem('local_session_user')) {
        return await mockAuth.getUser();
      }
      if (res?.data?.user) {
        if (res.data.user.id !== 'local-user-1') {
          localStorage.removeItem('use_offline_mode');
          if (localStorage.getItem('activeCompanyId') === 'local-company-1') {
            localStorage.removeItem('activeCompanyId');
            localStorage.removeItem('activeCompanyName');
          }
        }
        localStorage.setItem('local_session_user', JSON.stringify(res.data.user));
        syncUserWorkspaceDataToIndexedDB(res.data.user.id).catch(() => {});
      }
      return res;
    } catch (err: any) {
      if (isNetworkError(err) || (typeof navigator !== 'undefined' && !navigator.onLine) || (typeof window !== 'undefined' && localStorage.getItem('local_session_user'))) {
        return await mockAuth.getUser();
      }
      return { data: { user: null }, error: err };
    }
  },
  async signInWithPassword(params: any) {
    if (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true' && typeof navigator !== 'undefined' && !navigator.onLine) {
      return await mockAuth.signInWithPassword(params);
    }
    try {
      const res = await realSupabase.auth.signInWithPassword(params);
      if (res?.error) {
        if (isNetworkError(res.error) && typeof navigator !== 'undefined' && !navigator.onLine) {
          return await mockAuth.signInWithPassword(params);
        }
        return res;
      }
      if (res?.data?.user) {
        localStorage.removeItem('use_offline_mode');
        if (localStorage.getItem('activeCompanyId') === 'local-company-1') {
          localStorage.removeItem('activeCompanyId');
          localStorage.removeItem('activeCompanyName');
        }
        localStorage.setItem('local_session_user', JSON.stringify(res.data.user));
        syncUserWorkspaceDataToIndexedDB(res.data.user.id).catch(() => {});
        notifyAuthListeners('SIGNED_IN', res.data.session);
      }
      return res;
    } catch (err: any) {
      if (isNetworkError(err) && typeof navigator !== 'undefined' && !navigator.onLine) {
        return await mockAuth.signInWithPassword(params);
      }
      return { data: null, error: err };
    }
  },
  async signUp(params: any) {
    if (typeof window !== 'undefined' && localStorage.getItem('use_offline_mode') === 'true' && typeof navigator !== 'undefined' && !navigator.onLine) {
      return await mockAuth.signUp(params);
    }
    try {
      const res = await realSupabase.auth.signUp(params);
      if (res?.error && isNetworkError(res.error) && typeof navigator !== 'undefined' && !navigator.onLine) {
        return await mockAuth.signUp(params);
      }
      if (res?.data?.user) {
        localStorage.removeItem('use_offline_mode');
        if (localStorage.getItem('activeCompanyId') === 'local-company-1') {
          localStorage.removeItem('activeCompanyId');
          localStorage.removeItem('activeCompanyName');
        }
        localStorage.setItem('local_session_user', JSON.stringify(res.data.user));
        syncUserWorkspaceDataToIndexedDB(res.data.user.id).catch(() => {});
        notifyAuthListeners('SIGNED_IN', res.data.session);
      }
      return res;
    } catch (err: any) {
      if (isNetworkError(err) && typeof navigator !== 'undefined' && !navigator.onLine) {
        return await mockAuth.signUp(params);
      }
      return { data: null, error: err };
    }
  },
  async signOut(opts?: any) {
    try {
      await realSupabase.auth.signOut(opts);
    } catch {
      // ignore
    }
    return await mockAuth.signOut();
  },
  onAuthStateChange(callback: any) {
    const mockSub = mockAuth.onAuthStateChange(callback);
    try {
      const realSub = realSupabase.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          localStorage.setItem('local_session_user', JSON.stringify(session.user));
          syncUserWorkspaceDataToIndexedDB(session.user.id).catch(() => {});
        }
        callback(event, session);
      });
      if (realSub?.data?.subscription) {
        return {
          data: {
            subscription: {
              unsubscribe() {
                try { realSub.data.subscription.unsubscribe(); } catch {}
                try { mockSub.data.subscription.unsubscribe(); } catch {}
              }
            }
          }
        };
      }
    } catch {
      // ignore
    }
    return mockSub;
  }
};

export const supabase = {
  auth: resilientAuth,
  from(table: string) {
    return new ResilientQueryBuilder(table);
  }
} as any;

export async function getAuthUser() {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (error.message?.includes('Lock broken by another request')) {
        const { data: sessionData } = await supabase.auth.getSession();
        return sessionData?.session?.user || null;
      }
      return null;
    }
    return data?.user || null;
  } catch (err: any) {
    const errMsg = err?.message || (typeof err === 'string' ? err : '');
    if (errMsg.includes('Lock broken by another request') || errMsg.includes('steal')) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        return sessionData?.session?.user || null;
      } catch {
        return null;
      }
    }
    return null;
  }
}
