import { GoogleAuth, ReauthRequiredError } from '../auth/googleAuth';
import { DRIVE_SCOPES, getClientId, saveClientId } from '../config';
import { buildIndex, withDescendants, type DriveFile, type DriveQuota } from '../core/driveAnalysis';
import { formatBytes } from '../core/bytes';
import { DemoDriveClient } from '../drive/demo';
import { RealDriveClient, type DriveApi } from '../drive/api';
import { addGain, getDB, toast } from './app';
import { createStore } from './createStore';

export interface DriveState {
  phase: 'loading' | 'needsClientId' | 'signedOut' | 'ready';
  demo: boolean;
  email?: string;
  quota?: DriveQuota;
  files: DriveFile[];
  scannedAt?: number;
  busy: { label: string; done: number; total: number } | null;
  needsReconnect: boolean;
}

export const driveStore = createStore<DriveState>({ phase: 'loading', demo: false, files: [], busy: null, needsReconnect: false });

const DEMO_KEY = 'phoneclean.driveDemo';
let auth: GoogleAuth | undefined;
let api: DriveApi | undefined;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function loadCache() {
  const db = await getDB();
  const [files, scannedAt, quota, email] = await Promise.all([
    db.get<DriveFile[]>('driveFiles'),
    db.get<number>('driveScannedAt'),
    db.get<DriveQuota>('driveQuota'),
    db.get<string>('driveEmail'),
  ]);
  driveStore.set({ files: files ?? [], scannedAt, quota, email });
}

export async function initDrive() {
  try {
    if (localStorage.getItem(DEMO_KEY) === '1') return await startDriveDemo(false);
    const clientId = getClientId();
    if (!clientId) return driveStore.set({ phase: 'needsClientId' });
    auth = new GoogleAuth(clientId, DRIVE_SCOPES);
    auth.onChange(() => driveStore.set({ needsReconnect: auth?.needsReconnect ?? false }));
    if (auth.hasAccount) {
      api = new RealDriveClient(auth);
      await loadCache();
      driveStore.set({ phase: 'ready', demo: false, needsReconnect: auth.needsReconnect });
    } else {
      driveStore.set({ phase: 'signedOut' });
    }
  } catch (e) {
    driveStore.set({ phase: 'signedOut' });
    toast(errorText(e), 'error');
  }
}

/** Charge la bibliothèque Google seulement quand on ouvre l'onglet Drive (pour que la fenêtre s'ouvre au toucher). */
export function prepareDrive() {
  void auth?.prepare().catch(() => undefined);
}

export function setDriveClientId(id: string): boolean {
  if (!saveClientId(id)) return false;
  void initDrive();
  return true;
}

/** À appeler directement depuis un toucher. */
export async function connectDrive() {
  if (!auth) return;
  try {
    await auth.signIn(!auth.email);
    api = new RealDriveClient(auth);
    const about = await api.about();
    auth.setEmail(about.email ?? 'drive');
    const db = await getDB();
    await Promise.all([db.set('driveEmail', about.email), db.set('driveQuota', about.quota)]);
    await loadCache();
    driveStore.set({ phase: 'ready', demo: false, email: about.email, quota: about.quota, needsReconnect: false });
    if (driveStore.get().files.length === 0) await scanDrive();
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

export function connectDriveWithRedirect() {
  auth?.signInWithRedirect(!auth.email);
}

export async function reconnectDrive() {
  if (!auth) return;
  try {
    await auth.signIn(false);
    toast('Session Google renouvelée', 'ok');
  } catch (e) {
    if (e instanceof ReauthRequiredError) auth.signInWithRedirect(false);
    else toast(errorText(e), 'error');
  }
}

export async function startDriveDemo(scan = true) {
  localStorage.setItem(DEMO_KEY, '1');
  api = new DemoDriveClient();
  const about = await api.about();
  driveStore.set({ phase: 'ready', demo: true, email: about.email, quota: about.quota, files: [], scannedAt: undefined });
  if (scan) await scanDrive();
}

export async function signOutDrive() {
  const demo = driveStore.get().demo;
  if (demo) localStorage.removeItem(DEMO_KEY);
  else auth?.signOut();
  api = undefined;
  const db = await getDB();
  await Promise.all(['driveFiles', 'driveScannedAt', 'driveQuota', 'driveEmail'].map((k) => db.del(k)));
  driveStore.set({ phase: 'loading', demo: false, email: undefined, quota: undefined, files: [], scannedAt: undefined, busy: null });
  await initDrive();
}

async function run<T>(label: string, fn: (progress: (done: number, total: number, label?: string) => void) => Promise<T>): Promise<T | undefined> {
  if (!api) return undefined;
  if (driveStore.get().busy) {
    toast('Une opération est déjà en cours.', 'info');
    return undefined;
  }
  driveStore.set({ busy: { label, done: 0, total: 0 } });
  try {
    return await fn((done, total, l) => driveStore.set((s) => ({ busy: { label: l ?? s.busy?.label ?? label, done, total } })));
  } catch (e) {
    if (e instanceof ReauthRequiredError) driveStore.set({ needsReconnect: true });
    toast(errorText(e), 'error');
    return undefined;
  } finally {
    driveStore.set({ busy: null });
  }
}

export function scanDrive() {
  return run('Analyse de ton Drive…', async (progress) => {
    const client = api!;
    const about = await client.about();
    const files = await client.listFiles((n) => progress(n, 0, `Analyse de ton Drive… ${n.toLocaleString('fr-FR')} éléments`));
    const scannedAt = Date.now();
    const db = await getDB();
    await Promise.all([db.set('driveFiles', files), db.set('driveScannedAt', scannedAt), db.set('driveQuota', about.quota), db.set('driveEmail', about.email)]);
    driveStore.set({ files, scannedAt, quota: about.quota, email: about.email });
    toast(`${files.length.toLocaleString('fr-FR')} éléments analysés`, 'ok');
  });
}

/** Met à la corbeille (jamais de suppression définitive). L'espace n'est libéré qu'en vidant la corbeille Drive. */
export function trashDriveFiles(ids: string[]) {
  return run('Mise à la corbeille…', async (progress) => {
    const client = api!;
    const done = await client.trash(ids, (d, t) => progress(d, t));
    // Un dossier mis à la corbeille emporte tout son contenu.
    const gone = withDescendants(buildIndex(driveStore.get().files), done);
    const files = driveStore.get().files.filter((f) => !gone.has(f.id));
    const db = await getDB();
    await db.set('driveFiles', files);
    const about = await client.about();
    await db.set('driveQuota', about.quota);
    driveStore.set({ files, quota: about.quota });
    const failed = ids.length - done.length;
    toast(
      `${done.length.toLocaleString('fr-FR')} éléments à la corbeille Drive` + (failed ? ` (${failed} en échec)` : '') + '. Vide la corbeille pour libérer la place.',
      failed ? 'error' : 'ok',
    );
  });
}

/** Suppression définitive du contenu de la corbeille Drive (après double confirmation dans l'interface). */
export function emptyDriveTrash() {
  return run('Vidage de la corbeille…', async () => {
    const client = api!;
    const before = (await client.about()).quota;
    await client.emptyTrash();
    const freed = before.usageInTrash; // l'appel a réussi : tout ce qui était dans la corbeille est supprimé
    const quota = { ...before, usage: Math.max(0, before.usage - freed), usageInDrive: Math.max(0, before.usageInDrive - freed), usageInTrash: 0 };
    const db = await getDB();
    await db.set('driveQuota', quota);
    driveStore.set({ quota });
    await addGain('drive', freed, 'Corbeille Drive vidée');
    toast(`Corbeille vidée : ${formatBytes(freed)} libérés`, 'ok');
  });
}
