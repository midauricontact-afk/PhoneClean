import { describe, expect, it } from 'vitest';
import {
  analyzeCollection,
  bitCount,
  dHash,
  hamming,
  hasUsefulHash,
  isBurst,
  isLikelyScreenshot,
  laplacianVariance,
  pickBest,
  type PhotoRecord,
} from '../src/core/imageAnalysis';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Image « photo » : grands blocs de luminosité aléatoire, lissés. */
function blocky(seed: number, w = 90, h = 80): number[] {
  const r = rng(seed);
  const cells = Array.from({ length: 9 * 8 }, () => 20 + r() * 215);
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.push(cells[Math.floor((y * 8) / h) * 9 + Math.floor((x * 9) / w)]);
  }
  return out;
}

function noisy(gray: number[], amount: number, seed: number): number[] {
  const r = rng(seed);
  return gray.map((v) => Math.max(0, Math.min(255, v + (r() - 0.5) * amount)));
}

function boxBlur(gray: number[], w: number, h: number): number[] {
  const out = [...gray];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += gray[(y + dy) * w + x + dx];
      out[y * w + x] = s / 9;
    }
  }
  return out;
}

describe('empreintes perceptuelles', () => {
  const a = dHash(blocky(1), 90, 80);

  it('produit 16 caractères hexadécimaux, identiques pour une même image', () => {
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(dHash(blocky(1), 90, 80)).toBe(a);
    expect(hamming(a, a)).toBe(0);
  });

  it('reste proche pour une version légèrement bruitée, loin pour une autre image', () => {
    const near = dHash(noisy(blocky(1), 12, 5), 90, 80);
    const far = dHash(blocky(2), 90, 80);
    expect(hamming(a, near)).toBeLessThanOrEqual(6);
    expect(hamming(a, far)).toBeGreaterThan(14);
  });

  it('compte les bits et écarte les images plates', () => {
    expect(bitCount('ffffffffffffffff')).toBe(64);
    expect(bitCount('0000000000000000')).toBe(0);
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hasUsefulHash(dHash(new Array(90 * 80).fill(128), 90, 80))).toBe(false);
    expect(hasUsefulHash(a)).toBe(true);
  });
});

describe('netteté', () => {
  it('mesure moins de netteté sur une image floutée', () => {
    const w = 120;
    const h = 120;
    const r = rng(9);
    const sharp = Array.from({ length: w * h }, () => (r() > 0.5 ? 220 : 30));
    const blurred = boxBlur(boxBlur(sharp, w, h), w, h);
    expect(laplacianVariance(sharp, w, h)).toBeGreaterThan(laplacianVariance(blurred, w, h) * 5);
    expect(laplacianVariance(new Array(w * h).fill(100), w, h)).toBe(0);
  });
});

describe('captures d’écran', () => {
  it('reconnaît le nom, ou la taille d’écran iPhone en PNG', () => {
    expect(isLikelyScreenshot({ kind: 'image', name: 'Capture d’écran 2026-01-02.png', type: 'image/png' })).toBe(true);
    expect(isLikelyScreenshot({ kind: 'image', name: 'IMG_0042.PNG', type: 'image/png', width: 1179, height: 2556 })).toBe(true);
    expect(isLikelyScreenshot({ kind: 'image', name: 'IMG_0043.JPG', type: 'image/jpeg', width: 3024, height: 4032 })).toBe(false);
    expect(isLikelyScreenshot({ kind: 'video', name: 'Capture.mov', type: 'video/quicktime' })).toBe(false);
  });
});

let seq = 0;
function rec(p: Partial<PhotoRecord>): PhotoRecord {
  const id = `p${++seq}`;
  return { id, name: `IMG_${id}.JPG`, size: 3_000_000, type: 'image/jpeg', kind: 'image', width: 3024, height: 4032, added: 0, blur: 300, ...p };
}

describe('analyse d’une collection', () => {
  const base = dHash(blocky(11), 90, 80);
  const variant = dHash(noisy(blocky(11), 14, 3), 90, 80);
  const other = dHash(blocky(12), 90, 80);

  const t0 = Date.UTC(2026, 5, 1, 12, 0, 0);
  const dupA = rec({ sha: 'aaaa1111aaaa1111', phash: other, size: 4_000_000 });
  const dupB = rec({ sha: 'aaaa1111aaaa1111', phash: other, size: 4_000_000 });
  const sim1 = rec({ phash: base, blur: 400, size: 5_000_000 });
  const sim2 = rec({ phash: variant, blur: 120, size: 4_500_000 });
  const burst = [0, 1, 2, 3].map((i) => rec({ phash: dHash(noisy(blocky(21), 10, 40 + i), 90, 80), taken: t0 + i * 1000, blur: 100 + i * 50, size: 2_000_000 }));
  const blurry = rec({ phash: dHash(blocky(31), 90, 80), blur: 20, size: 1_500_000 });
  const shot = rec({ name: 'Capture d’écran.png', type: 'image/png', width: 1179, height: 2556, size: 800_000, phash: dHash(blocky(41), 90, 80) });
  const video = rec({ kind: 'video', type: 'video/mp4', size: 500_000_000, name: 'MOV.mp4', phash: undefined, blur: undefined });
  const smallVideo = rec({ kind: 'video', type: 'video/mp4', size: 5_000_000, name: 'petit.mp4', phash: undefined, blur: undefined });
  const all = [dupA, dupB, sim1, sim2, ...burst, blurry, shot, video, smallVideo];
  const f = analyzeCollection(all);

  it('trouve les doublons exacts et garde un exemplaire', () => {
    expect(f.duplicates).toHaveLength(1);
    expect(f.duplicates[0].items).toHaveLength(2);
    expect(f.duplicates[0].reclaim).toBe(4_000_000);
  });

  it('trouve les photos similaires et propose de garder la plus nette', () => {
    expect(f.similar).toHaveLength(1);
    expect(f.similar[0].keepId).toBe(sim1.id);
    expect(f.similar[0].reclaim).toBe(4_500_000);
  });

  it('distingue les rafales (même scène, quelques secondes)', () => {
    expect(f.bursts).toHaveLength(1);
    expect(f.bursts[0].items).toHaveLength(4);
    expect(f.bursts[0].keepId).toBe(burst[3].id); // la plus nette
    expect(f.bursts[0].reclaim).toBe(6_000_000);
    expect(isBurst(burst)).toBe(true);
    expect(isBurst([sim1, sim2])).toBe(false);
  });

  it('liste les photos floues, les captures et les grosses vidéos', () => {
    expect(f.blurry.map((r) => r.id)).toEqual([blurry.id]);
    expect(f.screenshots.map((r) => r.id)).toEqual([shot.id]);
    expect(f.bigVideos.map((r) => r.id)).toEqual([video.id]);
  });

  it('ne compte aucun élément deux fois dans l’espace récupérable', () => {
    const expected = 4_000_000 + 4_500_000 + 6_000_000 + 1_500_000 + 800_000;
    expect(f.reclaimable).toBe(expected);
    expect(f.candidates.has(video.id)).toBe(false); // les vidéos ne sont jamais proposées d'office
    expect(f.candidates.has(sim1.id)).toBe(false); // la meilleure est gardée
  });

  it('ignore ce que tu as déclaré supprimé', () => {
    const f2 = analyzeCollection(all.map((r) => (r.id === dupB.id ? { ...r, removed: true } : r)));
    expect(f2.duplicates).toHaveLength(0);
    expect(f2.reclaimable).toBe(f.reclaimable - 4_000_000);
  });

  it('choisit la meilleure : netteté, puis résolution, puis poids', () => {
    expect(pickBest([rec({ blur: 50 }), rec({ blur: 90, width: 100, height: 100 })]).blur).toBe(90);
    const big = rec({ blur: 90, width: 4000, height: 3000 });
    expect(pickBest([rec({ blur: 90, width: 100, height: 100 }), big]).id).toBe(big.id);
  });
});
