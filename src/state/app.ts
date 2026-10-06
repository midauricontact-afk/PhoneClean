import type { GainEntry, GainSource, Snapshot } from '../core/snapshots';
import { LocalDB } from '../storage/db';
import { createStore } from './createStore';

export type Theme = 'auto' | 'light' | 'dark';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
}

export interface AppState {
  ready: boolean;
  snapshots: Snapshot[];
  gains: GainEntry[];
  checklist: Record<string, boolean>;
  theme: Theme;
  toasts: Toast[];
}

const THEME_KEY = 'phoneclean.theme';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export const appStore = createStore<AppState>({
  ready: false,
  snapshots: [],
  gains: [],
  checklist: {},
  theme: readTheme(),
  toasts: [],
});

let dbPromise: Promise<LocalDB> | null = null;

/** Base locale partagée par tous les modules. */
export function getDB(): Promise<LocalDB> {
  dbPromise ??= LocalDB.open();
  return dbPromise;
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function initApp() {
  applyTheme(appStore.get().theme);
  const d = await getDB();
  const [snapshots, gains, checklist] = await Promise.all([d.getSnapshots(), d.getGains(), d.get<Record<string, boolean>>('checklist')]);
  appStore.set({
    ready: true,
    snapshots: snapshots.sort((a, b) => a.date - b.date),
    gains: gains.sort((a, b) => a.date - b.date),
    checklist: checklist ?? {},
  });
}

let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t: Toast = { id: ++toastSeq, text, kind };
  appStore.set((s) => ({ toasts: [...s.toasts, t] }));
  setTimeout(() => appStore.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), kind === 'error' ? 6000 : 3500);
}

export async function saveSnapshot(s: Omit<Snapshot, 'id' | 'date'> & { id?: string; date?: number }): Promise<Snapshot> {
  const snap: Snapshot = { ...s, id: s.id ?? uid(), date: s.date ?? Date.now() };
  await (await getDB()).putSnapshot(snap);
  appStore.set((st) => ({ snapshots: [...st.snapshots.filter((x) => x.id !== snap.id), snap].sort((a, b) => a.date - b.date) }));
  return snap;
}

export async function removeSnapshot(id: string) {
  await (await getDB()).deleteSnapshot(id);
  appStore.set((st) => ({ snapshots: st.snapshots.filter((x) => x.id !== id) }));
}

export async function addGain(source: GainSource, bytes: number, label: string) {
  if (bytes <= 0) return;
  const g: GainEntry = { id: uid(), date: Date.now(), source, bytes, label };
  await (await getDB()).putGain(g);
  appStore.set((st) => ({ gains: [...st.gains, g] }));
}

export async function setChecked(key: string, value: boolean) {
  const checklist = { ...appStore.get().checklist };
  if (value) checklist[key] = true;
  else delete checklist[key];
  appStore.set({ checklist });
  await (await getDB()).set('checklist', checklist);
}

export async function resetChecklist() {
  appStore.set({ checklist: {} });
  await (await getDB()).set('checklist', {});
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignoré */
  }
  appStore.set({ theme });
  applyTheme(theme);
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const forDark = m.media.includes('dark');
    m.content = theme === 'auto' ? (forDark ? '#000000' : '#f2f2f7') : dark ? '#000000' : '#f2f2f7';
  });
}

/** Efface toutes les données locales (captures, historique, photos analysées, cache Drive). */
export async function wipeEverything() {
  await new Promise<void>((resolve) => {
    dbPromise = null;
    const req = indexedDB.deleteDatabase('phoneclean');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  appStore.set({ snapshots: [], gains: [], checklist: {} });
}
