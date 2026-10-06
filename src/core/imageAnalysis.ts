/** Détection locale de doublons, de photos similaires, floues, captures d'écran et grosses vidéos. */

export interface PhotoRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: 'image' | 'video';
  width?: number;
  height?: number;
  /** Date de prise de vue approximative (date du fichier ; absente si elle n'est pas fiable). */
  taken?: number;
  added: number;
  /** Empreinte exacte du contenu (SHA-256 ; pour une vidéo : échantillon + taille). */
  sha?: string;
  /** Empreinte perceptuelle dHash 64 bits, en hexadécimal (16 caractères). */
  phash?: string;
  /** Netteté (variance du laplacien) : plus c'est bas, plus la photo est floue. */
  blur?: number;
  duration?: number;
  /** Déclarée supprimée par l'utilisateur dans l'app Photos. */
  removed?: boolean;
}

export const BLUR_THRESHOLD = 60;
export const SIMILAR_DISTANCE = 10;
export const BIG_VIDEO_BYTES = 100e6;
export const BURST_SPAN_MS = 10_000;

// ---------------------------------------------------------------------------
// Empreintes
// ---------------------------------------------------------------------------

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

function parts(hash: string): [number, number] {
  return [parseInt(hash.slice(0, 8), 16) >>> 0, parseInt(hash.slice(8, 16), 16) >>> 0];
}

/** Distance de Hamming entre deux empreintes de 64 bits (0 = identiques, 64 = opposées). */
export function hamming(a: string, b: string): number {
  const [ah, al] = parts(a);
  const [bh, bl] = parts(b);
  return popcount32((ah ^ bh) >>> 0) + popcount32((al ^ bl) >>> 0);
}

export function bitCount(hash: string): number {
  const [h, l] = parts(hash);
  return popcount32(h) + popcount32(l);
}

/** Réduit une image en niveaux de gris par moyenne de blocs. */
export function boxDownscale(gray: ArrayLike<number>, w: number, h: number, tw: number, th: number): number[] {
  const out = new Array<number>(tw * th).fill(0);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += gray[y * w + x];
          n++;
        }
      }
      out[ty * tw + tx] = sum / n;
    }
  }
  return out;
}

/** dHash : on compare chaque pixel à son voisin de droite sur une image 9×8 en gris. */
export function dHash(gray: ArrayLike<number>, w: number, h: number): string {
  const small = boxDownscale(gray, w, h, 9, 8);
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const on = small[y * 9 + x] > small[y * 9 + x + 1] ? 1 : 0;
      if (bit < 32) hi = ((hi << 1) | on) >>> 0;
      else lo = ((lo << 1) | on) >>> 0;
      bit++;
    }
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/** Variance du laplacien : mesure classique de netteté (bas = flou). */
export function laplacianVariance(gray: ArrayLike<number>, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// ---------------------------------------------------------------------------
// Captures d'écran
// ---------------------------------------------------------------------------

/** Largeurs d'écran des iPhone (en pixels) : un appareil photo ne produit jamais ces tailles. */
const SCREEN_WIDTHS = new Set([640, 750, 828, 1080, 1125, 1170, 1179, 1242, 1284, 1290, 1320]);

export function isLikelyScreenshot(r: Pick<PhotoRecord, 'name' | 'type' | 'width' | 'height' | 'kind'>): boolean {
  if (r.kind !== 'image') return false;
  if (/capture|screenshot|screen ?shot/i.test(r.name)) return true;
  if (!r.width || !r.height) return false;
  const [short, long] = r.width <= r.height ? [r.width, r.height] : [r.height, r.width];
  const ratio = long / short;
  const iphoneShaped = ratio > 1.7 && ratio < 2.3;
  return iphoneShaped && SCREEN_WIDTHS.has(short) && (r.type === 'image/png' || r.type === '');
}

// ---------------------------------------------------------------------------
// Groupes
// ---------------------------------------------------------------------------

export type GroupKind = 'duplicate' | 'similar' | 'burst';

export interface PhotoGroup {
  id: string;
  kind: GroupKind;
  items: PhotoRecord[];
  /** La meilleure à garder. */
  keepId: string;
  /** Espace récupérable en supprimant tout sauf la meilleure. */
  reclaim: number;
}

/** Meilleure du lot : la plus nette, puis la plus grande, puis la plus lourde. */
export function pickBest(items: PhotoRecord[]): PhotoRecord {
  return [...items].sort(
    (a, b) =>
      (b.blur ?? 0) - (a.blur ?? 0) ||
      (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) ||
      b.size - a.size ||
      a.id.localeCompare(b.id),
  )[0];
}

function makeGroup(kind: GroupKind, items: PhotoRecord[], seed: string): PhotoGroup {
  const best = pickBest(items);
  return {
    id: `${kind}:${seed}`,
    kind,
    items: [...items].sort((a, b) => (a.taken ?? 0) - (b.taken ?? 0) || a.name.localeCompare(b.name)),
    keepId: best.id,
    reclaim: items.filter((i) => i.id !== best.id).reduce((s, i) => s + i.size, 0),
  };
}

export function findExactDuplicates(records: PhotoRecord[]): PhotoGroup[] {
  const bySha = new Map<string, PhotoRecord[]>();
  for (const r of records) {
    if (!r.sha) continue;
    const list = bySha.get(r.sha) ?? [];
    list.push(r);
    bySha.set(r.sha, list);
  }
  return [...bySha.entries()].filter(([, l]) => l.length > 1).map(([sha, l]) => makeGroup('duplicate', l, sha.slice(0, 12)));
}

/** Une empreinte « plate » (image presque uniforme) ressemble à toutes les autres : on l'écarte. */
export function hasUsefulHash(hash?: string): hash is string {
  if (!hash) return false;
  const ones = bitCount(hash);
  return ones >= 8 && ones <= 56;
}

/** Regroupe les photos dont les empreintes sont proches (union-find). */
export function findSimilar(records: PhotoRecord[], maxDistance = SIMILAR_DISTANCE): PhotoRecord[][] {
  const pool = records.filter((r) => hasUsefulHash(r.phash));
  const parent = pool.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const hp = pool.map((r) => parts(r.phash!));
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const d = popcount32((hp[i][0] ^ hp[j][0]) >>> 0) + popcount32((hp[i][1] ^ hp[j][1]) >>> 0);
      if (d <= maxDistance) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, PhotoRecord[]>();
  pool.forEach((r, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(r);
    groups.set(root, list);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

export function isBurst(items: PhotoRecord[]): boolean {
  if (items.length < 3) return false;
  const times = items.map((i) => i.taken);
  if (times.some((t) => t === undefined)) return false;
  const ts = times as number[];
  return Math.max(...ts) - Math.min(...ts) <= BURST_SPAN_MS;
}

export interface Findings {
  duplicates: PhotoGroup[];
  similar: PhotoGroup[];
  bursts: PhotoGroup[];
  blurry: PhotoRecord[];
  screenshots: PhotoRecord[];
  bigVideos: PhotoRecord[];
  /** Éléments proposés à la suppression (sans doublon de comptage). */
  candidates: Set<string>;
  reclaimable: number;
}

export interface AnalyzeOptions {
  similarDistance?: number;
  blurThreshold?: number;
  bigVideoBytes?: number;
}

export function analyzeCollection(all: PhotoRecord[], opts: AnalyzeOptions = {}): Findings {
  const { similarDistance = SIMILAR_DISTANCE, blurThreshold = BLUR_THRESHOLD, bigVideoBytes = BIG_VIDEO_BYTES } = opts;
  const active = all.filter((r) => !r.removed);
  const candidates = new Set<string>();

  const duplicates = findExactDuplicates(active);
  const excluded = new Set<string>(); // non-gardées des doublons exacts : écartées du reste de l'analyse
  for (const g of duplicates) {
    for (const i of g.items) if (i.id !== g.keepId) (candidates.add(i.id), excluded.add(i.id));
  }

  const screenshots = active.filter((r) => isLikelyScreenshot(r) && !excluded.has(r.id));
  const shotIds = new Set(screenshots.map((r) => r.id));
  for (const s of screenshots) candidates.add(s.id);

  const pool = active.filter((r) => r.kind === 'image' && !excluded.has(r.id) && !shotIds.has(r.id));
  const similar: PhotoGroup[] = [];
  const bursts: PhotoGroup[] = [];
  for (const items of findSimilar(pool, similarDistance)) {
    const seed = items.map((i) => i.id).sort()[0];
    const g = makeGroup(isBurst(items) ? 'burst' : 'similar', items, seed.slice(-12));
    (g.kind === 'burst' ? bursts : similar).push(g);
    for (const i of g.items) if (i.id !== g.keepId) candidates.add(i.id);
  }

  const blurry = pool.filter((r) => r.blur !== undefined && r.blur < blurThreshold && !candidates.has(r.id));
  for (const b of blurry) candidates.add(b.id);

  const bigVideos = active
    .filter((r) => r.kind === 'video' && r.size >= bigVideoBytes)
    .sort((a, b) => b.size - a.size);

  const bySize = new Map(all.map((r) => [r.id, r.size]));
  let reclaimable = 0;
  for (const id of candidates) reclaimable += bySize.get(id) ?? 0;

  const byReclaim = (a: PhotoGroup, b: PhotoGroup) => b.reclaim - a.reclaim;
  duplicates.sort(byReclaim);
  similar.sort(byReclaim);
  bursts.sort(byReclaim);
  blurry.sort((a, b) => b.size - a.size);
  screenshots.sort((a, b) => b.size - a.size);

  return { duplicates, similar, bursts, blurry, screenshots, bigVideos, candidates, reclaimable };
}
