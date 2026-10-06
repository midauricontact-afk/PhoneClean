import { useMemo } from 'react';
import { formatBytes } from '../../core/bytes';
import { squarify } from '../../core/treemap';

export interface MapItem {
  id: string;
  label: string;
  value: number;
  color: string;
  sub?: string;
}

const W = 100;
const H = 92;

/** Carte proportionnelle façon TreeSize : la surface d'un bloc est proportionnelle à sa taille. */
export function Treemap({
  items,
  onSelect,
  total,
  emptyText = 'Rien à afficher',
}: {
  items: MapItem[];
  onSelect?: (id: string) => void;
  /** Base du pourcentage affiché (par défaut la somme des blocs). */
  total?: number;
  emptyText?: string;
}) {
  const rects = useMemo(() => squarify(items, W, H), [items]);
  const base = total ?? items.reduce((s, i) => s + i.value, 0);
  if (!rects.length) return <div className="treemap empty-map">{emptyText}</div>;

  return (
    <div className="treemap" role="list" style={{ aspectRatio: `${W} / ${H}` }}>
      {rects.map((r) => {
        const big = r.w >= 22 && r.h >= 16;
        const medium = r.w >= 12 && r.h >= 9;
        const pct = base ? Math.round((r.value / base) * 100) : 0;
        return (
          <button
            key={r.id}
            role="listitem"
            className="tm-cell"
            style={{
              left: `${(r.x / W) * 100}%`,
              top: `${(r.y / H) * 100}%`,
              width: `${(r.w / W) * 100}%`,
              height: `${(r.h / H) * 100}%`,
              background: r.color,
            }}
            title={`${r.label} · ${formatBytes(r.value)}`}
            aria-label={`${r.label}, ${formatBytes(r.value)}`}
            onClick={() => onSelect?.(r.id)}
          >
            {medium && (
              <span className={`tm-label${big ? ' big' : ''}`}>
                <b>{r.label}</b>
                <span>{formatBytes(r.value)}</span>
                {big && pct > 0 && <span>{pct < 1 ? '<1' : pct} %</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
