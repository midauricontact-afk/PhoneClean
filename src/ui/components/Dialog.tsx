import type { DialogRequest } from '../uiContext';

/** Boîte de confirmation façon alerte iOS. */
export function Dialog({ req, onResult }: { req: DialogRequest; onResult: (id: string | null) => void }) {
  return (
    <div className="dialog-backdrop" onClick={() => onResult(null)}>
      <div className="dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-text">
          <h3>{req.title}</h3>
          {req.message && <p>{req.message}</p>}
        </div>
        <div className={`dialog-actions${req.actions.length > 2 ? ' stacked' : ''}`}>
          {req.actions.map((a) => (
            <button
              key={a.id}
              className={`dialog-btn ${a.style ?? 'default'}`}
              onClick={() => onResult(a.style === 'cancel' ? null : a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
