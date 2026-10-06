import type { ReactNode } from 'react';
import { formatBytes } from '../../core/bytes';

/** Barre « utilisé / total » avec segments optionnels. */
export function UsageBar({
  used,
  total,
  segments,
}: {
  used: number;
  total?: number;
  segments?: { value: number; color: string; label: string }[];
}) {
  const cap = total && total > 0 ? total : Math.max(used, 1);
  const parts = segments ?? [{ value: used, color: 'var(--accent)', label: 'Utilisé' }];
  return (
    <div className="usage" role="img" aria-label={`${formatBytes(used)} utilisés${total ? ` sur ${formatBytes(total)}` : ''}`}>
      {parts.map((p) => (
        <div key={p.label} title={`${p.label} : ${formatBytes(p.value)}`} style={{ width: `${Math.min(100, (p.value / cap) * 100)}%`, background: p.color }} />
      ))}
    </div>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className={`progress${total ? '' : ' indeterminate'}`}>
      <div style={{ width: total ? `${Math.min(100, (done / total) * 100)}%` : undefined }} />
    </div>
  );
}

export function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: 'good' }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Bloc dépliable (guides, explications). */
export function Disclosure({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <div className={`note ${tone}`}>{children}</div>;
}
