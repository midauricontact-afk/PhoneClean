import { useMemo } from 'react';
import { buildActions } from '../../core/actions';
import { formatBytes } from '../../core/bytes';
import { findDriveDuplicates, oldFiles, otherUsage } from '../../core/driveAnalysis';
import { buildPlan } from '../../core/guides';
import { analyzeCollection } from '../../core/imageAnalysis';
import { gainTotals, usedOf } from '../../core/snapshots';
import { appStore } from '../../state/app';
import { driveStore } from '../../state/drive';
import { photosStore } from '../../state/photos';
import { Stat, UsageBar } from '../components/Bits';
import { IconChevron } from '../icons';
import { useUI } from '../uiContext';

/** Accueil : où en est ton espace, ce que tu as déjà gagné, et quoi faire ensuite. */
export function HomeScreen() {
  const app = appStore.use();
  const drive = driveStore.use();
  const photos = photosStore.use();
  const ui = useUI();
  const latest = app.snapshots[app.snapshots.length - 1];

  const plan = useMemo(() => buildPlan(latest), [latest]);
  const photoFindings = useMemo(() => analyzeCollection(photos.records), [photos.records]);
  const driveInfo = useMemo(() => {
    if (!drive.files.length) return undefined;
    return {
      trashBytes: drive.quota?.usageInTrash ?? 0,
      duplicateBytes: findDriveDuplicates(drive.files).reduce((s, g) => s + g.reclaim, 0),
      oldBytes: oldFiles(drive.files, 12, 50e6).reduce((s, f) => s + f.size, 0),
    };
  }, [drive.files, drive.quota]);

  const actions = buildActions({
    hasSnapshot: !!latest,
    plan,
    checked: app.checklist,
    photos: photoFindings.reclaimable > 0 ? { reclaimable: photoFindings.reclaimable, count: photoFindings.candidates.size } : undefined,
    drive: driveInfo,
  });
  const gains = gainTotals(app.gains, app.snapshots);
  const q = drive.quota;

  return (
    <>
      <div className="card home-card" onClick={() => ui.goTab('storage')} role="button" tabIndex={0}>
        <div className="spread">
          <strong>📱 iPhone</strong>
          <IconChevron width={16} height={16} className="muted" />
        </div>
        {latest ? (
          <>
            <div className="big-number">
              {formatBytes(usedOf(latest))}
              {latest.totalBytes ? <span className="muted of"> / {formatBytes(latest.totalBytes)}</span> : null}
            </div>
            <UsageBar used={usedOf(latest)} total={latest.totalBytes} />
            <p className="muted small">
              {latest.totalBytes ? `Libre : ${formatBytes(Math.max(0, latest.totalBytes - usedOf(latest)))} · ` : ''}
              d’après ta dernière capture
            </p>
          </>
        ) : (
          <p className="muted">Importe une capture de Réglages › Général › Stockage iPhone pour commencer.</p>
        )}
      </div>

      <div className="card home-card" onClick={() => ui.goTab('drive')} role="button" tabIndex={0}>
        <div className="spread">
          <strong>☁️ Google (Drive, Gmail, Photos)</strong>
          <IconChevron width={16} height={16} className="muted" />
        </div>
        {q ? (
          <>
            <div className="big-number">
              {formatBytes(q.usage)}
              {q.limit ? <span className="muted of"> / {formatBytes(q.limit)}</span> : null}
            </div>
            <UsageBar
              used={q.usage}
              total={q.limit}
              segments={[
                { value: Math.max(0, q.usageInDrive - q.usageInTrash), color: '#6366f1', label: 'Drive' },
                { value: q.usageInTrash, color: '#ef4444', label: 'Corbeille' },
                { value: otherUsage(q), color: '#10b981', label: 'Gmail et Photos' },
              ]}
            />
          </>
        ) : (
          <p className="muted">Connecte ton compte Google pour voir et nettoyer ton Drive.</p>
        )}
      </div>

      <div className="card">
        <strong>🎉 Espace déjà gagné</strong>
        <div className="big-number good">{formatBytes(gains.total)}</div>
        {gains.total > 0 ? (
          <div className="stats">
            <Stat value={formatBytes(gains.iphone)} label="sur l’iPhone" />
            <Stat value={formatBytes(gains.drive)} label="sur Google Drive" />
          </div>
        ) : (
          <p className="muted small">
            Compté uniquement quand c’est mesuré : baisse entre deux captures du stockage, photos que tu confirmes avoir supprimées,
            corbeille Drive réellement vidée.
          </p>
        )}
      </div>

      <h3 className="section-title">Prochaines actions</h3>
      <p className="hint">Triées par gain estimé.</p>
      <div className="list">
        {actions.map((a) => (
          <button key={a.id} className="row row-btn" onClick={() => ui.goTab(a.tab)}>
            <div className="row-main">
              <div className="row-title">{a.title}</div>
              <div className="row-sub">{a.detail}</div>
            </div>
            {a.gain > 0 && <strong className="good nowrap">≈ {formatBytes(a.gain)}</strong>}
            <IconChevron width={16} height={16} className="muted" />
          </button>
        ))}
        {actions.length === 0 && <div className="row muted">Tout est fait. Refais une capture pour mesurer le gain !</div>}
      </div>
    </>
  );
}
