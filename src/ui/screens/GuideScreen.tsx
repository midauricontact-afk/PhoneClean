import { useMemo, useState } from 'react';
import { formatBytes } from '../../core/bytes';
import { buildPlan, checkedTotal, combinedGain, type PlanItem, type PlanStep } from '../../core/guides';
import { appStore, resetChecklist, setChecked } from '../../state/app';
import { Note, Progress } from '../components/Bits';
import { useUI } from '../uiContext';

const KIND_LABEL: Record<PlanStep['kind'], string> = {
  'in-app': 'Dans l’app',
  ios: 'Réglages iOS',
  reinstall: 'Dernier recours',
  offload: 'Libère l’app',
};

/** Onglet « Nettoyage guidé » : une checklist app par app, avec la méthode exacte et le gain estimé. */
export function GuideScreen() {
  const app = appStore.use();
  const ui = useUI();
  const latest = app.snapshots[app.snapshots.length - 1];
  const plan = useMemo(() => buildPlan(latest), [latest]);
  const totals = checkedTotal(plan, app.checklist);
  const [showOthers, setShowOthers] = useState(false);

  return (
    <>
      <div className="card">
        <div className="spread">
          <strong>
            {totals.done} / {totals.total} étapes faites
          </strong>
          {latest && <strong className="good">≈ {formatBytes(totals.gain)}</strong>}
        </div>
        <Progress done={totals.done} total={totals.total} />
        <p className="muted small">
          {latest
            ? 'Le gain est une estimation (part typique de la taille de chaque app). La vraie mesure : refais une capture de ton stockage après ton nettoyage.'
            : 'Importe d’abord une capture du stockage pour voir le gain estimé de chaque étape.'}
        </p>
        {totals.done > 0 && (
          <button className="btn small ghost" onClick={() => void resetChecklist()}>
            Tout décocher
          </button>
        )}
      </div>

      <Note>
        PhoneClean ne peut pas vider le cache d’une autre app : iOS l’interdit. Chaque étape est un geste que tu fais toi-même, dans
        l’app ou dans les Réglages. Les menus changent parfois selon la version : utilise la loupe des réglages de l’app si tu ne
        trouves pas une option.
      </Note>

      {!latest && (
        <button className="btn primary block" onClick={() => ui.goTab('storage')}>
          Importer une capture du stockage
        </button>
      )}

      {plan.mine.length > 0 && (
        <Section title="Tes applications" subtitle="Triées par gain possible">
          {plan.mine.map((i) => (
            <GuideCard key={i.id} item={i} checked={app.checklist} />
          ))}
        </Section>
      )}

      {plan.unused.length > 0 && (
        <Section title="Apps que tu n’ouvres plus" subtitle="Les décharger libère leur place sans perdre leurs données">
          {plan.unused.map((i) => (
            <GuideCard key={i.id} item={i} checked={app.checklist} />
          ))}
        </Section>
      )}

      <Section title="Astuces iOS générales" subtitle="Messages, Photos, Safari, mise à jour iOS, Podcasts, Musique…">
        {plan.general.map((i) => (
          <GuideCard key={i.id} item={i} checked={app.checklist} />
        ))}
      </Section>

      <Section
        title={latest ? 'Autres applications' : 'Applications'}
        subtitle={latest ? 'Pas vues sur ta capture, utiles si elles sont installées' : 'Guides pour les applications les plus courantes'}
      >
        {(showOthers || !latest ? plan.others : []).map((i) => (
          <GuideCard key={i.id} item={i} checked={app.checklist} />
        ))}
        {latest && !showOthers && (
          <button className="btn ghost block" onClick={() => setShowOthers(true)}>
            Afficher les {plan.others.length} autres guides
          </button>
        )}
      </Section>
    </>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="section-title">{title}</h3>
      {subtitle && <p className="hint">{subtitle}</p>}
      <div className="guide-list">{children}</div>
    </section>
  );
}

function GuideCard({ item, checked }: { item: PlanItem; checked: Record<string, boolean> }) {
  const [open, setOpen] = useState(false);
  const done = item.steps.filter((s) => checked[s.key]);
  const gain = combinedGain(done, item.appBytes);
  return (
    <article className={`card guide${done.length === item.steps.length ? ' complete' : ''}`}>
      <button className="guide-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="row-main">
          <div className="row-title">{item.appName && item.appName !== item.title ? item.appName : item.title}</div>
          <div className="row-sub">
            {item.appBytes !== undefined ? `${formatBytes(item.appBytes)} · ` : ''}
            {done.length}/{item.steps.length} étapes
            {item.potential > 0 && ` · jusqu’à ≈ ${formatBytes(item.potential)}`}
          </div>
        </div>
        <span className="chev" data-open={open}>›</span>
      </button>
      {item.guide.intro && open && <p className="muted small">{item.guide.intro}</p>}
      {open && (
        <ul className="step-list">
          {item.steps.map((s) => (
            <li key={s.key} className={checked[s.key] ? 'done' : ''}>
              <label className="step-check">
                <input type="checkbox" className="check" checked={!!checked[s.key]} onChange={(e) => void setChecked(s.key, e.target.checked)} />
                <span>
                  <b>{s.title}</b>
                  <small className="muted block">
                    {KIND_LABEL[s.kind]}
                    {s.gainBytes ? ` · ≈ ${formatBytes(s.gainBytes)}` : s.gain === 0 ? ' · prévention' : ''}
                  </small>
                </span>
              </label>
              <ol className="how">
                {s.how.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            </li>
          ))}
          {gain > 0 && <li className="muted small">Gain estimé pour cette app : ≈ {formatBytes(gain)}</li>}
        </ul>
      )}
    </article>
  );
}
