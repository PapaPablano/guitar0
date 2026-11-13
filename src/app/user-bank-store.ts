import type { StoredUserBank, UserBankStorage } from '../audio/user-bank';

/** The version of the stored record; one this code does not know reads as nothing stored. */
export const USER_BANK_VERSION = 1;

interface UserBankRecord extends StoredUserBank {
  readonly version: number;
}

/** Where the one record is kept. The browser keeps it in IndexedDB; tests keep it in memory. */
export interface UserBankBackend {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
  remove(): Promise<void>;
}

const isLevelTable = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && Object.values(v).every((level) => typeof level === 'number');

const isReport = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return Array.isArray(r.covered) && Array.isArray(r.rejected) && Array.isArray(r.mutedCandidates) && Array.isArray(r.disabled);
};

/**
 * The player's own sound bank, kept on their device between sessions (R8, KTD10). Every read failure reads as "nothing
 * stored"; a save that fails rejects, so the caller can say the bank won't be remembered.
 */
export class UserBankStore implements UserBankStorage {
  constructor(private readonly backend: UserBankBackend) {}

  async load(): Promise<StoredUserBank | null> {
    let raw: unknown;
    try {
      raw = await this.backend.read();
    } catch {
      return null;
    }
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Partial<UserBankRecord>;
    if (record.version !== USER_BANK_VERSION) return null;
    if (typeof record.fileName !== 'string' || !(record.bytes instanceof Uint8Array)) return null;
    if (!isReport(record.report) || !isLevelTable(record.levels)) return null;
    return { fileName: record.fileName, bytes: record.bytes, report: record.report!, levels: record.levels! };
  }

  /** Replaces the stored bank. Rejects when it cannot be saved (no IndexedDB, blocked, or out of space). */
  async save(bank: StoredUserBank): Promise<void> {
    const record: UserBankRecord = { version: USER_BANK_VERSION, ...bank };
    await this.backend.write(record);
  }

  async clear(): Promise<void> {
    await this.backend.remove();
  }
}

const DB_NAME = 'tab-highway-user-bank';
const STORE_NAME = 'current';
const KEY = 'bank';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The sound bank store could not be opened.'));
    request.onblocked = () => reject(new Error('The sound bank store is blocked.'));
  });
}

function run<T>(factory: IDBFactory, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open(factory).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = work(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('The sound bank store failed.'));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('The sound bank store was stopped.'));
        };
      }),
  );
}

/** The browser's IndexedDB as the backend, or one that holds nothing and refuses to save when the browser has none or blocks it. */
export function indexedDbBackend(factory?: IDBFactory | null): UserBankBackend {
  let idb: IDBFactory | null = null;
  try {
    idb = factory === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : factory;
  } catch {
    idb = null;
  }
  if (!idb) {
    return {
      read: async () => null,
      write: async () => {
        throw new Error('Browser storage is unavailable.');
      },
      remove: async () => undefined,
    };
  }
  const db = idb;
  return {
    read: () => run(db, 'readonly', (s) => s.get(KEY)),
    write: async (value) => {
      await run(db, 'readwrite', (s) => s.put(value, KEY));
    },
    remove: async () => {
      await run(db, 'readwrite', (s) => s.delete(KEY));
    },
  };
}

let shared: UserBankStore | null = null;

/** The one store the page uses. */
export function defaultUserBankStore(): UserBankStore {
  shared ??= new UserBankStore(indexedDbBackend());
  return shared;
}
