import { useMemo, useRef, useState } from 'react';
import { formatBytes, formatDateTime } from '../../core/bytes';
import { analyzeCollection, type PhotoGroup, type PhotoRecord } from '../../core/imageAnalysis';
import { addPhotoFiles, cancelPhotos, clearPhotos, markRemoved, photosStore } from '../../state/photos';
import { Disclosure, Note, Progress } from '../components/Bits';
import { EmptyState } from '../components/EmptyState';
import { Sheet } from '../components/Sheet';
import { IconUpload } from '../icons';
import { confirmDestructive, useUI } from '../uiContext';
import { toast } from '../../state/app';

type Tab = 'duplicates' | 'similar' | 'bursts' | 'blurry' | 'screenshots' | 'videos';

const TABS: { id: Tab; label: string; emoji: string; help: string }[] = [
  { id: 'duplicates', label: 'Doublons', emoji: '👯', help: 'Fichiers strictement identiques (même contenu, octet pour octet).' },
  { id: 'similar', label: 'Similaires', emoji: '🖼️', help: 'Presque la même photo (retouchée, recadrée, prise deux fois).' },
  { id: 'bursts', label: 'Rafales', emoji: '📸', help: 'Plusieurs prises à quelques secondes d’intervalle : garde la plus nette.' },
  { id: 'blurry', label: 'Floues', emoji: '🌫️', help: 'Photos probablement floues (mesure automatique : vérifie avant de supprimer).' },
  { id: 'screenshots', label: 'Captures', emoji: '📱', help: 'Captures d’écran, souvent inutiles après quelques jours.' },
  { id: 'videos', label: 'Vidéos', emoji: '🎬', help: 'Les plus grosses vidéos (plus de 100 Mo) : ce sont elles qui pèsent le plus.' },
];

function Thumb({ rec, url, size = 72 }: { rec: PhotoRecord; url?: string; size?: number }) {
  return url ? (
    <img src={url} alt={rec.name} width={size} height={size} loading="lazy" className="thumb" />
  ) : (
    <div className="thumb ph" style={{ width: size, height: size }}>
      {rec.kind === 'video' ? '🎬' : '🖼️'}
    </div>
  );
}

/** Onglet « Photos » : analyse locale des photos et vidéos choisies, liste à supprimer toi-même dans Photos. */
export function PhotosScreen() {
  const ui = useUI();
  const st = photosStore.use();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>('duplicates');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(30);
  const [showDelete, setShowDelete] = useState(false);
  const [preview, setPreview] = useState<PhotoRecord | null>(null);

  const findings = useMemo(() => analyzeCollection(st.records), [st.records]);
  const active = st.records.filter((r) => !r.removed);
  const removedCount = st.records.length - active.length;
  const byId = useMemo(() => new Map(st.records.map((r) => [r.id, r])), [st.records]);

  const isSel = (id: string) => sel[id] ?? findings.candidates.has(id);
  const toggle = (id: string) => setSel((s) => ({ ...s, [id]: !isSel(id) }));

  const selectedRecs = useMemo(
    () => active.filter((r) => sel[r.id] ?? findings.candidates.has(r.id)).sort((a, b) => (a.taken ?? 0) - (b.taken ?? 0)),
    [active, sel, findings],
  );
  const selectedBytes = selectedRecs.reduce((s, r) => s + r.size, 0);

  const counts: Record<Tab, number> = {
    duplicates: findings.duplicates.length,
    similar: findings.similar.length,
    bursts: findings.bursts.length,
    blurry: findings.blurry.length,
    screenshots: findings.screenshots.length,
    videos: findings.bigVideos.length,
  };

  const onFiles = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (fileRef.current) fileRef.current.value = '';
    void addPhotoFiles(files).catch((e) => toast(`Analyse interrompue : ${e instanceof Error ? e.message : String(e)}`, 'error'));
  };

  const reset = async () => {
    if (await confirmDestructive(ui, 'Effacer l’analyse ?', 'La liste des photos analysées sera effacée de ce téléphone (tes photos ne sont pas touchées).', 'Effacer')) {
      setSel({});
      await clearPhotos();
    }
  };

  const groupsFor = (t: 'duplicates' | 'similar' | 'bursts'): PhotoGroup[] => findings[t];

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />

      {st.busy ? (
        <div className="card">
          <div className="spread">
            <strong>
              Analyse {st.busy.done.toLocaleString('fr-FR')} / {st.busy.total.toLocaleString('fr-FR')}
            </strong>
            <button className="btn small ghost" onClick={cancelPhotos}>
              Arrêter
            </button>
          </div>
          <Progress done={st.busy.done} total={st.busy.total} />
          <p className="muted small">Tout se passe sur ton téléphone. Tu peux continuer à regarder les résultats pendant l’analyse.</p>
        </div>
      ) : (
        <button className="btn primary block" onClick={() => fileRef.current?.click()}>
          <IconUpload width={18} height={18} /> {st.records.length ? 'Ajouter des photos et vidéos' : 'Choisir des photos et vidéos'}
        </button>
      )}

      <Disclosure title="💡 Pour de meilleurs résultats" defaultOpen={st.records.length === 0}>
        <ul className="tips-list">
          <li>
            Choisis par lots (un mois, un album…) : tu peux sélectionner des centaines d’éléments, l’app les analyse un par un
            sans bloquer l’écran.
          </li>
          <li>
            Dans la fenêtre de sélection, touche <b>Options</b> et garde le format d’<b>origine</b> si iOS le propose : les tailles
            affichées seront celles de tes vrais fichiers.
          </li>
          <li>
            iOS ne permet pas à une web app de supprimer dans Photos : PhoneClean te prépare la liste (date, taille, aperçu) et tu
            supprimes toi-même en quelques gestes.
          </li>
          <li>Les fichiers ne sont jamais envoyés : seules une petite miniature et des empreintes restent ici.</li>
        </ul>
      </Disclosure>

      {st.records.length === 0 && !st.busy ? (
        <EmptyState emoji="📷" text="Choisis des photos et vidéos : PhoneClean trouvera les doublons, les photos floues, les captures d’écran et les grosses vidéos." />
      ) : (
        <>
          <div className="card">
            <div className="big-number">{formatBytes(findings.reclaimable)}</div>
            <p className="muted small">
              récupérables sur {active.length.toLocaleString('fr-FR')} fichiers analysés ({formatBytes(active.reduce((s, r) => s + r.size, 0))}).
              {removedCount > 0 && ` ${removedCount} déjà supprimés.`}
            </p>
          </div>

          <div className="chips" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' active' : ''}`} onClick={() => { setTab(t.id); setLimit(30); }}>
                {t.emoji} {t.label} {counts[t.id] > 0 && <span className="chip-count">{counts[t.id]}</span>}
              </button>
            ))}
          </div>
          <p className="hint">{TABS.find((t) => t.id === tab)!.help}</p>

          {(tab === 'duplicates' || tab === 'similar' || tab === 'bursts') && (
            <>
              {groupsFor(tab).slice(0, limit).map((g) => (
                <article key={g.id} className="card group">
                  <div className="spread">
                    <strong>
                      {g.items.length} {tab === 'duplicates' ? 'identiques' : tab === 'bursts' ? 'prises' : 'similaires'}
                    </strong>
                    <span className="muted small">{formatBytes(g.reclaim)} récupérables</span>
                  </div>
                  <div className="thumbs">
                    {g.items.map((r) => (
                      <div key={r.id} className={`thumb-cell${isSel(r.id) ? ' sel' : ''}`}>
                        <button onClick={() => setPreview(r)} aria-label={`Aperçu ${r.name}`}>
                          <Thumb rec={r} url={st.thumbs[r.id]} />
                        </button>
                        <input type="checkbox" className="check overlay" checked={isSel(r.id)} onChange={() => toggle(r.id)} aria-label={`Supprimer ${r.name}`} />
                        {r.id === g.keepId && <span className="keep">À garder</span>}
                        <span className="cell-size">{formatBytes(r.size)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              {groupsFor(tab).length > limit && (
                <button className="btn ghost block" onClick={() => setLimit(limit + 30)}>
                  Afficher plus ({groupsFor(tab).length - limit} groupes)
                </button>
              )}
              {groupsFor(tab).length === 0 && <EmptyState emoji="✨" text="Rien trouvé dans cette catégorie." />}
            </>
          )}

          {(tab === 'blurry' || tab === 'screenshots') && (
            <>
              <div className="grid">
                {(tab === 'blurry' ? findings.blurry : findings.screenshots).slice(0, limit * 3).map((r) => (
                  <div key={r.id} className={`thumb-cell${isSel(r.id) ? ' sel' : ''}`}>
                    <button onClick={() => setPreview(r)} aria-label={`Aperçu ${r.name}`}>
                      <Thumb rec={r} url={st.thumbs[r.id]} size={96} />
                    </button>
                    <input type="checkbox" className="check overlay" checked={isSel(r.id)} onChange={() => toggle(r.id)} aria-label={`Supprimer ${r.name}`} />
                    <span className="cell-size">{formatBytes(r.size)}</span>
                  </div>
                ))}
              </div>
              {(tab === 'blurry' ? findings.blurry : findings.screenshots).length === 0 && <EmptyState emoji="✨" text="Rien trouvé dans cette catégorie." />}
            </>
          )}

          {tab === 'videos' && (
            <>
              <div className="list">
                {findings.bigVideos.map((r) => (
                  <div key={r.id} className="row">
                    <button onClick={() => setPreview(r)} aria-label={`Aperçu ${r.name}`}>
                      <Thumb rec={r} url={st.thumbs[r.id]} size={56} />
                    </button>
                    <div className="row-main">
                      <div className="row-title ellipsis">{r.name}</div>
                      <div className="row-sub">
                        {formatBytes(r.size)}
                        {r.duration ? ` · ${Math.floor(r.duration / 60)} min ${r.duration % 60} s` : ''}
                        {r.taken ? ` · ${formatDateTime(r.taken)}` : ''}
                      </div>
                    </div>
                    <input type="checkbox" className="check" checked={isSel(r.id)} onChange={() => toggle(r.id)} aria-label={`Supprimer ${r.name}`} />
                  </div>
                ))}
              </div>
              {findings.bigVideos.length === 0 && <EmptyState emoji="✨" text="Aucune vidéo de plus de 100 Mo." />}
              <Note>Les vidéos ne sont jamais cochées d’office : à toi de choisir celles dont tu peux te passer.</Note>
            </>
          )}

          <div className="actionbar">
            <div>
              <strong>{selectedRecs.length.toLocaleString('fr-FR')} sélectionnés</strong>
              <span className="muted small block">{formatBytes(selectedBytes)}</span>
            </div>
            <button className="btn primary" disabled={!selectedRecs.length} onClick={() => setShowDelete(true)}>
              Comment les supprimer
            </button>
          </div>

          <button className="btn small ghost" onClick={() => void reset()}>
            Effacer l’analyse
          </button>
        </>
      )}

      {showDelete && (
        <DeleteSheet
          items={selectedRecs}
          thumbs={st.thumbs}
          onClose={() => setShowDelete(false)}
          onDone={async () => {
            await markRemoved(selectedRecs.map((r) => r.id), 'Photos supprimées');
            setSel({});
            setShowDelete(false);
          }}
        />
      )}

      {preview && (
        <Sheet title={preview.name} onClose={() => setPreview(null)}>
          {st.thumbs[preview.id] && <img src={st.thumbs[preview.id]} alt={preview.name} className="preview" />}
          <ul className="facts">
            <li>Taille : {formatBytes(preview.size)}</li>
            {preview.width && preview.height && (
              <li>
                Dimensions : {preview.width} × {preview.height}
              </li>
            )}
            <li>Date : {preview.taken ? formatDateTime(preview.taken) : 'inconnue'}</li>
            {preview.duration ? <li>Durée : {preview.duration} s</li> : null}
            {preview.blur !== undefined && <li>Netteté : {preview.blur} (sous 60 = probablement floue)</li>}
          </ul>
          {byId.get(preview.id)?.id && (
            <button className="btn ghost block" onClick={() => { toggle(preview.id); setPreview(null); }}>
              {isSel(preview.id) ? 'Ne pas supprimer' : 'Ajouter à la liste à supprimer'}
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}

function DeleteSheet({ items, thumbs, onClose, onDone }: { items: PhotoRecord[]; thumbs: Record<string, string>; onClose: () => void; onDone: () => Promise<void> }) {
  const total = items.reduce((s, r) => s + r.size, 0);
  const copy = async () => {
    const text = items
      .map((r) => `${r.taken ? formatDateTime(r.taken) : 'date inconnue'} · ${r.name} · ${formatBytes(r.size)}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Liste copiée', 'ok');
    } catch {
      toast('Copie impossible', 'error');
    }
  };
  return (
    <Sheet title={`Supprimer ${items.length} éléments`} onClose={onClose}>
      <Note>
        PhoneClean ne peut pas supprimer dans l’app Photos (iOS l’interdit aux sites web). Voici comment le faire en quelques
        gestes, puis reviens confirmer.
      </Note>
      <ol className="steps">
        <li>
          Ouvre l’app <b>Photos</b>.
        </li>
        <li>
          <b>Doublons</b> : Albums › Utilitaires › <b>Doublons</b> › Fusionner (iOS 16 et plus).
          <br />
          <b>Captures d’écran</b> : Albums › Types de médias › <b>Captures d’écran</b> › Sélectionner.
          <br />
          <b>Vidéos</b> : Albums › Types de médias › <b>Vidéos</b>.
        </li>
        <li>
          Pour retrouver une photo précise, repère sa <b>date et son heure</b> dans la liste ci-dessous. Dans Photos, touche une
          photo puis ⓘ pour voir son nom de fichier.
        </li>
        <li>
          Sélectionne-les, touche la corbeille. Puis Albums › Utilitaires › <b>Supprimés récemment</b> › Sélectionner › <b>Tout
          supprimer</b> : c’est seulement là que la place est libérée.
        </li>
      </ol>
      <div className="spread">
        <strong>
          {items.length} éléments · {formatBytes(total)}
        </strong>
        <button className="btn small ghost" onClick={() => void copy()}>
          Copier la liste
        </button>
      </div>
      <div className="list compact delete-list">
        {items.slice(0, 200).map((r) => (
          <div key={r.id} className="row">
            <Thumb rec={r} url={thumbs[r.id]} size={48} />
            <div className="row-main">
              <div className="row-title ellipsis">{r.taken ? formatDateTime(r.taken) : 'Date inconnue'}</div>
              <div className="row-sub ellipsis">
                {r.name} · {formatBytes(r.size)}
              </div>
            </div>
          </div>
        ))}
        {items.length > 200 && <p className="muted small" style={{ padding: 12 }}>… et {items.length - 200} de plus (utilise « Copier la liste » pour tout avoir).</p>}
      </div>
      <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => void onDone()}>
        J’ai supprimé ces {items.length} éléments
      </button>
      <p className="muted small">Cela les retire de la liste et ajoute {formatBytes(total)} à ton « espace gagné ». Fais ensuite une nouvelle capture du stockage pour mesurer le vrai gain.</p>
    </Sheet>
  );
}
