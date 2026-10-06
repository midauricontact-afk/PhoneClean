import { useMemo, useRef, useState } from 'react';
import { formatBytes, formatDate, formatDateTime } from '../../core/bytes';
import { APP_CATEGORIES, CATEGORY_BY_ID, categoryOf, type AppCategory } from '../../core/catalog';
import { staleness } from '../../core/ocrParse';
import { diffSnapshots, usedOf, type Snapshot } from '../../core/snapshots';
import { groupSmall } from '../../core/treemap';
import { readScreenshots } from '../../ocr/ocrClient';
import { appStore, removeSnapshot, saveSnapshot, toast } from '../../state/app';
import { Disclosure, Note, Progress, UsageBar } from '../components/Bits';
import { EmptyState } from '../components/EmptyState';
import { Sheet } from '../components/Sheet';
import { Treemap, type MapItem } from '../components/Treemap';
import { IconUpload } from '../icons';
import { confirmDestructive, useUI } from '../uiContext';
import { StorageReview, type Draft, type ReviewResult } from './StorageReview';

const STALE_LABEL = { never: 'Jamais utilisée', old: 'Inutilisée depuis longtemps', recent: 'Utilisée récemment' } as const;

/** Onglet « Stockage » : importer des captures, voir la carte, suivre l'évolution. */
export function StorageScreen() {
  const app = appStore.use();
  const ui = useUI();
  const snaps = app.snapshots;
  const latest = snaps[snaps.length - 1];
  const previous = snaps[snaps.length - 2];
  const [view, setView] = useState<'map' | 'list'>('map');
  const [filter, setFilter] = useState<AppCategory | null>(null);
  const [reading, setReading] = useState<{ label: string; ratio: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    setReading({ label: 'Préparation de la lecture…', ratio: 0 });
    try {
      const { results, merged } = await readScreenshots(files, (p) => setReading({ label: p.label, ratio: (p.index + p.ratio) / p.total }));
      setDraft({ parsed: merged, texts: results.map((r) => r.text), images: files.map((f) => URL.createObjectURL(f)) });
    } catch (e) {
      toast(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setReading(null);
    }
  };

  const closeDraft = () => {
    draft?.images.forEach((u) => URL.revokeObjectURL(u));
    setDraft(null);
  };

  const save = async (r: ReviewResult) => {
    const before = latest;
    const snap = await saveSnapshot(r);
    closeDraft();
    if (before) {
      const d = diffSnapshots(before, snap);
      toast(d.gained > 0 ? `Bravo : ${formatBytes(d.gained)} gagnés depuis ta dernière capture` : 'Capture enregistrée', 'ok');
    } else {
      toast('Première capture enregistrée. Refais-en une après ton nettoyage pour voir l’espace gagné.', 'ok');
    }
  };

  const apps = latest?.apps ?? [];
  const catOf = (name: string) => categoryOf(name);
  const listed = apps.reduce((s, a) => s + a.bytes, 0);
  const unlisted = latest?.usedBytes ? Math.max(0, latest.usedBytes - listed) : 0;

  const categoryTotals = useMemo(() => {
    const m = new Map<AppCategory, number>();
    for (const a of apps) m.set(catOf(a.name), (m.get(catOf(a.name)) ?? 0) + a.bytes);
    return m;
  }, [latest]);

  const items = useMemo<MapItem[]>(() => {
    const base: MapItem[] = apps
      .filter((a) => !filter || catOf(a.name) === filter)
      .map((a) => ({ id: a.name, label: a.name, value: a.bytes, color: CATEGORY_BY_ID[catOf(a.name)].color }));
    const grouped = groupSmall(base, 0.015, (rest, value) => ({ id: '__other', label: `${rest.length} autres apps`, value, color: '#9ca3af' }), 30);
    if (!filter && latest?.usedBytes && unlisted > latest.usedBytes * 0.03) {
      grouped.push({ id: '__unlisted', label: 'Non détecté', value: unlisted, color: '#c7c7cc', sub: 'Données système ou apps non lues' });
    }
    return grouped;
  }, [latest, filter]);

  const segments = latest
    ? [
        ...APP_CATEGORIES.filter((c) => categoryTotals.has(c.id)).map((c) => ({ value: categoryTotals.get(c.id)!, color: c.color, label: c.label })),
        ...(unlisted > 0 ? [{ value: unlisted, color: '#c7c7cc', label: 'Non détecté' }] : []),
      ]
    : [];

  const removeSnap = async (s: Snapshot) => {
    if (await confirmDestructive(ui, 'Supprimer cette capture ?', `La capture du ${formatDate(s.date)} sera retirée de l’historique.`, 'Supprimer')) {
      await removeSnapshot(s.id);
    }
  };

  const picked = selected ? apps.find((a) => a.name === selected) : undefined;
  const pickedPrev = picked ? previous?.apps.find((a) => a.name === picked.name) : undefined;

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />

      {reading ? (
        <div className="card">
          <strong>{reading.label}</strong>
          <p className="muted small">La lecture se fait sur ton téléphone, rien n’est envoyé. Compte 10 à 30 secondes par capture.</p>
          <Progress done={reading.ratio * 100} total={100} />
        </div>
      ) : (
        <button className="btn primary block" onClick={() => fileRef.current?.click()}>
          <IconUpload width={18} height={18} /> {latest ? 'Importer de nouvelles captures' : 'Importer mes captures du stockage'}
        </button>
      )}

      <Disclosure title="📸 Comment faire la capture ?" defaultOpen={!latest}>
        <ol className="steps">
          <li>
            Ouvre <b>Réglages › Général › Stockage iPhone</b> et attends que la liste se remplisse (quelques secondes).
          </li>
          <li>
            Fais une capture d’écran (<b>bouton latéral + volume haut</b>). Fais défiler, recapture, jusqu’en bas de la liste.
          </li>
          <li>
            Reviens ici, touche <b>Importer</b> et choisis <b>toutes</b> les captures d’un coup : une app vue deux fois n’est
            comptée qu’une fois.
          </li>
          <li>Vérifie les valeurs lues, corrige si besoin, puis enregistre.</li>
        </ol>
        <p className="muted small">
          iOS ne laisse aucune app lire ces chiffres elle-même : c’est pourquoi on passe par une capture. Les deux modes (clair et
          sombre) sont lus ; le mode clair donne les meilleurs résultats.
        </p>
      </Disclosure>

      {!latest ? (
        <EmptyState emoji="🗺️" text="Importe une capture pour voir la carte de ton stockage." />
      ) : (
        <>
          <div className="card">
            <div className="spread">
              <strong>{latest.totalBytes ? `${formatBytes(usedOf(latest))} sur ${formatBytes(latest.totalBytes)}` : `${formatBytes(usedOf(latest))} utilisés`}</strong>
              <span className="muted small">{formatDateTime(latest.date)}</span>
            </div>
            <UsageBar used={usedOf(latest)} total={latest.totalBytes} segments={segments} />
            {latest.totalBytes ? <p className="muted small">Libre : {formatBytes(Math.max(0, latest.totalBytes - usedOf(latest)))}</p> : null}
          </div>

          {previous && (
            <ComparisonCard previous={previous} latest={latest} />
          )}

          <div className="chips" role="group" aria-label="Catégories">
            {APP_CATEGORIES.filter((c) => categoryTotals.has(c.id)).map((c) => (
              <button
                key={c.id}
                className={`chip${filter === c.id ? ' active' : ''}`}
                style={{ ['--cat' as string]: c.color }}
                aria-pressed={filter === c.id}
                onClick={() => setFilter(filter === c.id ? null : c.id)}
              >
                <span className="dot-color" style={{ background: c.color }} /> {c.label} · {formatBytes(categoryTotals.get(c.id)!)}
              </button>
            ))}
          </div>

          <div className="segmented">
            <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
              Carte
            </button>
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
              Liste
            </button>
          </div>

          {view === 'map' ? (
            <Treemap items={items} total={usedOf(latest)} onSelect={(id) => !id.startsWith('__') && setSelected(id)} />
          ) : (
            <div className="list">
              {apps
                .filter((a) => !filter || catOf(a.name) === filter)
                .map((a) => {
                  const c = CATEGORY_BY_ID[catOf(a.name)];
                  return (
                    <button key={a.name} className="row row-btn" onClick={() => setSelected(a.name)}>
                      <span className="dot-color big" style={{ background: c.color }} />
                      <div className="row-main">
                        <div className="row-title ellipsis">{a.name}</div>
                        <div className="row-sub">{c.label}</div>
                      </div>
                      <div className="row-end col">
                        <strong>{formatBytes(a.bytes)}</strong>
                        <span className="muted small">{Math.round((a.bytes / usedOf(latest)) * 100)} %</span>
                      </div>
                    </button>
                  );
                })}
            </div>
          )}

          <h3 className="section-title">Historique</h3>
          <div className="list">
            {[...snaps].reverse().map((s, i, all) => {
              const older = all[i + 1];
              const d = older ? diffSnapshots(older, s) : undefined;
              return (
                <div key={s.id} className="row">
                  <div className="row-main">
                    <div className="row-title">{formatDateTime(s.date)}</div>
                    <div className="row-sub">
                      {formatBytes(usedOf(s))} utilisés · {s.apps.length} apps
                    </div>
                  </div>
                  {d && <span className={`delta ${d.usedDelta < 0 ? 'good' : d.usedDelta > 0 ? 'bad' : ''}`}>{d.usedDelta === 0 ? '=' : `${d.usedDelta < 0 ? '−' : '+'}${formatBytes(Math.abs(d.usedDelta))}`}</span>}
                  <button className="icon-btn" aria-label="Supprimer cette capture" onClick={() => void removeSnap(s)}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {draft && <StorageReview draft={draft} onClose={closeDraft} onSave={(r) => void save(r)} />}

      {picked && (
        <Sheet title={picked.name} onClose={() => setSelected(null)}>
          <div className="stats">
            <div>
              <strong>{formatBytes(picked.bytes)}</strong>
              <span>taille</span>
            </div>
            <div>
              <strong>{latest ? Math.round((picked.bytes / usedOf(latest)) * 100) : 0} %</strong>
              <span>de l’espace utilisé</span>
            </div>
            <div>
              <strong>{CATEGORY_BY_ID[catOf(picked.name)].label}</strong>
              <span>catégorie</span>
            </div>
          </div>
          {picked.lastUsed && <p className="muted">Dernière utilisation : {picked.lastUsed}{staleness(picked.lastUsed) ? ` · ${STALE_LABEL[staleness(picked.lastUsed)!]}` : ''}</p>}
          {pickedPrev && pickedPrev.bytes !== picked.bytes && (
            <Note>
              Depuis la capture précédente : {picked.bytes < pickedPrev.bytes ? '−' : '+'}
              {formatBytes(Math.abs(picked.bytes - pickedPrev.bytes))}
            </Note>
          )}
          <button
            className="btn primary block"
            onClick={() => {
              setSelected(null);
              ui.goTab('guide');
            }}
          >
            Voir comment libérer de la place
          </button>
        </Sheet>
      )}
    </>
  );
}

function ComparisonCard({ previous, latest }: { previous: Snapshot; latest: Snapshot }) {
  const d = diffSnapshots(previous, latest);
  const top = d.changes.slice(0, 5);
  return (
    <div className={`card compare ${d.usedDelta < 0 ? 'good' : ''}`}>
      <div className="spread">
        <strong>
          {d.usedDelta < 0 ? `🎉 ${formatBytes(d.gained)} gagnés` : d.usedDelta > 0 ? `+${formatBytes(d.usedDelta)} depuis la dernière capture` : 'Aucun changement'}
        </strong>
        <span className="muted small">depuis le {formatDate(previous.date)}</span>
      </div>
      {top.length > 0 && (
        <ul className="changes">
          {top.map((c) => (
            <li key={c.name}>
              <span className="ellipsis">{c.name}</span>
              <span className={c.delta < 0 ? 'good' : 'bad'}>
                {c.delta < 0 ? '−' : '+'}
                {formatBytes(Math.abs(c.delta))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
