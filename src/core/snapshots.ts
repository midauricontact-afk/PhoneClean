import type { AppEntry } from './ocrParse';
import { normalizeName } from './catalog';

/** Une capture du stockage iPhone, lue puis éventuellement corrigée à la main. */
export interface Snapshot {
  id: string;
  date: number;
  usedBytes?: number;
  totalBytes?: number;
  apps: AppEntry[];
}

export type GainSource = 'iphone' | 'photos' | 'drive' | 'guide';

/** Espace réellement récupéré (mesuré), conservé pour le total « déjà gagné ». */
export interface GainEntry {
  id: string;
  date: number;
  source: GainSource;
  bytes: number;
  label: string;
}

export function appsTotal(s: Snapshot): number {
  return s.apps.reduce((sum, a) => sum + a.bytes, 0);
}

/** Espace utilisé : valeur lue sur la capture, sinon somme des apps (approximation). */
export function usedOf(s: Snapshot): number {
  return s.usedBytes ?? appsTotal(s);
}

export interface AppChange {
  name: string;
  before: number;
  after: number;
  delta: number;
}

export interface SnapshotDiff {
  /** Variation de l'espace utilisé (négatif = de la place gagnée). */
  usedDelta: number;
  /** Place gagnée (jamais négative). */
  gained: number;
  changes: AppChange[];
}

export function diffSnapshots(prev: Snapshot, next: Snapshot): SnapshotDiff {
  const before = new Map(prev.apps.map((a) => [normalizeName(a.name), a]));
  const after = new Map(next.apps.map((a) => [normalizeName(a.name), a]));
  const changes: AppChange[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const a = after.get(key);
    const delta = (a?.bytes ?? 0) - (b?.bytes ?? 0);
    if (delta !== 0) changes.push({ name: (a ?? b)!.name, before: b?.bytes ?? 0, after: a?.bytes ?? 0, delta });
  }
  changes.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const usedDelta = usedOf(next) - usedOf(prev);
  return { usedDelta, gained: Math.max(0, -usedDelta), changes };
}

/** Place gagnée depuis la toute première capture. */
export function gainSinceFirst(snapshots: Snapshot[]): number {
  if (snapshots.length < 2) return 0;
  const sorted = [...snapshots].sort((a, b) => a.date - b.date);
  return Math.max(0, usedOf(sorted[0]) - usedOf(sorted[sorted.length - 1]));
}

/**
 * Totaux des gains mesurés.
 * - iPhone : la place gagnée entre deux captures du stockage, ou à défaut les photos que tu as déclarées
 *   supprimées (elles font baisser le stockage de l'iPhone : on ne les compte pas deux fois).
 * - Drive : la corbeille réellement vidée (la corbeille seule ne libère rien).
 * Les gains « guide » sont des estimations : jamais comptés ici.
 */
export function gainTotals(log: GainEntry[], snapshots: Snapshot[]) {
  const photos = log.filter((g) => g.source === 'photos').reduce((s, g) => s + g.bytes, 0);
  const drive = log.filter((g) => g.source === 'drive').reduce((s, g) => s + g.bytes, 0);
  const measured = gainSinceFirst(snapshots);
  const iphone = Math.max(measured, photos);
  return { iphone, measured, photos, drive, total: iphone + drive };
}
