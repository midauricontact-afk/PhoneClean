import { useEffect, useMemo, useState } from 'react';
import { MAILSORT_URL } from '../../config';
import { formatBytes, formatDate, formatDateTime } from '../../core/bytes';
import {
  DRIVE_TYPES,
  ROOT,
  TYPE_BY_ID,
  biggest,
  buildIndex,
  childrenOf,
  findDriveDuplicates,
  isFolder,
  oldFiles,
  otherUsage,
  pathName,
  pathOf,
  sizeOfSelection,
  topLevel,
  typeOf,
  typeTotals,
  type DriveFile,
  type DriveType,
} from '../../core/driveAnalysis';
import {
  connectDrive,
  connectDriveWithRedirect,
  driveStore,
  emptyDriveTrash,
  prepareDrive,
  reconnectDrive,
  scanDrive,
  setDriveClientId,
  signOutDrive,
  startDriveDemo,
  trashDriveFiles,
} from '../../state/drive';
import { Disclosure, Note, Progress, UsageBar } from '../components/Bits';
import { EmptyState } from '../components/EmptyState';
import { Treemap, type MapItem } from '../components/Treemap';
import { confirmDestructive, useUI } from '../uiContext';

type View = 'folders' | 'types' | 'big' | 'dups' | 'old' | 'trash';
const VIEWS: { id: View; label: string }[] = [
  { id: 'folders', label: 'Dossiers' },
  { id: 'types', label: 'Types' },
  { id: 'big', label: 'Gros fichiers' },
  { id: 'dups', label: 'Doublons' },
  { id: 'old', label: 'Vieux' },
  { id: 'trash', label: 'Corbeille' },
];

/** Onglet « Drive » : analyse complète de Google Drive et mise à la corbeille en masse. */
export function DriveScreen() {
  const d = driveStore.use();
  const ui = useUI();
  const [view, setView] = useState<View>('folders');
  const [folder, setFolder] = useState<string>(ROOT);
  const [typeFilter, setTypeFilter] = useState<DriveType | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [months, setMonths] = useState(12);
  const [minMB, setMinMB] = useState(10);
  const [clientId, setClientId] = useState('');
  const [idError, setIdError] = useState('');

  useEffect(() => {
    if (d.phase === 'signedOut') prepareDrive();
  }, [d.phase]);

  const index = useMemo(() => buildIndex(d.files), [d.files]);
  const dups = useMemo(() => findDriveDuplicates(d.files), [d.files]);
  const types = useMemo(() => typeTotals(d.files), [d.files]);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Une sélection ne survit pas à un changement de liste (fichiers déjà mis à la corbeille).
  useEffect(() => {
    setSelected((s) => new Set([...s].filter((id) => index.byId.has(id))));
  }, [index]);

  if (d.phase === 'loading') return <div className="splash-inline" aria-busy="true" />;

  if (d.phase !== 'ready') {
    return (
      <>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Nettoyer ton Google Drive</h3>
          <p className="muted">
            Carte de tes dossiers, plus gros fichiers, doublons exacts et vieux fichiers. Les fichiers vont à la corbeille Drive
            (jamais supprimés d’un coup), et tu peux la vider ensuite.
          </p>
          <p className="muted small">La connexion se fait directement entre ton téléphone et Google : aucun serveur PhoneClean n’existe.</p>
        </div>

        {d.phase === 'needsClientId' ? (
          <div className="card">
            <strong>Configuration</strong>
            <p className="muted small">
              L’identifiant client Google n’est pas configuré (fichier <code>.env</code>). Colle-le ici : il finit par{' '}
              <code>.apps.googleusercontent.com</code>.
            </p>
            <input className="text-input" value={clientId} onChange={(e) => { setClientId(e.target.value); setIdError(''); }} placeholder="123456-abc.apps.googleusercontent.com" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            {idError && <p className="error small">{idError}</p>}
            <button className="btn primary block" onClick={() => !setDriveClientId(clientId) && setIdError('Identifiant invalide : il doit finir par .apps.googleusercontent.com')}>
              Enregistrer
            </button>
          </div>
        ) : (
          <>
            <button className="btn google block" onClick={() => void connectDrive()}>
              Se connecter avec Google
            </button>
            <button className="btn link small" onClick={connectDriveWithRedirect}>
              La fenêtre Google ne s’ouvre pas ? Connexion par redirection
            </button>
          </>
        )}
        <button className="btn ghost block" onClick={() => void startDriveDemo()}>
          Essayer avec un faux Drive de démonstration
        </button>
        <Note>
          Google demandera l’accès à ton Drive (« Voir, modifier, créer et supprimer tous tes fichiers Google Drive ») : c’est
          nécessaire pour mettre à la corbeille des fichiers que PhoneClean n’a pas créés.
        </Note>
      </>
    );
  }

  const q = d.quota;
  const busy = !!d.busy;
  const selSize = sizeOfSelection(index, selected);

  const trashSelected = async () => {
    const ids = topLevel(index, selected);
    if (!ids.length) return;
    const ok = await confirmDestructive(
      ui,
      `Mettre ${ids.length} élément${ids.length > 1 ? 's' : ''} à la corbeille ?`,
      `Environ ${formatBytes(selSize)} iront dans la corbeille de Google Drive (les dossiers avec tout leur contenu).\n\nRien n’est supprimé définitivement : tu peux tout restaurer depuis la corbeille Drive. L’espace n’est libéré que lorsque la corbeille est vidée.`,
      'Mettre à la corbeille',
    );
    if (!ok) return;
    await trashDriveFiles(ids);
    setSelected(new Set());
  };

  const emptyTrash = async () => {
    const size = q?.usageInTrash ?? 0;
    const first = await confirmDestructive(
      ui,
      'Vider la corbeille Drive ?',
      `Tout ce qui est dans la corbeille de Google Drive (environ ${formatBytes(size)}) sera supprimé pour de bon.`,
      'Continuer',
    );
    if (!first) return;
    const second = await confirmDestructive(
      ui,
      'Dernière confirmation',
      'Cette action est IRRÉVERSIBLE : les fichiers de la corbeille ne pourront plus jamais être récupérés.',
      'Supprimer définitivement',
    );
    if (second) await emptyDriveTrash();
  };

  const selectAll = (ids: string[]) => setSelected((s) => new Set([...s, ...ids]));

  const rows = (files: DriveFile[], opts: { path?: boolean } = {}) => (
    <div className="list">
      {files.slice(0, 150).map((f) => (
        <label key={f.id} className="row check-row">
          <input type="checkbox" className="check" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
          <div className="row-main">
            <div className="row-title ellipsis">
              {isFolder(f) ? '📁 ' : ''}
              {f.name}
            </div>
            <div className="row-sub ellipsis">
              {opts.path ? `${pathName(index, f)} · ` : ''}
              {formatDate(f.modified)}
            </div>
          </div>
          <strong className="nowrap">{formatBytes(isFolder(f) ? (index.folders.get(f.id)?.size ?? 0) : f.size)}</strong>
        </label>
      ))}
      {files.length > 150 && <p className="muted small" style={{ padding: 12 }}>Les 150 premiers sur {files.length.toLocaleString('fr-FR')}, du plus lourd au plus léger.</p>}
    </div>
  );

  const current = folder === ROOT ? undefined : index.byId.get(folder);
  const entries = childrenOf(index, folder);
  const trail = folder === ROOT ? [] : pathOf(index, folder);
  const typeFiles = typeFilter ? d.files.filter((f) => !isFolder(f) && typeOf(f) === typeFilter).sort((a, b) => b.size - a.size) : [];

  const folderItems: MapItem[] = entries.map((e) => ({
    id: e.id,
    label: e.name,
    value: e.size,
    color: e.isFolder ? '#6366f1' : TYPE_BY_ID[typeOf(e.file)].color,
  }));
  const typeItems: MapItem[] = types.map((t) => ({ id: t.type, label: TYPE_BY_ID[t.type].label, value: t.size, color: TYPE_BY_ID[t.type].color }));

  const old = oldFiles(d.files, months, minMB * 1e6);
  const dupExtras = dups.flatMap((g) => g.files.filter((f) => f.id !== g.keepId).map((f) => f.id));

  return (
    <>
      {d.needsReconnect && !d.demo && (
        <button className="reconnect" onClick={() => void reconnectDrive()}>
          Session Google expirée · <strong>Toucher pour reconnecter</strong>
        </button>
      )}

      {q && (
        <div className="card">
          <div className="spread">
            <strong>{q.limit ? `${formatBytes(q.usage)} sur ${formatBytes(q.limit)}` : `${formatBytes(q.usage)} utilisés`}</strong>
            <span className="muted small">{d.email}</span>
          </div>
          <UsageBar
            used={q.usage}
            total={q.limit}
            segments={[
              { value: Math.max(0, q.usageInDrive - q.usageInTrash), color: '#6366f1', label: 'Drive' },
              { value: q.usageInTrash, color: '#ef4444', label: 'Corbeille Drive' },
              { value: otherUsage(q), color: '#10b981', label: 'Gmail et Photos' },
            ]}
          />
          <ul className="legend">
            <li><i style={{ background: '#6366f1' }} /> Drive {formatBytes(Math.max(0, q.usageInDrive - q.usageInTrash))}</li>
            <li><i style={{ background: '#ef4444' }} /> Corbeille {formatBytes(q.usageInTrash)}</li>
            <li><i style={{ background: '#10b981' }} /> Gmail et Photos {formatBytes(otherUsage(q))}</li>
          </ul>
          <p className="muted small">
            Ce quota est partagé entre Drive, Gmail et Google Photos.{' '}
            <a href={MAILSORT_URL} target="_blank" rel="noopener">
              Faire le ménage de Gmail avec MailSort ›
            </a>
          </p>
        </div>
      )}

      {d.busy ? (
        <div className="card" role="status">
          <strong>{d.busy.label}</strong>
          <Progress done={d.busy.done} total={d.busy.total} />
        </div>
      ) : (
        <div className="spread" style={{ marginBottom: 12 }}>
          <span className="muted small">
            {d.demo ? 'Démo · ' : ''}
            {d.scannedAt ? `${d.files.length.toLocaleString('fr-FR')} éléments · analysé le ${formatDateTime(d.scannedAt)}` : 'Pas encore analysé'}
          </span>
          <button className="btn small" onClick={() => void scanDrive()}>
            {d.scannedAt ? 'Réanalyser' : 'Analyser mon Drive'}
          </button>
        </div>
      )}

      {d.files.length === 0 ? (
        !d.busy && <EmptyState emoji="☁️" text="Lance l’analyse pour voir ce qui prend de la place dans ton Drive." />
      ) : (
        <>
          <div className="chips" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={`chip${view === v.id ? ' active' : ''}`} onClick={() => setView(v.id)}>
                {v.label}
                {v.id === 'dups' && dups.length > 0 && <span className="chip-count">{dups.length}</span>}
              </button>
            ))}
          </div>

          {view === 'folders' && (
            <>
              <div className="crumbs">
                <button onClick={() => setFolder(ROOT)} className={!current ? 'on' : ''}>Mon Drive</button>
                {trail.map((f) => (
                  <span key={f.id}>
                    {' › '}
                    <button onClick={() => setFolder(f.id)} className={f.id === folder ? 'on' : ''}>{f.name}</button>
                  </span>
                ))}
              </div>
              <Treemap
                items={folderItems}
                total={entries.reduce((s, e) => s + e.size, 0)}
                emptyText="Ce dossier est vide ou ne contient que des Google Docs (qui ne comptent pas)."
                onSelect={(id) => {
                  const e = entries.find((x) => x.id === id);
                  if (e?.isFolder) setFolder(id);
                  else toggle(id);
                }}
              />
              <p className="hint">Touche un dossier de la carte pour entrer dedans ; coche dans la liste ce que tu veux mettre à la corbeille.</p>
              {rows(entries.map((e) => e.file))}
            </>
          )}

          {view === 'types' && (
            <>
              <Treemap items={typeItems} onSelect={(id) => setTypeFilter(typeFilter === id ? null : (id as DriveType))} />
              <div className="chips" style={{ marginTop: 12 }}>
                {DRIVE_TYPES.filter((t) => types.some((x) => x.type === t.id)).map((t) => {
                  const x = types.find((y) => y.type === t.id)!;
                  return (
                    <button key={t.id} className={`chip${typeFilter === t.id ? ' active' : ''}`} style={{ ['--cat' as string]: t.color }} onClick={() => setTypeFilter(typeFilter === t.id ? null : t.id)}>
                      <span className="dot-color" style={{ background: t.color }} /> {t.label} · {formatBytes(x.size)}
                    </button>
                  );
                })}
              </div>
              {typeFilter ? rows(typeFiles, { path: true }) : <p className="hint">Touche un type pour voir ses fichiers, du plus lourd au plus léger.</p>}
            </>
          )}

          {view === 'big' && (
            <>
              <p className="hint">Tes 150 plus gros fichiers.</p>
              {rows(biggest(d.files, 150), { path: true })}
            </>
          )}

          {view === 'dups' && (
            <>
              <Note>Doublons exacts : Google compare l’empreinte (MD5) de chaque fichier. Le plus ancien est conservé.</Note>
              {dups.length > 0 && (
                <button className="btn ghost block" onClick={() => selectAll(dupExtras)}>
                  Cocher tous les doublons ({formatBytes(dups.reduce((s, g) => s + g.reclaim, 0))})
                </button>
              )}
              {dups.slice(0, 40).map((g) => (
                <article key={g.md5} className="card group">
                  <div className="spread">
                    <strong>{g.files.length} copies</strong>
                    <span className="muted small">{formatBytes(g.reclaim)} récupérables</span>
                  </div>
                  <div className="list compact">
                    {g.files.map((f) => (
                      <label key={f.id} className="row check-row">
                        <input type="checkbox" className="check" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                        <div className="row-main">
                          <div className="row-title ellipsis">{f.name}</div>
                          <div className="row-sub ellipsis">{pathName(index, f)} · {formatDate(f.modified)}</div>
                        </div>
                        {f.id === g.keepId ? <span className="badge green">À garder</span> : <strong>{formatBytes(f.size)}</strong>}
                      </label>
                    ))}
                  </div>
                </article>
              ))}
              {dups.length === 0 && <EmptyState emoji="✨" text="Aucun doublon exact trouvé." />}
            </>
          )}

          {view === 'old' && (
            <>
              <div className="toolbar">
                <label className="inline-select">
                  Modifiés il y a plus de
                  <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                    {[6, 12, 24, 36, 60].map((m) => (
                      <option key={m} value={m}>{m >= 12 ? `${m / 12} an${m > 12 ? 's' : ''}` : `${m} mois`}</option>
                    ))}
                  </select>
                </label>
                <label className="inline-select">
                  et d’au moins
                  <select value={minMB} onChange={(e) => setMinMB(Number(e.target.value))}>
                    {[1, 10, 50, 100, 500].map((m) => (
                      <option key={m} value={m}>{m} Mo</option>
                    ))}
                  </select>
                </label>
              </div>
              {old.length > 0 && (
                <button className="btn ghost block" onClick={() => selectAll(old.map((f) => f.id))}>
                  Cocher les {old.length.toLocaleString('fr-FR')} fichiers ({formatBytes(old.reduce((s, f) => s + f.size, 0))})
                </button>
              )}
              {old.length ? rows(old, { path: true }) : <EmptyState emoji="✨" text="Aucun fichier ne correspond." />}
            </>
          )}

          {view === 'trash' && (
            <div className="card">
              <div className="big-number">{formatBytes(q?.usageInTrash ?? 0)}</div>
              <p className="muted">dans la corbeille Google Drive.</p>
              <p className="muted small">
                Les fichiers mis à la corbeille <b>comptent encore dans ton quota</b> : Drive les efface seul au bout de 30 jours.
                Vide la corbeille pour libérer la place tout de suite. <b>Cette suppression est définitive.</b>
              </p>
              <button className="btn danger block" disabled={busy || !(q?.usageInTrash ?? 0)} onClick={() => void emptyTrash()}>
                Vider la corbeille Drive
              </button>
            </div>
          )}

          {selected.size > 0 && (
            <div className="actionbar">
              <div>
                <strong>{topLevel(index, selected).length.toLocaleString('fr-FR')} sélectionnés</strong>
                <span className="muted small block">{formatBytes(selSize)}</span>
              </div>
              <div className="actionbar-btns">
                <button className="btn ghost" onClick={() => setSelected(new Set())}>Annuler</button>
                <button className="btn danger" disabled={busy} onClick={() => void trashSelected()}>Corbeille</button>
              </div>
            </div>
          )}
        </>
      )}

      <Disclosure title="À propos des autorisations">
        <p className="muted small">
          PhoneClean utilise l’accès complet à Drive uniquement pour lire la liste de tes fichiers (noms, tailles, dossiers) et pour
          mettre à la corbeille ce que tu coches. Le contenu de tes fichiers n’est jamais lu. Tu peux retirer l’accès à tout moment
          sur myaccount.google.com › Sécurité › Applications tierces.
        </p>
        <button className="btn small ghost" onClick={() => void signOutDrive()}>
          {d.demo ? 'Quitter la démo' : 'Se déconnecter de Google'}
        </button>
      </Disclosure>
    </>
  );
}
