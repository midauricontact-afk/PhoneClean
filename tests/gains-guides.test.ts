import { describe, expect, it } from 'vitest';
import { diffSnapshots, gainSinceFirst, gainTotals, usedOf, type GainEntry, type Snapshot } from '../src/core/snapshots';
import { APP_GUIDES, buildPlan, checkedTotal, combinedGain } from '../src/core/guides';

const snap = (date: number, usedGo: number | undefined, apps: [string, number, string?][]): Snapshot => ({
  id: `s${date}`,
  date,
  usedBytes: usedGo === undefined ? undefined : usedGo * 1e9,
  totalBytes: 128e9,
  apps: apps.map(([name, go, lastUsed]) => ({ name, bytes: go * 1e9, lastUsed })),
});

describe('historique et gains', () => {
  const before = snap(1, 100, [['Instagram', 3], ['TikTok', 2], ['Photos', 20]]);
  const after = snap(2, 96.5, [['Instagram', 0.5], ['TikTok', 2], ['Photos', 19], ['Nouvelle', 0.2]]);

  it('calcule la place gagnée et les changements par app', () => {
    const d = diffSnapshots(before, after);
    expect(d.usedDelta).toBeCloseTo(-3.5e9, 0);
    expect(d.gained).toBeCloseTo(3.5e9, 0);
    expect(d.changes.map((c) => [c.name, Math.round(c.delta / 1e8)])).toEqual([
      ['Instagram', -25],
      ['Photos', -10],
      ['Nouvelle', 2],
    ]);
  });

  it('ne compte jamais un gain négatif', () => {
    expect(diffSnapshots(after, before).gained).toBe(0);
  });

  it("utilise la somme des apps quand l'espace utilisé n'a pas été lu", () => {
    expect(usedOf(snap(3, undefined, [['A', 1], ['B', 2]]))).toBe(3e9);
  });

  it('mesure le gain depuis la première capture', () => {
    expect(gainSinceFirst([after, before])).toBeCloseTo(3.5e9, 0);
    expect(gainSinceFirst([before])).toBe(0);
  });

  it("ne compte pas deux fois les photos supprimées et la baisse mesurée de l'iPhone", () => {
    const log: GainEntry[] = [
      { id: '1', date: 1, source: 'photos', bytes: 1e9, label: 'x' },
      { id: '2', date: 2, source: 'drive', bytes: 4e9, label: 'y' },
      { id: '3', date: 3, source: 'guide', bytes: 9e9, label: 'estimation' },
    ];
    const t = gainTotals(log, [before, after]);
    expect(t.iphone).toBeCloseTo(3.5e9, 0); // la mesure l'emporte sur la déclaration
    expect(t.drive).toBe(4e9);
    expect(t.total).toBeCloseTo(7.5e9, 0); // l'estimation « guide » n'est jamais comptée
    expect(gainTotals(log, [before]).iphone).toBe(1e9); // sans 2e capture : seulement les photos déclarées
  });
});

describe('nettoyage guidé', () => {
  const s = snap(5, 90, [
    ['TikTok', 2, 'hier'],
    ['Spotify', 1.5, 'il y a 2 jours'],
    ['Photos', 20],
    ['Jeu Oublié', 1.2, 'jamais'],
    ['Vieux Truc', 0.5, 'il y a 6 mois'],
    ['Petite App', 0.05, 'jamais'],
    ['Système iOS', 10],
  ]);
  const plan = buildPlan(s);

  it('couvre toutes les apps demandées', () => {
    const ids = new Set(APP_GUIDES.map((g) => g.id));
    for (const id of ['whatsapp', 'instagram', 'tiktok', 'snapchat', 'facebook', 'messenger', 'telegram', 'youtube', 'spotify', 'netflix', 'primevideo', 'safari', 'messages', 'photos', 'mail', 'gmail', 'maps', 'chrome', 'discord']) {
      expect(ids.has(id)).toBe(true);
    }
    for (const g of APP_GUIDES) {
      expect(g.steps.length).toBeGreaterThan(0);
      for (const st of g.steps) {
        expect(st.how.length).toBeGreaterThan(0);
        expect(st.gain).toBeGreaterThanOrEqual(0);
        expect(st.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it('classe tes apps par gain potentiel et calcule le gain en octets', () => {
    expect(plan.mine.map((m) => m.id)).toEqual(['tiktok', 'spotify']);
    const tiktok = plan.mine[0];
    expect(tiktok.appBytes).toBe(2e9);
    expect(tiktok.steps[0].gainBytes).toBe(1.4e9); // 70 % de 2 Go
    expect(tiktok.potential).toBeLessThanOrEqual(2e9 * 0.95);
  });

  it('propose de décharger les apps inutilisées et lourdes seulement', () => {
    expect(plan.unused.map((u) => u.appName)).toEqual(['Jeu Oublié', 'Vieux Truc']);
    expect(plan.unused[0].potential).toBe(Math.round(1.2e9 * 0.8));
  });

  it('garde les astuces générales, avec un gain quand l’app est connue', () => {
    const photos = plan.general.find((g) => g.id === 'photos')!;
    expect(photos.appBytes).toBe(20e9);
    expect(plan.general.some((g) => g.id === 'iosupdate')).toBe(true);
    expect(plan.general.some((g) => g.id === 'generic')).toBe(true);
    expect(plan.others.some((g) => g.id === 'whatsapp')).toBe(true);
  });

  it('ne compte pas deux fois des étapes qui se recouvrent', () => {
    const sp = plan.mine.find((m) => m.id === 'spotify')!;
    const cache = sp.steps.find((x) => x.id === 'cache')!;
    const dl = sp.steps.find((x) => x.id === 'downloads')!;
    const re = sp.steps.find((x) => x.id === 'reinstall')!;
    expect(combinedGain([cache, dl], sp.appBytes)).toBe(Math.round(1.5e9 * 0.35) + Math.round(1.5e9 * 0.5));
    expect(combinedGain([cache, dl, re], sp.appBytes)).toBeLessThanOrEqual(Math.round(1.5e9 * 0.95));
    expect(combinedGain([cache, dl], undefined)).toBe(0);
  });

  it('totalise les cases cochées', () => {
    const none = checkedTotal(plan, {});
    expect(none.gain).toBe(0);
    expect(none.done).toBe(0);
    expect(none.total).toBeGreaterThan(30);
    const some = checkedTotal(plan, { 'tiktok:cache': true, 'whatsapp:auto': true });
    expect(some.done).toBe(2);
    expect(some.gain).toBe(1.4e9);
  });

  it('marche sans aucune capture', () => {
    const empty = buildPlan(undefined);
    expect(empty.mine).toEqual([]);
    expect(empty.others.length).toBeGreaterThan(10);
    expect(checkedTotal(empty, { 'tiktok:cache': true }).gain).toBe(0);
  });
});
