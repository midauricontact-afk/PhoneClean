import { toBytes } from './bytes';
import { normalizeName } from './catalog';

export interface AppEntry {
  name: string;
  bytes: number;
  /** Texte brut de « Dernière utilisation » (ex. « hier », « il y a 3 mois », « jamais »). */
  lastUsed?: string;
}

export interface ParsedStorage {
  apps: AppEntry[];
  usedBytes?: number;
  totalBytes?: number;
  warnings: string[];
}

const UNIT = '(?:ko|mo|go|to|kb|mb|gb|tb)';
const NUM = '\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?';
const SIZE_RE = new RegExp(`(${NUM})\\s*(${UNIT})(?![a-zA-Z])`, 'gi');
const TOTAL_RE = new RegExp(`(${NUM})\\s*(go|to|mo)\\s*(?:utilis[a-zé]*\\s*)?(?:sur|of|/)\\s*(${NUM})\\s*(go|to|mo)`, 'i');
const SUB_RE = /derni[eè]re?\s+utilisation|jamais\s+utilis|last\s+used|never\s+used/i;

/** Lignes qui ressemblent à une app mais n'en sont pas (titres, légende, boutons de recommandation). */
const SKIP_NAMES = new Set([
  'stockage iphone', 'stockage ipad', 'stockage', 'recommandations', 'recommendations', 'iphone', 'ipad', 'apps',
  'medias', 'capacite', 'disponible', 'utilise', 'voir tout', 'afficher tout', 'reglages', 'general', 'retour',
]);
const NOISE_RE = /(econom|jusqu|activer|decharger|supprimer|vider|optimiser|conserver|examiner|verifier|recommand|disponible)/;

/** Corrige les confusions classiques de l'OCR sur les unités : « G0 » → « Go », « Mc » → « Mo »… */
function normalizeUnits(text: string): string {
  return text
    .replace(/(\d)\s*[Gg][oO0cC]\b/g, '$1 Go')
    .replace(/(\d)\s*[Mm][oO0cC]\b/g, '$1 Mo')
    .replace(/(\d)\s*[Kk][oO0cC]\b/g, '$1 Ko')
    .replace(/(\d)\s*[Tt][oO0]\b/g, '$1 To');
}

function cleanName(s: string): string {
  let t = s.replace(/[|©®™•·›»>«<_~=]+/g, ' ');
  t = t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N})+!?'’]+$/u, '');
  // Lettre isolée en tête : c'est presque toujours l'icône de l'app mal lue.
  t = t.replace(/^\p{L}\s+(?=\S{3,})/u, '');
  return t.replace(/\s+/g, ' ').trim();
}

function plausibleName(name: string): boolean {
  if (name.length < 2 || name.length > 45) return false;
  if (!/\p{L}{2,}/u.test(name)) return false;
  const n = normalizeName(name);
  if (!n || SKIP_NAMES.has(n) || NOISE_RE.test(n)) return false;
  const letters = (name.match(/\p{L}/gu) ?? []).length;
  return letters >= name.replace(/\s/g, '').length / 2;
}

function splitSub(text: string): { name: string; sub?: string } {
  const m = text.match(SUB_RE);
  if (!m || m.index === undefined) return { name: text };
  return { name: text.slice(0, m.index), sub: text.slice(m.index) };
}

function lastUsedOf(sub: string): string {
  if (/jamais|never/i.test(sub)) return 'jamais';
  return sub.replace(/^.*?(utilisation|last used)\s*:?\s*/i, '').replace(/[|>›»]+/g, '').trim() || sub.trim();
}

/** Transforme le texte brut lu par l'OCR sur une capture « Stockage iPhone » en liste d'applications. */
export function parseStorageText(text: string): ParsedStorage {
  const warnings: string[] = [];
  const norm = normalizeUnits(text.replace(/\r/g, ''));

  let usedBytes: number | undefined;
  let totalBytes: number | undefined;
  const t = norm.match(TOTAL_RE);
  if (t) {
    usedBytes = toBytes(t[1], t[2]) ?? undefined;
    totalBytes = toBytes(t[3], t[4]) ?? undefined;
    if (usedBytes && totalBytes && usedBytes > totalBytes) {
      [usedBytes, totalBytes] = [totalBytes, usedBytes];
    }
  }

  const found = new Map<string, AppEntry>();
  let lastKey: string | undefined;
  const add = (name: string, bytes: number, lastUsed?: string) => {
    const key = normalizeName(name);
    lastKey = key;
    const prev = found.get(key);
    if (!prev || bytes > prev.bytes) found.set(key, { name, bytes, lastUsed: lastUsed ?? prev?.lastUsed });
    else if (lastUsed && !prev.lastUsed) prev.lastUsed = lastUsed;
  };

  let pending: { name: string; lastUsed?: string } | null = null;
  for (const raw of norm.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (TOTAL_RE.test(raw)) continue;

    const sizes = [...raw.matchAll(SIZE_RE)];
    const last = sizes[sizes.length - 1];
    const before = last ? raw.slice(0, last.index) : raw;
    const { name: rawName, sub } = splitSub(before);
    const cleaned = cleanName(rawName);
    const lastUsed = sub ? lastUsedOf(sub) : undefined;

    if (last) {
      const bytes = toBytes(last[1], last[2]);
      if (!bytes) {
        pending = null;
        continue;
      }
      if (plausibleName(cleaned)) add(cleaned, bytes, lastUsed);
      else if (pending) add(pending.name, bytes, lastUsed ?? pending.lastUsed);
      pending = null;
    } else if (sub && !cleaned) {
      // « Dernière utilisation » seule : elle suit le nom (taille lue après) ou la ligne nom + taille (déjà enregistrée).
      if (pending) pending.lastUsed = lastUsed;
      else if (lastKey && !found.get(lastKey)?.lastUsed) found.get(lastKey)!.lastUsed = lastUsed;
    } else if (plausibleName(cleaned)) {
      pending = { name: cleaned, lastUsed };
    }
  }

  const apps = [...found.values()].sort((a, b) => b.bytes - a.bytes);
  if (apps.length === 0) warnings.push("Aucune application n'a été reconnue sur cette capture.");
  const sum = apps.reduce((s, a) => s + a.bytes, 0);
  if (totalBytes && sum > totalBytes * 1.02) warnings.push('Le total des applications dépasse la capacité : une taille est sûrement mal lue.');
  return { apps, usedBytes, totalBytes, warnings };
}

/** Fusionne plusieurs captures (une même app vue deux fois garde sa plus grande valeur). */
export function mergeParsed(list: ParsedStorage[]): ParsedStorage {
  const found = new Map<string, AppEntry>();
  let usedBytes: number | undefined;
  let totalBytes: number | undefined;
  const warnings: string[] = [];
  for (const p of list) {
    usedBytes ??= p.usedBytes;
    totalBytes ??= p.totalBytes;
    warnings.push(...p.warnings);
    for (const a of p.apps) {
      const key = normalizeName(a.name);
      const prev = found.get(key);
      if (!prev || a.bytes > prev.bytes) found.set(key, { ...a, lastUsed: a.lastUsed ?? prev?.lastUsed });
      else if (a.lastUsed && !prev.lastUsed) prev.lastUsed = a.lastUsed;
    }
  }
  const apps = [...found.values()].sort((a, b) => b.bytes - a.bytes);
  const unique = [...new Set(warnings)].filter((w) => apps.length > 0 || !w.startsWith("Aucune application"));
  return { apps, usedBytes, totalBytes, warnings: apps.length ? unique.filter((w) => !w.startsWith('Aucune')) : unique };
}

export type Staleness = 'never' | 'old' | 'recent';

/** « jamais », « il y a 3 mois »… → l'app est-elle inutilisée depuis longtemps ? */
export function staleness(lastUsed?: string): Staleness | undefined {
  if (!lastUsed) return undefined;
  const n = normalizeName(lastUsed);
  if (n.startsWith('jamais') || n.includes('never')) return 'never';
  const m = n.match(/il y a (\d+) (jour|j|semaine|sem|mois|an)/);
  if (m) {
    const v = Number(m[1]);
    const unit = m[2];
    const days = unit.startsWith('j') ? v : unit.startsWith('sem') ? v * 7 : unit === 'mois' ? v * 30 : v * 365;
    return days >= 30 ? 'old' : 'recent';
  }
  if (/plus d un an|un an|un mois|plusieurs mois|mois/.test(n)) return 'old';
  if (/hier|aujourd|ce matin|cette semaine|semaine derniere|jours?/.test(n)) return 'recent';
  return undefined;
}
