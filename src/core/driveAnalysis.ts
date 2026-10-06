export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const ROOT = 'root';

export interface DriveFile {
  id: string;
  name: string;
  mime: string;
  /** Octets comptés dans ton quota (0 pour les Google Docs/Sheets/Slides). */
  size: number;
  md5?: string;
  parents: string[];
  modified: number;
}

export type DriveType = 'images' | 'videos' | 'audio' | 'pdf' | 'documents' | 'archives' | 'apps' | 'other';

export const DRIVE_TYPES: { id: DriveType; label: string; color: string }[] = [
  { id: 'videos', label: 'Vidéos', color: '#8b5cf6' },
  { id: 'images', label: 'Images', color: '#10b981' },
  { id: 'audio', label: 'Audio', color: '#f59e0b' },
  { id: 'pdf', label: 'PDF', color: '#ef4444' },
  { id: 'documents', label: 'Documents', color: '#3b82f6' },
  { id: 'archives', label: 'Archives', color: '#06b6d4' },
  { id: 'apps', label: 'Applications', color: '#ec4899' },
  { id: 'other', label: 'Autres', color: '#9ca3af' },
];

export const TYPE_BY_ID = Object.fromEntries(DRIVE_TYPES.map((t) => [t.id, t])) as Record<DriveType, (typeof DRIVE_TYPES)[number]>;

export function typeOf(f: Pick<DriveFile, 'mime' | 'name'>): DriveType {
  const m = f.mime;
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (m.startsWith('video/') || ['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'videos';
  if (m.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp'].includes(ext)) return 'images';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'flac', 'm4a', 'aac'].includes(ext)) return 'audio';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/zip|rar|7z|tar|gzip/.test(m) || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archives';
  if (/android\.package|x-msdownload|x-apple-diskimage|vnd\.microsoft\.portable/.test(m) || ['apk', 'exe', 'dmg', 'iso', 'msi'].includes(ext)) return 'apps';
  if (/document|sheet|presentation|msword|ms-excel|ms-powerpoint|text\//.test(m) || ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'odt'].includes(ext)) return 'documents';
  return 'other';
}

export const isFolder = (f: Pick<DriveFile, 'mime'>) => f.mime === FOLDER_MIME;

export interface DriveIndex {
  byId: Map<string, DriveFile>;
  /** Contenu direct de chaque dossier (clé ROOT pour la racine). */
  children: Map<string, DriveFile[]>;
  /** Taille cumulée et nombre de fichiers de chaque dossier, sous-dossiers compris. */
  folders: Map<string, { size: number; count: number }>;
}

/** Un fichier dont le dossier parent est inconnu (partagé, racine…) est rangé à la racine. */
export function buildIndex(files: DriveFile[]): DriveIndex {
  const byId = new Map(files.map((f) => [f.id, f]));
  const children = new Map<string, DriveFile[]>();
  for (const f of files) {
    const p = f.parents[0];
    const parent = p && byId.has(p) && isFolder(byId.get(p)!) ? p : ROOT;
    const list = children.get(parent) ?? [];
    list.push(f);
    children.set(parent, list);
  }

  const folders = new Map<string, { size: number; count: number }>();
  const visit = (rootId: string) => {
    // Parcours itératif en post-ordre : les dossiers très profonds ne font pas déborder la pile.
    const stack: { id: string; i: number }[] = [{ id: rootId, i: 0 }];
    const acc = new Map<string, { size: number; count: number }>([[rootId, { size: 0, count: 0 }]]);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const kids = children.get(top.id) ?? [];
      if (top.i < kids.length) {
        const k = kids[top.i++];
        if (isFolder(k)) {
          if (!acc.has(k.id)) {
            acc.set(k.id, { size: 0, count: 0 });
            stack.push({ id: k.id, i: 0 });
          }
        } else {
          const a = acc.get(top.id)!;
          a.size += k.size;
          a.count += 1;
        }
      } else {
        stack.pop();
        const done = acc.get(top.id)!;
        folders.set(top.id, done);
        const parent = stack[stack.length - 1];
        if (parent) {
          const pa = acc.get(parent.id)!;
          pa.size += done.size;
          pa.count += done.count;
        }
      }
    }
  };
  visit(ROOT);
  return { byId, children, folders };
}

export interface DriveEntry {
  id: string;
  name: string;
  size: number;
  count: number;
  isFolder: boolean;
  file: DriveFile;
}

/** Contenu d'un dossier avec la taille cumulée, du plus lourd au plus léger. */
export function childrenOf(index: DriveIndex, folderId: string = ROOT): DriveEntry[] {
  return (index.children.get(folderId) ?? [])
    .map((f) => {
      const folder = isFolder(f);
      const agg = folder ? index.folders.get(f.id) : undefined;
      return { id: f.id, name: f.name, size: folder ? (agg?.size ?? 0) : f.size, count: folder ? (agg?.count ?? 0) : 1, isFolder: folder, file: f };
    })
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
}

/** Chemin depuis la racine jusqu'au dossier (inclus). */
export function pathOf(index: DriveIndex, folderId: string): DriveFile[] {
  const out: DriveFile[] = [];
  let cur: string | undefined = folderId;
  const seen = new Set<string>();
  while (cur && cur !== ROOT && !seen.has(cur)) {
    seen.add(cur);
    const f = index.byId.get(cur);
    if (!f) break;
    out.unshift(f);
    const p: string | undefined = f.parents[0];
    cur = p && index.byId.has(p) ? p : undefined;
  }
  return out;
}

export function pathName(index: DriveIndex, f: DriveFile): string {
  const parent = f.parents[0] && index.byId.has(f.parents[0]) ? pathOf(index, f.parents[0]) : [];
  return ['Mon Drive', ...parent.map((p) => p.name)].join(' / ');
}

export const realFiles = (files: DriveFile[]) => files.filter((f) => !isFolder(f));

export function totalSize(files: DriveFile[]): number {
  return realFiles(files).reduce((s, f) => s + f.size, 0);
}

export function typeTotals(files: DriveFile[]): { type: DriveType; size: number; count: number }[] {
  const acc = new Map<DriveType, { size: number; count: number }>();
  for (const f of realFiles(files)) {
    const t = typeOf(f);
    const a = acc.get(t) ?? { size: 0, count: 0 };
    a.size += f.size;
    a.count += 1;
    acc.set(t, a);
  }
  return [...acc.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.size - a.size);
}

export function biggest(files: DriveFile[], n = 100): DriveFile[] {
  return realFiles(files)
    .filter((f) => f.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, n);
}

const MONTH_MS = 30.44 * 24 * 3600 * 1000;

export function oldFiles(files: DriveFile[], months: number, minSize = 1e6, now = Date.now()): DriveFile[] {
  const limit = now - months * MONTH_MS;
  return realFiles(files)
    .filter((f) => f.modified < limit && f.size >= minSize)
    .sort((a, b) => b.size - a.size);
}

export interface DriveDupGroup {
  md5: string;
  files: DriveFile[];
  keepId: string;
  reclaim: number;
}

/** Doublons exacts : même empreinte MD5 calculée par Google. On garde le plus ancien. */
export function findDriveDuplicates(files: DriveFile[]): DriveDupGroup[] {
  const byMd5 = new Map<string, DriveFile[]>();
  for (const f of realFiles(files)) {
    if (!f.md5 || f.size <= 0) continue;
    const list = byMd5.get(f.md5) ?? [];
    list.push(f);
    byMd5.set(f.md5, list);
  }
  const groups: DriveDupGroup[] = [];
  for (const [md5, list] of byMd5) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.modified - b.modified || a.id.localeCompare(b.id));
    groups.push({ md5, files: sorted, keepId: sorted[0].id, reclaim: sorted.slice(1).reduce((s, f) => s + f.size, 0) });
  }
  return groups.sort((a, b) => b.reclaim - a.reclaim);
}

export interface DriveQuota {
  /** Capacité totale (undefined = illimité). */
  limit?: number;
  /** Utilisé au total : Drive + Gmail + Photos. */
  usage: number;
  usageInDrive: number;
  usageInTrash: number;
}

/** Part du quota occupée par Gmail et Google Photos (le reste du total). */
export function otherUsage(q: DriveQuota): number {
  return Math.max(0, q.usage - q.usageInDrive);
}

function ancestors(index: DriveIndex, f: DriveFile): string[] {
  const out: string[] = [];
  let p = f.parents[0];
  const seen = new Set<string>();
  while (p && index.byId.has(p) && !seen.has(p)) {
    seen.add(p);
    out.push(p);
    p = index.byId.get(p)!.parents[0];
  }
  return out;
}

/** Retire de la sélection ce qui est déjà dans un dossier sélectionné (le dossier part avec tout son contenu). */
export function topLevel(index: DriveIndex, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return [...set].filter((id) => {
    const f = index.byId.get(id);
    return f ? !ancestors(index, f).some((a) => set.has(a)) : true;
  });
}

/** Les identifiants sélectionnés plus tout ce qu'ils contiennent. */
export function withDescendants(index: DriveIndex, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const k of index.children.get(id) ?? []) stack.push(k.id);
  }
  return out;
}

/** Espace occupé par la sélection, sans compter deux fois un fichier et son dossier. */
export function sizeOfSelection(index: DriveIndex, ids: Iterable<string>): number {
  return topLevel(index, ids).reduce((s, id) => {
    const f = index.byId.get(id);
    if (!f) return s;
    return s + (isFolder(f) ? (index.folders.get(id)?.size ?? 0) : f.size);
  }, 0);
}
