import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GainEntry, Snapshot } from '../core/snapshots';
import type { PhotoRecord } from '../core/imageAnalysis';

interface PhoneCleanDB extends DBSchema {
  snapshots: { key: string; value: Snapshot };
  gains: { key: string; value: GainEntry };
  photos: { key: string; value: PhotoRecord };
  thumbs: { key: string; value: Blob };
  kv: { key: string; value: unknown };
}

/** Tout reste sur le téléphone : captures lues, historique, miniatures et analyse des photos, cache Drive. */
export class LocalDB {
  private constructor(private readonly db: IDBPDatabase<PhoneCleanDB>) {}

  static async open(): Promise<LocalDB> {
    const db = await openDB<PhoneCleanDB>('phoneclean', 1, {
      upgrade(db) {
        db.createObjectStore('snapshots', { keyPath: 'id' });
        db.createObjectStore('gains', { keyPath: 'id' });
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('thumbs');
        db.createObjectStore('kv');
      },
    });
    return new LocalDB(db);
  }

  getSnapshots() {
    return this.db.getAll('snapshots');
  }
  putSnapshot(s: Snapshot) {
    return this.db.put('snapshots', s);
  }
  deleteSnapshot(id: string) {
    return this.db.delete('snapshots', id);
  }

  getGains() {
    return this.db.getAll('gains');
  }
  putGain(g: GainEntry) {
    return this.db.put('gains', g);
  }

  getPhotos() {
    return this.db.getAll('photos');
  }
  putPhoto(p: PhotoRecord) {
    return this.db.put('photos', p);
  }
  async putPhotoWithThumb(p: PhotoRecord, thumb?: Blob) {
    const tx = this.db.transaction(['photos', 'thumbs'], 'readwrite');
    await Promise.all([tx.objectStore('photos').put(p), thumb ? tx.objectStore('thumbs').put(thumb, p.id) : undefined, tx.done]);
  }
  async getThumbs(): Promise<Map<string, Blob>> {
    const tx = this.db.transaction('thumbs');
    const keys = await tx.store.getAllKeys();
    const out = new Map<string, Blob>();
    for (const k of keys) {
      const v = await tx.store.get(k);
      if (v) out.set(String(k), v);
    }
    return out;
  }
  async clearPhotos() {
    const tx = this.db.transaction(['photos', 'thumbs'], 'readwrite');
    await Promise.all([tx.objectStore('photos').clear(), tx.objectStore('thumbs').clear(), tx.done]);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('kv', key)) as T | undefined;
  }
  set(key: string, value: unknown) {
    return this.db.put('kv', value, key);
  }
  del(key: string) {
    return this.db.delete('kv', key);
  }
}
