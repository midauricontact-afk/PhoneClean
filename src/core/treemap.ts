export interface TreemapItem {
  id: string;
  value: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TreemapRect<T extends TreemapItem> = T & Rect;

function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Carte proportionnelle « squarified » (Bruls et al.) : chaque élément reçoit un rectangle
 * dont la surface est proportionnelle à sa valeur, en restant le plus carré possible.
 * Les coordonnées sont dans [0, width] × [0, height].
 */
export function squarify<T extends TreemapItem>(items: T[], width: number, height: number): TreemapRect<T>[] {
  const data = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((s, i) => s + i.value, 0);
  if (!total || width <= 0 || height <= 0) return [];

  const scale = (width * height) / total;
  const queue = data.map((item) => ({ item, area: item.value * scale }));
  const out: TreemapRect<T>[] = [];
  let x = 0;
  let y = 0;
  let rw = width;
  let rh = height;
  let i = 0;

  while (i < queue.length) {
    const side = Math.min(rw, rh);
    let row = [queue[i++]];
    while (i < queue.length) {
      const candidate = [...row, queue[i]];
      if (worst(candidate.map((r) => r.area), side) <= worst(row.map((r) => r.area), side)) {
        row = candidate;
        i++;
      } else break;
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0);
    if (rw >= rh) {
      // Colonne à gauche, de hauteur rh.
      const colW = rowArea / rh;
      let cy = y;
      for (const r of row) {
        const hh = r.area / colW;
        out.push({ ...r.item, x, y: cy, w: colW, h: hh });
        cy += hh;
      }
      x += colW;
      rw -= colW;
    } else {
      // Rangée en haut, de largeur rw.
      const rowH = rowArea / rw;
      let cx = x;
      for (const r of row) {
        const ww = r.area / rowH;
        out.push({ ...r.item, x: cx, y, w: ww, h: rowH });
        cx += ww;
      }
      y += rowH;
      rh -= rowH;
    }
  }
  return out;
}

/** Regroupe les très petits éléments dans un bloc « Autres » pour garder une carte lisible. */
export function groupSmall<T extends TreemapItem>(
  items: T[],
  minRatio: number,
  make: (rest: T[], value: number) => T,
  maxItems = 40,
): T[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return [];
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const keep: T[] = [];
  const rest: T[] = [];
  for (const it of sorted) {
    if (keep.length < maxItems && it.value / total >= minRatio) keep.push(it);
    else rest.push(it);
  }
  if (rest.length === 1) return [...keep, rest[0]];
  if (rest.length > 1) keep.push(make(rest, rest.reduce((s, i) => s + i.value, 0)));
  return keep;
}
