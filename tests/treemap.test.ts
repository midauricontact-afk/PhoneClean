import { describe, expect, it } from 'vitest';
import { groupSmall, squarify, type TreemapItem } from '../src/core/treemap';

const items: TreemapItem[] = [
  { id: 'a', value: 600 },
  { id: 'b', value: 300 },
  { id: 'c', value: 100 },
  { id: 'd', value: 50 },
  { id: 'e', value: 25 },
  { id: 'zero', value: 0 },
];

describe('treemap', () => {
  const rects = squarify(items, 100, 60);

  it('donne à chaque élément une surface proportionnelle à sa valeur', () => {
    const total = items.reduce((s, i) => s + i.value, 0);
    expect(rects.map((r) => r.id)).not.toContain('zero');
    for (const r of rects) {
      expect((r.w * r.h) / (100 * 60)).toBeCloseTo(r.value / total, 6);
    }
  });

  it('remplit exactement le cadre, sans sortir ni se chevaucher', () => {
    expect(rects.reduce((s, r) => s + r.w * r.h, 0)).toBeCloseTo(6000, 4);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(60 + 1e-9);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
    }
  });

  it('gère les cas vides', () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([{ id: 'x', value: 0 }], 100, 100)).toEqual([]);
    expect(squarify([{ id: 'x', value: 5 }], 0, 100)).toEqual([]);
    expect(squarify([{ id: 'x', value: 5 }], 40, 30)).toEqual([{ id: 'x', value: 5, x: 0, y: 0, w: 40, h: 30 }]);
  });

  it('regroupe les petits éléments dans « Autres »', () => {
    const out = groupSmall(items, 0.05, (_rest, value) => ({ id: 'other', value }));
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c', 'other']);
    expect(out[3].value).toBe(75);
  });
});
