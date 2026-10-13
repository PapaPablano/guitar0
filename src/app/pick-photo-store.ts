import { isNeckProfile, PICK_PROFILE, type NeckProfile } from '../render/neck-profile';

/** The version of the stored record; one this code does not know reads as nothing stored. */
export const PICK_PHOTO_VERSION = 1;

/** One saved photo with the profile that goes with it, so the two never disagree. */
interface PickPhotoRecord {
  readonly version: number;
  readonly photo: Blob;
  readonly profile: NeckProfile;
}

/** Where the one record is kept. The browser keeps it in IndexedDB; tests keep it in memory. */
export interface PickPhotoBackend {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
  remove(): Promise<void>;
}

/** The pick view's current photo and its profile, kept between sessions (R17). Every failure reads as "nothing stored" (R20). */
export class PickPhotoStore {
  constructor(private readonly backend: PickPhotoBackend) {}

  /** The saved photo and profile, or null when there is none, it cannot be read, or it is not one this code can draw. */
  async load(): Promise<{ photo: Blob; profile: NeckProfile } | null> {
    let raw: unknown;
    try {
      raw = await this.backend.read();
    } catch {
      return null;
    }
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Partial<PickPhotoRecord>;
    if (record.version !== PICK_PHOTO_VERSION) return null;
    if (!(record.photo instanceof Blob) || !isNeckProfile(record.profile)) return null;
    return { photo: record.photo, profile: record.profile };
  }

  /** Replaces the saved photo. Rejects when it cannot be saved, leaving the previous record as it was. */
  async save(photo: Blob, profile: NeckProfile): Promise<void> {
    const record: PickPhotoRecord = { version: PICK_PHOTO_VERSION, photo, profile };
    await this.backend.write(record);
  }

  /** Goes back to the bundled photo. */
  async clear(): Promise<void> {
    await this.backend.remove();
  }
}

/** What the pick view draws now: the saved photo and profile, or `PICK_PROFILE` with no photo (the bundled one is loaded from its asset). */
export async function resolvePickPhoto(
  store: PickPhotoStore,
): Promise<{ source: 'stored'; photo: Blob; profile: NeckProfile } | { source: 'bundled'; photo: null; profile: NeckProfile }> {
  const saved = await store.load();
  return saved ? { source: 'stored', ...saved } : { source: 'bundled', photo: null, profile: PICK_PROFILE };
}

const DB_NAME = 'tab-highway-pick-photo';
const STORE_NAME = 'current';
const KEY = 'photo';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The photo store could not be opened.'));
    request.onblocked = () => reject(new Error('The photo store is blocked.'));
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
          reject(tx.error ?? new Error('The photo store failed.'));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('The photo store was stopped.'));
        };
      }),
  );
}

/** The browser's IndexedDB as the backend, or one that holds nothing and refuses to save when the browser has none or blocks it. */
export function indexedDbBackend(factory?: IDBFactory | null): PickPhotoBackend {
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

let shared: PickPhotoStore | null = null;

/** The one store the page and the export share. */
export function defaultPickPhotoStore(): PickPhotoStore {
  shared ??= new PickPhotoStore(indexedDbBackend());
  return shared;
}
