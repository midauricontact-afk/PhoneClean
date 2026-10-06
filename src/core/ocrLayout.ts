import { canonicalName, normalizeName } from './catalog';
import {
  UNNAMED_MIN_BYTES,
  SIZE_RE,
  classifyName,
  cleanName,
  lastUsedOf,
  parseSizeText,
  splitSub,
  type AppEntry,
  type NameKind,
} from './ocrParse';

/** Une ligne lue par l'OCR avec sa position verticale (en pixels de la capture préparée). */
export interface OcrLine {
  text: string;
  y0: number;
  y1: number;
}

interface Row {
  name: string;
  kind: NameKind;
  lastUsed?: string;
  y0: number;
  y1: number;
  hasSub: boolean;
}

/**
 * Sur iOS, chaque app occupe une « rangée » : le nom, puis dessous « Dernière utilisation : … », et la taille alignée
 * à droite, au milieu des deux lignes. On lit donc les noms (colonne de gauche) et les tailles (colonne de droite)
 * séparément, puis on associe chaque taille à la rangée dont la hauteur correspond.
 */
export function buildRows(nameLines: OcrLine[]): Row[] {
  const rows: Row[] = [];
  const sorted = [...nameLines].filter((l) => l.text.trim()).sort((a, b) => a.y0 - b.y0);
  for (const line of sorted) {
    const text = line.text.replace(SIZE_RE, ' ').trim();
    if (!text) continue;
    const { name: rawName, sub } = splitSub(text);
    const cleaned = cleanName(rawName);
    const kind = classifyName(cleaned);
    const prev = rows[rows.length - 1];

    if (sub !== undefined) {
      const lastUsed = lastUsedOf(sub);
      if (cleaned && kind !== 'empty') {
        // Nom et « Dernière utilisation » collés sur la même ligne.
        rows.push({ name: cleaned, kind, lastUsed, y0: line.y0, y1: line.y1, hasSub: true });
      } else if (prev && !prev.hasSub && line.y0 - prev.y1 < (prev.y1 - prev.y0) * 2) {
        prev.hasSub = true;
        prev.lastUsed = lastUsed;
        prev.y1 = line.y1;
      } else {
        // Ligne « Dernière utilisation » dont le nom n'a pas été lu : on garde la rangée, sans nom.
        const h = line.y1 - line.y0;
        rows.push({ name: '', kind: 'empty', lastUsed, y0: line.y0 - h, y1: line.y1, hasSub: true });
      }
    } else {
      rows.push({ name: cleaned, kind, y0: line.y0, y1: line.y1, hasSub: false });
    }
  }
  return rows;
}

export interface LayoutResult {
  apps: AppEntry[];
  unnamed: number[];
  /** Tailles qui ne correspondent à aucune rangée (recommandations, bruit) : ignorées. */
  ignoredSizes: number;
}

export function alignRows(nameLines: OcrLine[], sizeLines: OcrLine[]): LayoutResult {
  const rows = buildRows(nameLines);
  const sizes = sizeLines
    .map((l) => ({ bytes: parseSizeText(l.text), c: (l.y0 + l.y1) / 2, h: l.y1 - l.y0 }))
    .filter((s): s is { bytes: number; c: number; h: number } => !!s.bytes);

  // Chaque taille choisit la rangée dont le centre est le plus proche ; une rangée ne prend qu'une taille.
  const taken = new Map<number, { bytes: number; dist: number }>();
  let ignored = 0;
  for (const s of sizes) {
    let best = -1;
    let bestDist = Infinity;
    rows.forEach((r, i) => {
      const center = (r.y0 + r.y1) / 2;
      const reach = (r.y1 - r.y0) / 2 + Math.max(s.h, r.y1 - r.y0) * 0.6;
      const dist = Math.abs(s.c - center);
      if (dist <= reach && dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    });
    if (best < 0) {
      ignored++;
      continue;
    }
    const prev = taken.get(best);
    if (!prev || bestDist < prev.dist) {
      if (prev) ignored++;
      taken.set(best, { bytes: s.bytes, dist: bestDist });
    } else {
      ignored++;
    }
  }

  const found = new Map<string, AppEntry>();
  const unnamed: number[] = [];
  rows.forEach((r, i) => {
    const t = taken.get(i);
    if (!t) return;
    if (r.kind === 'ok') {
      const name = canonicalName(r.name);
      const key = normalizeName(name);
      const prev = found.get(key);
      if (!prev || t.bytes > prev.bytes) found.set(key, { name, bytes: t.bytes, lastUsed: r.lastUsed ?? prev?.lastUsed });
    } else if (r.kind !== 'noise' && t.bytes >= UNNAMED_MIN_BYTES) {
      unnamed.push(t.bytes);
    }
  });
  return { apps: [...found.values()].sort((a, b) => b.bytes - a.bytes), unnamed: unnamed.sort((a, b) => b - a), ignoredSizes: ignored };
}
