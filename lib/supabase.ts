import { 
  initIndexedDB, 
  idbMemoryCache, 
  saveAllToIDB, 
  upsertToIDB, 
  deleteFromIDB, 
  IDBStoreName,
  getAllFromIDB
} from './idb';
import { 
  DEFAULT_LICENSE, 
  DEFAULT_LICENSE_KEY, 
  getActiveLicense, 
  normalizeLicenseKey,
  initializeLicensesStore
} from './licenseManager';
import { checkAndTriggerAutoBackup } from './backupEngine';

// Auto-initialize IndexedDB on module load
if (typeof window !== 'undefined') {
  initIndexedDB()
    .then(() => initializeLicensesStore())
    .catch((err) => console.warn('[IndexedDB] Init warning:', err));
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// In-memory Auth listener registry
const authListeners = new Set<(event: string, session: any) => void>();

function notifyAuthListeners(event: string, session: any) {
  authListeners.forEach((cb) => {
    try {
      cb(event, session);
    } catch (e) {
      console.error('Auth listener callback error:', e);
    }
  });
}

// Ensure default offline state and profile exist in storage
function ensureLocalOfflineState() {
  if (typeof localStorage === 'undefined') return;

  const activeLic = getActiveLicense();
  const licKey = activeLic?.license_key || DEFAULT_LICENSE_KEY;
  const cleanLic = normalizeLicenseKey(licKey);
  const userId = `user-${cleanLic.toLowerCase()}`;

  // If no user session is saved, do NOT force sign-in until license is verified/active
  // but if an active license is present in localStorage, ensure user session
  if (localStorage.getItem('active_license_key')) {
    if (!localStorage.getItem('local_session_user')) {
      const userObj = {
        id: userId,
        email: `${cleanLic.toLowerCase()}@offline.bipinpetroleum.com`,
        license_key: licKey,
        created_at: new Date().toISOString(),
      };
      localStorage.setItem('local_session_user', JSON.stringify(userObj));
    }
  }

  // Pre-seed table caches if not already present
  const tables = [
    'licenses',
    'login_verifications',
    'companies',
    'sales_invoices',
    'purchase_bills',
    'customers',
    'vendors',
    'stock_items',
    'cashbook',
    'cashbooks',
    'duties_taxes',
    'delivery_challans',
    'payment_vouchers',
    'profiles',
    'users'
  ] as const;

  tables.forEach((t) => {
    if (!idbMemoryCache[t]) {
      const raw = localStorage.getItem(`local_db_${t}`);
      if (raw) {
        try {
          idbMemoryCache[t] = JSON.parse(raw);
        } catch {
          idbMemoryCache[t] = [];
        }
      } else {
        idbMemoryCache[t] = [];
      }
    }
  });
}

function normalizeTableName(table: string): string {
  const clean = table.replace(/^public\./, '').toLowerCase().trim();
  if (clean === 'bp_companies' || clean === 'workspaces') return 'companies';
  if (clean === 'bp_profiles') return 'profiles';
  if (clean === 'bp_licenses') return 'licenses';
  if (clean === 'bp_users') return 'users';
  if (clean === 'bp_sales_invoices' || clean === 'sales') return 'sales_invoices';
  if (clean === 'bp_purchase_bills' || clean === 'bp_purchsae_bills' || clean === 'bills') return 'purchase_bills';
  if (clean === 'bp_customers') return 'customers';
  if (clean === 'bp_vendors') return 'vendors';
  if (clean === 'bp_stock_items' || clean === 'stock') return 'stock_items';
  if (clean === 'bp_cashbooks' || clean === 'cashbook') return 'cashbooks';
  if (clean === 'bp_additional_charges' || clean === 'duties_taxes') return 'additional_charges';
  if (clean === 'bp_payments_in' || clean === 'payments_in' || clean === 'receive_payments') return 'payments_in';
  if (clean === 'bp_payments_out' || clean === 'payments_out' || clean === 'make_payments') return 'payments_out';
  if (clean === 'queue' || clean === 'sync_queue') return 'queue';
  return clean;
}

// Pure Offline Mock Query Builder operating directly on IndexedDB and RAM cache
class OfflineQueryBuilder {
  rawTable: string;
  table: string;
  filters: Array<(item: any) => boolean> = [];
  orderByField: string | null = null;
  orderAscending: boolean = true;
  limitNum: number | null = null;
  isHead: boolean = false;
  pendingOp: (() => any) | null = null;

  constructor(table: string) {
    this.rawTable = table;
    this.table = normalizeTableName(table);
  }

  getItems(): any[] {
    let items: any[] = [];
    if (idbMemoryCache[this.table] && Array.isArray(idbMemoryCache[this.table])) {
      items = idbMemoryCache[this.table];
    } else {
      const key = `local_db_${this.table}`;
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            items = parsed;
            idbMemoryCache[this.table] = parsed;
          }
        } catch {}
      }
    }

    if (!items || !Array.isArray(items)) items = [];
    return items;
  }

  saveItems(items: any[]) {
    idbMemoryCache[this.table] = items;
    saveAllToIDB(this.table as IDBStoreName, items);
    const key = `local_db_${this.table}`;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(items));
      }
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
          if (operator === 'eq') return String(itemVal) === String(value);
          if (operator === 'neq') return String(itemVal) !== String(value);
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
      const activeLic = getActiveLicense();
      const currentLicKey = activeLic?.license_key || DEFAULT_LICENSE_KEY;

      const inserted: any[] = [];
      for (const row of newRows) {
        const rowId = (row.id && row.id !== 'undefined' && row.id !== 'null') ? row.id : generateUUID();
        const newRow = {
          created_at: new Date().toISOString(),
          license_key: row.license_key || currentLicKey,
          ...row,
          id: rowId,
        };
        items.push(newRow);
        inserted.push(newRow);

        // Explicitly persist record directly to IndexedDB
        upsertToIDB(this.table as IDBStoreName, newRow).catch((err) => {
          console.warn(`[IDB] Direct record persist warning for ${this.table}:`, err);
        });
      }
      this.saveItems(items);

      // Trigger automatic backup check on every transaction
      setTimeout(() => {
        checkAndTriggerAutoBackup('transaction').catch(() => {});
      }, 100);

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

          // Explicitly persist updated record directly to IndexedDB
          upsertToIDB(this.table as IDBStoreName, updated).catch((err) => {
            console.warn(`[IDB] Direct record update persist warning for ${this.table}:`, err);
          });

          return updated;
        }
        return item;
      });
      this.saveItems(modified);

      // Trigger automatic backup check on every transaction
      if (updatedCount > 0) {
        setTimeout(() => {
          checkAndTriggerAutoBackup('transaction').catch(() => {});
        }, 100);
      }

      return { data: updatedItems, error: null, count: updatedCount };
    };
    return this;
  }

  upsert(payload: any) {
    this.pendingOp = () => {
      const items = this.getItems();
      const payloads = Array.isArray(payload) ? payload : [payload];
      const activeLic = getActiveLicense();
      const currentLicKey = activeLic?.license_key || DEFAULT_LICENSE_KEY;
      const upserted: any[] = [];

      for (const p of payloads) {
        const index = items.findIndex((item: any) => item.id === p.id);
        let itemToSave: any;
        if (index !== -1) {
          items[index] = { ...items[index], ...p };
          itemToSave = items[index];
          upserted.push(items[index]);
        } else {
          const itemId = (p.id && p.id !== 'undefined' && p.id !== 'null') ? p.id : generateUUID();
          itemToSave = {
            created_at: new Date().toISOString(),
            license_key: p.license_key || currentLicKey,
            ...p,
            id: itemId,
          };
          items.push(itemToSave);
          upserted.push(itemToSave);
        }

        // Explicitly persist upserted record directly to IndexedDB
        upsertToIDB(this.table as IDBStoreName, itemToSave).catch((err) => {
          console.warn(`[IDB] Direct record upsert persist warning for ${this.table}:`, err);
        });
      }
      this.saveItems(items);

      // Trigger automatic backup check on every transaction
      setTimeout(() => {
        checkAndTriggerAutoBackup('transaction').catch(() => {});
      }, 100);

      return { data: upserted, error: null };
    };
    return this;
  }

  delete() {
    this.pendingOp = () => {
      const items = this.getItems();
      const remaining: any[] = [];
      let deletedCount = 0;
      for (const item of items) {
        let match = true;
        for (const filter of this.filters) {
          if (!filter(item)) {
            match = false;
            break;
          }
        }
        if (!match) {
          remaining.push(item);
        } else {
          deletedCount++;
          // Explicitly delete record from IndexedDB store
          deleteFromIDB(this.table as IDBStoreName, item.id).catch((err) => {
            console.warn(`[IDB] Direct record delete warning for ${this.table}:`, err);
          });
        }
      }
      this.saveItems(remaining);

      // Trigger automatic backup check on every transaction
      if (deletedCount > 0) {
        setTimeout(() => {
          checkAndTriggerAutoBackup('transaction').catch(() => {});
        }, 100);
      }

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

// Completely offline auth service
const offlineAuth = {
  async getSession() {
    ensureLocalOfflineState();
    const userJson = typeof localStorage !== 'undefined' ? localStorage.getItem('local_session_user') : null;
    if (!userJson) {
      return { data: { session: null }, error: null };
    }
    try {
      const user = JSON.parse(userJson);
      const session = {
        user,
        access_token: 'offline-license-token',
        refresh_token: 'offline-license-refresh-token',
      };
      return { data: { session }, error: null };
    } catch {
      return { data: { session: null }, error: null };
    }
  },

  async getUser() {
    ensureLocalOfflineState();
    const userJson = typeof localStorage !== 'undefined' ? localStorage.getItem('local_session_user') : null;
    if (!userJson) {
      return { data: { user: null }, error: null };
    }
    try {
      const user = JSON.parse(userJson);
      return { data: { user }, error: null };
    } catch {
      return { data: { user: null }, error: null };
    }
  },

  async signInWithPassword({ email, userId }: any) {
    ensureLocalOfflineState();
    const activeLic = getActiveLicense();
    const licKey = activeLic?.license_key || DEFAULT_LICENSE_KEY;
    
    // Determine the exact account user_id
    let resolvedUserId = userId || activeLic?.user_id;
    if (!resolvedUserId && typeof localStorage !== 'undefined') {
      const existingUserJson = localStorage.getItem('local_session_user');
      if (existingUserJson) {
        try {
          const parsed = JSON.parse(existingUserJson);
          if (parsed.id) resolvedUserId = parsed.id;
        } catch {
          // ignore
        }
      }
    }
    if (!resolvedUserId) {
      resolvedUserId = `user-${normalizeLicenseKey(licKey).toLowerCase()}`;
    }

    const user = {
      id: resolvedUserId,
      email: email || `${normalizeLicenseKey(licKey).toLowerCase()}@offline.bipinpetroleum.com`,
      license_key: licKey,
      created_at: new Date().toISOString(),
    };
    const session = {
      user,
      access_token: 'offline-license-token',
      refresh_token: 'offline-license-refresh-token',
    };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('local_session_user', JSON.stringify(user));
    }
    notifyAuthListeners('SIGNED_IN', session);
    return { data: { user, session }, error: null };
  },

  async signUp(params: any) {
    return this.signInWithPassword(params);
  },

  async signOut() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('local_session_user');
      localStorage.removeItem('active_license_key');
      localStorage.removeItem('active_license_record');
      localStorage.removeItem('activeCompanyId');
      localStorage.removeItem('activeCompanyName');
    }
    notifyAuthListeners('SIGNED_OUT', null);
    return { error: null };
  },

  onAuthStateChange(callback: (event: string, session: any) => void) {
    ensureLocalOfflineState();
    authListeners.add(callback);
    
    // Immediate callback with current state
    const userJson = typeof localStorage !== 'undefined' ? localStorage.getItem('local_session_user') : null;
    let session: any = null;
    if (userJson) {
      try {
        const user = JSON.parse(userJson);
        session = { user, access_token: 'offline-license-token', refresh_token: 'offline-license-refresh-token' };
      } catch {}
    }

    setTimeout(() => {
      callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
    }, 0);

    return {
      data: {
        subscription: {
          unsubscribe() {
            authListeners.delete(callback);
          },
        },
      },
    };
  },
};

// Helper to retrieve env variables safely in both Vite and Electron environments
export const getEnvOrStored = (key: string): string => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env[key]) {
    return String((import.meta as any).env[key]).trim();
  }
  if (typeof localStorage !== 'undefined') {
    const val = localStorage.getItem(key);
    if (val) return String(val).trim();
  }
  return '';
};

// Export offline Supabase compatibility object
export const supabase = {
  auth: offlineAuth,
  from(table: string) {
    return new OfflineQueryBuilder(table);
  },
} as any;

export const realSupabase = supabase;

export async function getAuthUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

