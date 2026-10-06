import { describe, expect, it } from 'vitest';
import { buildActions } from '../src/core/actions';
import { buildPlan } from '../src/core/guides';
import type { Snapshot } from '../src/core/snapshots';

const snap: Snapshot = {
  id: 's',
  date: 1,
  usedBytes: 90e9,
  totalBytes: 128e9,
  apps: [
    { name: 'TikTok', bytes: 4e9, lastUsed: 'hier' },
    { name: 'Spotify', bytes: 1e9, lastUsed: 'hier' },
  ],
};

describe('prochaines actions', () => {
  it('trie par gain décroissant et ne garde qu’une étape par app', () => {
    const actions = buildActions({
      hasSnapshot: true,
      plan: buildPlan(snap),
      checked: {},
      photos: { reclaimable: 3e9, count: 40 },
      drive: { trashBytes: 2e9, duplicateBytes: 0, oldBytes: 0 },
    });
    expect(actions.map((a) => a.id).slice(0, 3)).toEqual(['photos', 'tiktok:cache', 'drive-trash']); // 3 Go, puis 70 % de 4 Go = 2,8 Go, puis 2 Go
    expect(actions.map((a) => a.gain)).toEqual([...actions.map((a) => a.gain)].sort((a, b) => b - a));
    expect(actions.filter((a) => a.id.startsWith('tiktok')).length).toBe(1);
    expect(actions.some((a) => a.id === 'photos' && a.tab === 'photos')).toBe(true);
    expect(actions.some((a) => a.id === 'drive-trash' && a.tab === 'drive')).toBe(true);
  });

  it('retire les étapes déjà cochées', () => {
    const actions = buildActions({ hasSnapshot: true, plan: buildPlan(snap), checked: { 'tiktok:cache': true }, drive: undefined });
    expect(actions.some((a) => a.id === 'tiktok:cache')).toBe(false);
  });

  it('commence par la première capture quand il n’y en a pas', () => {
    const actions = buildActions({ hasSnapshot: false, plan: buildPlan(undefined), checked: {} });
    expect(actions[0]).toMatchObject({ id: 'first-capture', tab: 'storage', gain: 0 });
  });
});
