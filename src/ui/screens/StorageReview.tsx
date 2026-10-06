import { useState } from 'react';
import { formatBytes, parseSizeInput } from '../../core/bytes';
import type { ParsedStorage } from '../../core/ocrParse';
import { Sheet } from '../components/Sheet';
import { Disclosure, Note } from '../components/Bits';
import { IconClose } from '../icons';

interface Row {
  key: number;
  name: string;
  size: string;
  lastUsed?: string;
}

export interface Draft {
  parsed: ParsedStorage;
  texts: string[];
}

export interface ReviewResult {
  apps: { name: string; bytes: number; lastUsed?: string }[];
  usedBytes?: number;
  totalBytes?: number;
}

let keySeq = 0;

/** Vérification des valeurs lues par l'OCR : on corrige à la main ce qui est faux avant d'enregistrer. */
export function StorageReview({ draft, onSave, onClose }: { draft: Draft; onSave: (r: ReviewResult) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() =>
    draft.parsed.apps.map((a) => ({ key: ++keySeq, name: a.name, size: formatBytes(a.bytes), lastUsed: a.lastUsed })),
  );
  const [used, setUsed] = useState(draft.parsed.usedBytes ? formatBytes(draft.parsed.usedBytes) : '');
  const [total, setTotal] = useState(draft.parsed.totalBytes ? formatBytes(draft.parsed.totalBytes) : '');

  const parsedRows = rows.map((r) => ({ ...r, bytes: parseSizeInput(r.size) }));
  const invalid = parsedRows.filter((r) => r.name.trim() && r.bytes === null);
  const valid = parsedRows.filter((r) => r.name.trim() && r.bytes !== null && r.bytes > 0);
  const usedBytes = used.trim() ? parseSizeInput(used) : null;
  const totalBytes = total.trim() ? parseSizeInput(total) : null;
  const headerInvalid = (used.trim() && usedBytes === null) || (total.trim() && totalBytes === null);
  const sum = valid.reduce((s, r) => s + (r.bytes ?? 0), 0);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Sheet title="Vérifie ce qui a été lu" onClose={onClose}>
      <p className="muted small">
        L’OCR peut se tromper : compare avec ta capture et corrige les noms ou les tailles. Rien n’est enregistré tant que tu ne
        touches pas « Enregistrer ».
      </p>

      {draft.parsed.warnings.map((w) => (
        <Note key={w} tone="warn">
          {w}
        </Note>
      ))}

      <h4 className="sheet-section">Espace de l’iPhone</h4>
      <div className="field-row">
        <label>
          <span className="muted small">Utilisé</span>
          <input className={`text-input${used.trim() && usedBytes === null ? ' invalid' : ''}`} value={used} placeholder="ex. 89,4 Go" onChange={(e) => setUsed(e.target.value)} inputMode="text" />
        </label>
        <label>
          <span className="muted small">Capacité</span>
          <input className={`text-input${total.trim() && totalBytes === null ? ' invalid' : ''}`} value={total} placeholder="ex. 128 Go" onChange={(e) => setTotal(e.target.value)} inputMode="text" />
        </label>
      </div>

      <h4 className="sheet-section">
        Applications ({valid.length}) <span className="muted small">· total {formatBytes(sum)}</span>
      </h4>
      <div className="edit-list">
        {rows.map((r) => {
          const bad = r.name.trim() && parseSizeInput(r.size) === null;
          return (
            <div key={r.key} className="edit-row">
              <input className="text-input" value={r.name} aria-label="Nom de l’app" placeholder="Nom" onChange={(e) => update(r.key, { name: e.target.value })} />
              <input className={`text-input size${bad ? ' invalid' : ''}`} value={r.size} aria-label="Taille" placeholder="1,2 Go" onChange={(e) => update(r.key, { size: e.target.value })} />
              <button className="icon-btn" aria-label={`Retirer ${r.name}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <IconClose width={18} height={18} />
              </button>
            </div>
          );
        })}
      </div>
      <button className="btn small ghost" onClick={() => setRows((rs) => [...rs, { key: ++keySeq, name: '', size: '' }])}>
        + Ajouter une app
      </button>

      {draft.texts.length > 0 && (
        <Disclosure title="Voir le texte brut lu sur les captures">
          {draft.texts.map((t, i) => (
            <pre key={i} className="raw-text">
              {t.trim() || '(rien de lisible)'}
            </pre>
          ))}
        </Disclosure>
      )}

      {(invalid.length > 0 || headerInvalid) && <Note tone="warn">Certaines tailles sont illisibles (écris-les comme « 1,2 Go » ou « 450 Mo »).</Note>}

      <button
        className="btn primary block"
        style={{ marginTop: 16 }}
        disabled={valid.length === 0 || invalid.length > 0 || !!headerInvalid}
        onClick={() =>
          onSave({
            apps: valid.map((r) => ({ name: r.name.trim(), bytes: r.bytes!, lastUsed: r.lastUsed })),
            usedBytes: usedBytes ?? undefined,
            totalBytes: totalBytes ?? undefined,
          })
        }
      >
        Enregistrer cette capture
      </button>
    </Sheet>
  );
}
