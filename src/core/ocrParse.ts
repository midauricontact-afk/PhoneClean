import { toBytes } from './bytes';
import { canonicalName, isExactKnown, matchApp, normalizeName } from './catalog';

export interface AppEntry {
  name: string;
  bytes: number;
  /** Texte brut de « Dernière utilisation » (ex. « hier », « 29/09/2026 », « jamais »). */
  lastUsed?: string;
}

export interface ParsedStorage {
  apps: AppEntry[];
  /** Tailles lues dont le nom n'a pas pu l'être (icône mal lue…) : à nommer ou retirer à la main. */
  unnamed: number[];
  usedBytes?: number;
  totalBytes?: number;
  warnings: string[];
}

/** Sous ce seuil, une ligne sans nom lisible est ignorée au lieu d'être proposée à la main. */
export const UNNAMED_MIN_BYTES = 200e6;

const UNIT = '(?:ko|mo|go|to|kb|mb|gb|tb)';
const NUM = '\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?';
export const SIZE_RE = new RegExp(`(${NUM})\\s*(${UNIT})(?![a-zA-Z])`, 'gi');
const TOTAL_RE = new RegExp(`(${NUM})\\s*(go|to|mo)\\s*(?:utilis[a-zé]*\\s*)?(?:sur|of|/)\\s*(${NUM})\\s*(go|to|mo)`, 'i');

// « Dernière utilisation : hier » et ses versions abîmées par l'OCR (« utilisation : Aujourd'hui », « Lu : Aujourd'hui »…).
export const SUB_RE =
  /derni[eè]re?\s+utilisation|utilisation\s*:|jamais\s+utilis|last\s+used|never\s+used|\blu\s*:|aujourd|\bhier\b|il\s+y\s+a\s+\d+\s+(?:jour|sem|mois|an)/i;

/** Lignes qui ressemblent à une app mais n'en sont pas (titres, légende, boutons de recommandation). */
const SKIP_NAMES = new Set([
  'stockage iphone', 'stockage ipad', 'stockage', 'recommandations', 'recommendations', 'iphone', 'ipad', 'apps',
  'medias', 'capacite', 'disponible', 'utilise', 'voir tout', 'afficher tout', 'tout afficher', 'reglages', 'general',
  'retour', 'applications', 'apps masquees', 'taille',
]);
const NOISE_RE =
  /(econom|jusqu|activer|decharger|supprimer|vider|optimiser|conserver|examiner|verifier|recommand|disponible|sur mon iphone|pieces jointes|volumineuse|vos videos|videos personnelles|photos et videos|utilisation|aujourd|dernier|erniere|iphone|ipad|stockage|passez en revue|revue|espace|prennent|voyez|choisissez|apps masquees)/;

/** Corrige les confusions classiques de l'OCR sur les unités et les décimales : « G0 » → « Go », « 714 3 Mo » → « 714,3 Mo »… */
export function normalizeUnits(text: string): string {
  return text
    .replace(/(\d)\s*[Gg][oO0cC]\b/g, '$1 Go')
    .replace(/(\d)\s*[Mm][oO0cC]\b/g, '$1 Mo')
    .replace(/(\d)\s*[Kk][oO0cC]\b/g, '$1 Ko')
    .replace(/(\d)\s*[Tt][oO0]\b/g, '$1 To')
    // Virgule lue comme une espace : « 714 3 Mo », « 1 36 Go ».
    .replace(/(?<![\d,.])(\d{3}) (\d) (Mo|Ko)\b/g, '$1,$2 $3')
    .replace(/(?<![\d,.])(\d) (\d{2}) (Go)\b/g, '$1,$2 $3')
    // Virgule perdue : iOS n'affiche jamais 4 chiffres en Mo (au-delà de 999 Mo il passe en Go), « 7143Mo » = 714,3 Mo.
    .replace(/(?<![\d,.])(\d{3})(\d) ?(Mo)\b/g, '$1,$2 $3');
}

export function cleanName(s: string): string {
  let t = s.replace(/[|©®™•·›»>«<_~=]+/g, ' ');
  t = t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N})+!?'’]+$/u, '');
  // Lettre isolée en tête : c'est presque toujours l'icône de l'app mal lue.
  t = t.replace(/^\p{L}\s+(?=\S{3,})/u, '');
  const parts = t.replace(/\s+/g, ' ').trim().split(' ');
  // Petits mots en tête (« ae TikTok », « KDE Instagram ») : l'icône lue comme du texte. On les retire si le reste est une app connue
  // ou si le petit mot est en minuscules (un vrai nom commence par une majuscule).
  while (parts.length > 1 && parts[0].length <= 3) {
    const rest = parts.slice(1).join(' ');
    const lowerJunk = parts[0].length <= 2 && parts[0] === parts[0].toLowerCase();
    if (rest.length < 3 || !(lowerJunk || matchApp(rest).known)) break;
    parts.shift();
  }
  return parts.join(' ');
}

export type NameKind = 'ok' | 'noise' | 'junk' | 'empty';

/** ok = nom d'app crédible ; noise = ligne qui n'est pas une app (légende, recommandation) ; junk = texte illisible (icône). */
export function classifyName(name: string): NameKind {
  if (!name) return 'empty';
  const n = normalizeName(name);
  if (!n) return 'empty';
  if (SKIP_NAMES.has(n) || NOISE_RE.test(n)) return 'noise';
  if (matchApp(name).known) return 'ok';
  const letters = (name.match(/\p{L}/gu) ?? []).length;
  if (name.length <= 45 && /\p{L}{4,}/u.test(name) && letters >= name.replace(/\s/g, '').length / 2) return 'ok';
  return 'junk';
}

export function splitSub(text: string): { name: string; sub?: string } {
  const m = text.match(SUB_RE);
  if (m && m.index !== undefined) return { name: text.slice(0, m.index), sub: text.slice(m.index) };
  const colon = text.indexOf(':');
  if (colon >= 0) {
    // « BRAVE cation: Avoudmu » : « Dernière utilisation » abîmée. Le nom est ce qui précède le dernier mot avant « : ».
    const before = text.slice(0, colon).trimEnd();
    const cut = before.lastIndexOf(' ');
    return cut >= 0 ? { name: before.slice(0, cut), sub: text.slice(cut) } : { name: '', sub: text };
  }
  return { name: text };
}

export function lastUsedOf(sub: string): string {
  if (/jamais|never/i.test(sub)) return 'jamais';
  const after = sub.includes(':') ? sub.slice(sub.lastIndexOf(':') + 1) : sub.replace(/^.*?(utilisation|last used)\s*/i, '');
  return after.replace(/[|>›»]+/g, '').trim() || sub.trim();
}

/** Lit une valeur de taille isolée (colonne de droite) : « 43,01 Go » → octets. Renvoie null si illisible. */
export function parseSizeText(text: string): number | null {
  const norm = normalizeUnits(text);
  const matches = [...norm.matchAll(SIZE_RE)];
  const last = matches[matches.length - 1];
  return last ? toBytes(last[1], last[2]) : null;
}

/**
 * Corrections de bon sens, une fois le total connu :
 * « 188 Go » alors que le téléphone fait 128 Go → la virgule a été perdue : 1,88 Go ;
 * une « app » aussi grosse que le téléphone est un morceau d'en-tête.
 */
export function repairSizes(p: ParsedStorage): ParsedStorage {
  const total = p.totalBytes;
  // « 128 Go » ou « 125 Go » = la capacité ou l'espace utilisé de l'en-tête, pas une app.
  const isHeader = (b: number) => [p.totalBytes, p.usedBytes].some((h) => !!h && Math.abs(b - h) <= h * 0.01);
  const fix = (bytes: number) => {
    // Une « app » de plus de 100 Go sur un petit téléphone est une erreur de lecture :
    if (bytes < 100e9 || (total && bytes <= total * 0.5)) return bytes;
    if (bytes % 1e9 === 0) return bytes / 100; // « 188 Go » : la virgule a été perdue → 1,88 Go
    if (bytes % 1e8 === 0) return bytes / 1000; // « 714,3 Go » : M lu comme G → 714,3 Mo (iOS affiche les Mo avec une décimale)
    return bytes;
  };
  const keep = (b: number) => !isHeader(b) && (!total || b < total * 0.85);
  const apps = p.apps.filter((a) => !isHeader(a.bytes)).map((a) => ({ ...a, bytes: fix(a.bytes) })).filter((a) => keep(a.bytes));
  const unnamed = p.unnamed.filter((b) => !isHeader(b)).map(fix).filter(keep);
  return { ...p, apps, unnamed };
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
  const add = (rawName: string, bytes: number, lastUsed?: string) => {
    const name = canonicalName(rawName);
    const key = normalizeName(name);
    lastKey = key;
    const prev = found.get(key);
    if (!prev || bytes > prev.bytes) found.set(key, { name, bytes, lastUsed: lastUsed ?? prev?.lastUsed });
    else if (lastUsed && !prev.lastUsed) prev.lastUsed = lastUsed;
  };

  const unnamed: number[] = [];
  let pending: { name: string; lastUsed?: string } | null = null;
  for (const raw of norm.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (TOTAL_RE.test(raw)) continue;

    const sizes = [...raw.matchAll(SIZE_RE)];
    const last = sizes[sizes.length - 1];
    const before = last ? raw.slice(0, last.index) : raw;
    const { name: rawName, sub } = splitSub(before);
    const cleaned = cleanName(rawName);
    const kind = classifyName(cleaned);
    const lastUsed = sub ? lastUsedOf(sub) : undefined;

    if (last) {
      const bytes = toBytes(last[1], last[2]);
      if (!bytes) {
        pending = null;
        continue;
      }
      if (kind === 'ok') add(cleaned, bytes, lastUsed);
      else if (kind !== 'noise' && pending) add(pending.name, bytes, lastUsed ?? pending.lastUsed);
      else if (kind !== 'noise' && bytes >= UNNAMED_MIN_BYTES) unnamed.push(bytes);
      pending = null;
    } else if (sub && !cleaned) {
      // « Dernière utilisation » seule : elle suit le nom (taille lue après) ou la ligne nom + taille (déjà enregistrée).
      if (pending) pending.lastUsed = lastUsed;
      else if (lastKey && !found.get(lastKey)?.lastUsed) found.get(lastKey)!.lastUsed = lastUsed;
    } else if (kind === 'ok') {
      pending = { name: cleaned, lastUsed };
    } else {
      pending = null;
    }
  }

  const apps = [...found.values()].sort((a, b) => b.bytes - a.bytes);
  if (apps.length === 0 && unnamed.length === 0) warnings.push("Aucune application n'a été reconnue sur cette capture.");
  const sum = apps.reduce((s, a) => s + a.bytes, 0);
  if (totalBytes && sum > totalBytes * 1.02) warnings.push('Le total des applications dépasse la capacité : une taille est sûrement mal lue.');
  return { apps, unnamed, usedBytes, totalBytes, warnings };
}

/**
 * Fusionne plusieurs captures. Une app vue sur deux captures (elles se chevauchent) peut être mal lue sur l'une :
 * on retient la valeur la plus souvent lue, et à égalité la plus grande.
 */
export function mergeParsed(list: ParsedStorage[]): ParsedStorage {
  const found = new Map<string, { name: string; lastUsed?: string; votes: Map<number, number> }>();
  let usedBytes: number | undefined;
  let totalBytes: number | undefined;
  const warnings: string[] = [];
  for (const p of list) {
    usedBytes ??= p.usedBytes;
    totalBytes ??= p.totalBytes;
    warnings.push(...p.warnings);
    for (const a of p.apps) {
      const key = normalizeName(a.name);
      const entry = found.get(key) ?? { name: a.name, lastUsed: a.lastUsed, votes: new Map<number, number>() };
      entry.lastUsed ??= a.lastUsed;
      entry.votes.set(a.bytes, (entry.votes.get(a.bytes) ?? 0) + 1);
      found.set(key, entry);
    }
  }
  const apps: AppEntry[] = [...found.values()].map((e) => {
    const [bytes] = [...e.votes.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0];
    return { name: e.name, bytes, lastUsed: e.lastUsed };
  });
  apps.sort((x, y) => y.bytes - x.bytes);
  const unnamed = list.flatMap((p) => p.unnamed).sort((x, y) => y - x);
  const hasContent = apps.length > 0 || unnamed.length > 0;
  const unique = [...new Set(warnings)].filter((w) => !hasContent || !w.startsWith('Aucune application'));
  return { apps, unnamed, usedBytes, totalBytes, warnings: unique };
}

export type Staleness = 'never' | 'old' | 'recent';

/** « jamais », « il y a 3 mois », « 29/09/2026 »… → l'app est-elle inutilisée depuis longtemps ? */
export function staleness(lastUsed?: string, now = Date.now()): Staleness | undefined {
  if (!lastUsed) return undefined;
  const n = normalizeName(lastUsed);
  if (n.startsWith('jamais') || n.includes('never')) return 'never';
  // iOS affiche une date (jj/mm/aaaa) dès que l'usage n'est plus récent.
  const d = n.match(/\b(\d{1,2}) (\d{1,2}) (\d{4})\b/);
  if (d) {
    const ms = Date.UTC(Number(d[3]), Number(d[2]) - 1, Number(d[1]));
    return (now - ms) / 86_400_000 >= 30 ? 'old' : 'recent';
  }
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

/** Recoupe deux lectures de la même capture (ancienne méthode, gardée en secours quand la lecture par position échoue). */
export function combinePasses(masked: ParsedStorage, full: ParsedStorage): ParsedStorage {
  const merged = mergeParsed([masked, full]);
  const apps: AppEntry[] = [];
  for (const a of merged.apps) {
    const na = normalizeName(a.name);
    const twin = apps.find((b) => {
      const nb = normalizeName(b.name);
      return b.bytes === a.bytes && (nb.includes(na) || na.includes(nb));
    });
    if (!twin) {
      apps.push({ ...a });
      continue;
    }
    // Même taille, noms emboîtés (« tagram » / « Instagram » / « KDE Instagram ») : nom connu exact d'abord, sinon le plus complet.
    const better = isExactKnown(a.name) !== isExactKnown(twin.name) ? isExactKnown(a.name) : na.length > normalizeName(twin.name).length;
    if (better) twin.name = a.name;
    twin.lastUsed ??= a.lastUsed;
  }
  const taken = new Set(apps.map((a) => a.bytes));
  const unnamed: number[] = [];
  for (const b of [...masked.unnamed, ...full.unnamed]) if (!taken.has(b) && !unnamed.includes(b)) unnamed.push(b);
  return repairSizes({
    apps,
    unnamed: unnamed.sort((a, b) => b - a),
    usedBytes: full.usedBytes ?? masked.usedBytes,
    totalBytes: full.totalBytes ?? masked.totalBytes,
    warnings: merged.warnings,
  });
}
