import type { PhotoRecord } from '../core/imageAnalysis';
import { formatBytes } from '../core/bytes';
import { analyzeFiles } from '../photos/analyzer';
import { addGain, getDB, toast } from './app';
import { createStore } from './createStore';

export interface PhotosState {
  loaded: boolean;
  records: PhotoRecord[];
  /** Adresses des miniatures (URL locales). */
  thumbs: Record<string, string>;
  busy: { done: number; total: number } | null;
}

export const photosStore = createStore<PhotosState>({ loaded: false, records: [], thumbs: {}, busy: null });

let controller: AbortController | null = null;

export async function loadPhotos() {
  const db = await getDB();
  const [records, blobs] = await Promise.all([db.getPhotos(), db.getThumbs()]);
  const thumbs: Record<string, string> = {};
  for (const [id, blob] of blobs) thumbs[id] = URL.createObjectURL(blob);
  photosStore.set({ loaded: true, records, thumbs });
}

export async function addPhotoFiles(files: File[]) {
  if (!files.length || photosStore.get().busy) return;
  const db = await getDB();
  controller = new AbortController();
  const existing = new Set(photosStore.get().records.map((r) => r.id));
  let pending: PhotoRecord[] = [];
  const pendingThumbs: Record<string, string> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const thumbs = { ...pendingThumbs };
    for (const k of Object.keys(pendingThumbs)) delete pendingThumbs[k];
    photosStore.set((s) => ({ records: [...s.records, ...batch], thumbs: { ...s.thumbs, ...thumbs } }));
  };

  photosStore.set({ busy: { done: 0, total: files.length } });
  try {
    const { analyzed, skipped } = await analyzeFiles(files, {
      existing,
      signal: controller.signal,
      onProgress: (done, total) => photosStore.set({ busy: { done, total } }),
      onResult: async ({ record, thumb }) => {
        await db.putPhotoWithThumb(record, thumb);
        pending.push(record);
        if (thumb) pendingThumbs[record.id] = URL.createObjectURL(thumb);
        timer ??= setTimeout(flush, 400);
      },
    });
    if (timer) clearTimeout(timer);
    flush();
    toast(
      analyzed
        ? `${analyzed.toLocaleString('fr-FR')} fichiers analysés` + (skipped ? ` (${skipped} déjà connus)` : '')
        : 'Ces fichiers étaient déjà analysés',
      'ok',
    );
  } finally {
    controller = null;
    photosStore.set({ busy: null });
  }
}

export function cancelPhotos() {
  controller?.abort();
}

/** « J'ai supprimé ces éléments dans Photos » : on les retire de la liste et on compte l'espace gagné. */
export async function markRemoved(ids: string[], label: string) {
  const set = new Set(ids);
  const db = await getDB();
  const changed = photosStore.get().records.filter((r) => set.has(r.id) && !r.removed).map((r) => ({ ...r, removed: true }));
  await Promise.all(changed.map((r) => db.putPhoto(r)));
  const bytes = changed.reduce((s, r) => s + r.size, 0);
  photosStore.set((s) => ({ records: s.records.map((r) => (set.has(r.id) ? { ...r, removed: true } : r)) }));
  await addGain('photos', bytes, label);
  toast(`${changed.length} éléments marqués supprimés · ${formatBytes(bytes)} gagnés`, 'ok');
}

export async function clearPhotos() {
  const db = await getDB();
  await db.clearPhotos();
  for (const url of Object.values(photosStore.get().thumbs)) URL.revokeObjectURL(url);
  photosStore.set({ records: [], thumbs: {} });
}
