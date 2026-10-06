import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconClose } from '../icons';

/** Feuille qui monte du bas de l'écran (fermeture : bouton, fond, ou glisser vers le bas). */
export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: dy ? 'none' : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sheet-grabber-zone"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            start.current = e.clientY;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current !== null) setDy(Math.max(0, e.clientY - start.current));
          }}
          onPointerUp={() => {
            start.current = null;
            if (dy > 120) onClose();
            setDy(0);
          }}
        >
          <div className="sheet-grabber" />
          <div className="sheet-header">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Fermer">
              <IconClose width={20} height={20} />
            </button>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
