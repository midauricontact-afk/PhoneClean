/** iOS et Google affichent les tailles en unités décimales : 1 Go = 1 000 000 000 octets. */
export const KB = 1e3;
export const MB = 1e6;
export const GB = 1e9;

export function formatBytes(bytes: number, digits = 1): string {
  const abs = Math.abs(bytes);
  if (abs < KB) return `${Math.round(bytes)} o`;
  const units: [number, string][] = [
    [1e12, 'To'],
    [GB, 'Go'],
    [MB, 'Mo'],
    [KB, 'Ko'],
  ];
  for (const [factor, unit] of units) {
    if (abs >= factor) {
      const v = bytes / factor;
      const d = abs >= 100 * factor ? 0 : digits;
      return `${v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 })} ${unit}`;
    }
  }
  return `${bytes} o`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const UNIT_FACTOR: Record<string, number> = {
  o: 1,
  ko: KB,
  kb: KB,
  mo: MB,
  mb: MB,
  go: GB,
  gb: GB,
  to: 1e12,
  tb: 1e12,
};

/** « 3,2 » + « Go » → 3 200 000 000. Renvoie null si le nombre ou l'unité sont illisibles. */
export function toBytes(value: string, unit: string): number | null {
  const factor = UNIT_FACTOR[unit.trim().toLowerCase()];
  if (!factor) return null;
  const n = Number(value.replace(/[\s  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * factor);
}

/** Lit « 3,2 Go », « 450 Mo », « 1.5GB »… saisis à la main. */
export function parseSizeInput(input: string): number | null {
  const m = input.trim().match(/^([\d\s.,]+)\s*([a-zA-Z]{1,2})$/);
  if (!m) return null;
  return toBytes(m[1], m[2]);
}

/** Valeur telle qu'iOS l'affiche : deux décimales en Go (43,01 Go), une en Mo (972,2 Mo). Sert à pré-remplir les champs à corriger. */
export function formatExact(bytes: number): string {
  const fmt = (v: number, d: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  if (bytes >= 1e12) return `${fmt(bytes / 1e12, 2)} To`;
  if (bytes >= 1e9) return `${fmt(bytes / 1e9, 2)} Go`;
  if (bytes >= 1e6) return `${fmt(bytes / 1e6, 1)} Mo`;
  if (bytes >= 1e3) return `${fmt(bytes / 1e3, 0)} Ko`;
  return `${bytes} o`;
}
