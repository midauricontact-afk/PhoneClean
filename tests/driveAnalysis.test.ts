import { describe, expect, it } from 'vitest';
import {
  FOLDER_MIME,
  ROOT,
  biggest,
  buildIndex,
  childrenOf,
  findDriveDuplicates,
  oldFiles,
  otherUsage,
  sizeOfSelection,
  topLevel,
  withDescendants,
  pathName,
  pathOf,
  totalSize,
  typeOf,
  typeTotals,
  type DriveFile,
} from '../src/core/driveAnalysis';

const NOW = Date.UTC(2026, 9, 1);
const DAY = 86_400_000;
let n = 0;
const file = (name: string, parent: string | undefined, size: number, extra: Partial<DriveFile> = {}): DriveFile => ({
  id: `f${++n}-${name}`,
  name,
  mime: extra.mime ?? 'application/octet-stream',
  size,
  parents: parent ? [parent] : [],
  modified: NOW - 10 * DAY,
  ...extra,
});
const folder = (name: string, parent?: string) => file(name, parent, 0, { mime: FOLDER_MIME });

const docs = folder('Documents');
const photos = folder('Photos', docs.id);
const trips = folder('Voyages', photos.id);
const empty = folder('Vide');
const files: DriveFile[] = [
  docs,
  photos,
  trips,
  empty,
  file('cv.pdf', docs.id, 2_000_000, { mime: 'application/pdf' }),
  file('plage.jpg', trips.id, 5_000_000, { mime: 'image/jpeg', md5: 'm1', modified: NOW - 400 * DAY }),
  file('plage (1).jpg', trips.id, 5_000_000, { mime: 'image/jpeg', md5: 'm1', modified: NOW - 300 * DAY }),
  file('plage copie.jpg', photos.id, 5_000_000, { mime: 'image/jpeg', md5: 'm1', modified: NOW - 200 * DAY }),
  file('film.mp4', undefined, 80_000_000, { mime: 'video/mp4', md5: 'm2', modified: NOW - 800 * DAY }),
  file('orphelin.txt', 'dossier-inconnu', 1_000, { mime: 'text/plain' }),
  file('Mon doc', docs.id, 0, { mime: 'application/vnd.google-apps.document' }),
];

describe('arborescence Drive', () => {
  const index = buildIndex(files);

  it('cumule les tailles dans les dossiers, sous-dossiers compris', () => {
    expect(index.folders.get(trips.id)).toEqual({ size: 10_000_000, count: 2 });
    expect(index.folders.get(photos.id)).toEqual({ size: 15_000_000, count: 3 });
    expect(index.folders.get(docs.id)).toEqual({ size: 17_000_000, count: 5 });
    expect(index.folders.get(empty.id)).toEqual({ size: 0, count: 0 });
    expect(index.folders.get(ROOT)!.size).toBe(97_001_000);
  });

  it('liste le contenu d’un dossier du plus lourd au plus léger', () => {
    expect(childrenOf(index).map((e) => [e.name, e.size])).toEqual([
      ['film.mp4', 80_000_000],
      ['Documents', 17_000_000],
      ['orphelin.txt', 1_000],
      ['Vide', 0],
    ]);
    expect(childrenOf(index, docs.id).map((e) => e.name)).toEqual(['Photos', 'cv.pdf', 'Mon doc']);
  });

  it('range à la racine ce dont le dossier parent est inconnu', () => {
    expect(childrenOf(index).some((e) => e.name === 'orphelin.txt')).toBe(true);
  });

  it('donne le chemin d’un dossier', () => {
    expect(pathOf(index, trips.id).map((f) => f.name)).toEqual(['Documents', 'Photos', 'Voyages']);
    expect(pathName(index, files.find((f) => f.name === 'plage.jpg')!)).toBe('Mon Drive / Documents / Photos / Voyages');
  });

  it('résiste à une arborescence très profonde', () => {
    const deep: DriveFile[] = [];
    let parent: string | undefined;
    for (let i = 0; i < 20_000; i++) {
      const f = folder(`d${i}`, parent);
      deep.push(f);
      parent = f.id;
    }
    deep.push(file('fond.bin', parent, 7));
    expect(buildIndex(deep).folders.get(ROOT)!.size).toBe(7);
  });
});

describe('analyses Drive', () => {
  it('trouve les doublons exacts (MD5) et garde le plus ancien', () => {
    const groups = findDriveDuplicates(files);
    expect(groups).toHaveLength(1); // film.mp4 est seul avec son MD5
    expect(groups[0].files.map((f) => f.name)).toEqual(['plage.jpg', 'plage (1).jpg', 'plage copie.jpg']);
    expect(groups[0].keepId).toBe(files.find((f) => f.name === 'plage.jpg')!.id);
    expect(groups[0].reclaim).toBe(10_000_000);
  });

  it('classe par type', () => {
    expect(typeOf({ mime: 'image/png', name: 'a.png' })).toBe('images');
    expect(typeOf({ mime: 'application/pdf', name: 'a.pdf' })).toBe('pdf');
    expect(typeOf({ mime: 'application/octet-stream', name: 'x.zip' })).toBe('archives');
    expect(typeOf({ mime: 'application/octet-stream', name: 'x.bin' })).toBe('other');
    const t = typeTotals(files);
    expect(t[0]).toEqual({ type: 'videos', size: 80_000_000, count: 1 });
    expect(t.find((x) => x.type === 'images')).toEqual({ type: 'images', size: 15_000_000, count: 3 });
  });

  it('trouve les plus gros fichiers et les vieux fichiers', () => {
    expect(biggest(files, 2).map((f) => f.name)).toEqual(['film.mp4', 'plage.jpg']);
    expect(oldFiles(files, 12, 1e6, NOW).map((f) => f.name)).toEqual(['film.mp4', 'plage.jpg']);
    expect(oldFiles(files, 6, 1e6, NOW).map((f) => f.name)).toEqual(['film.mp4', 'plage.jpg', 'plage (1).jpg', 'plage copie.jpg']);
    expect(totalSize(files)).toBe(97_001_000);
  });

  it('sépare le quota Drive de Gmail + Photos', () => {
    expect(otherUsage({ usage: 10e9, usageInDrive: 6e9, usageInTrash: 1e9 })).toBe(4e9);
  });
});

describe('sélection', () => {
  const index = buildIndex(files);
  const byName = (name: string) => files.find((f) => f.name === name)!.id;

  it('ne garde que le niveau le plus haut quand un dossier et son contenu sont cochés', () => {
    const ids = [byName('Photos'), byName('plage.jpg'), byName('film.mp4')];
    expect(topLevel(index, ids).sort()).toEqual([byName('Photos'), byName('film.mp4')].sort());
  });

  it('ne compte pas deux fois l’espace d’un dossier et de son contenu', () => {
    expect(sizeOfSelection(index, [byName('Photos'), byName('plage.jpg')])).toBe(15_000_000);
    expect(sizeOfSelection(index, [byName('film.mp4'), byName('cv.pdf')])).toBe(82_000_000);
  });

  it('retrouve tout ce qu’un dossier contient', () => {
    const all = withDescendants(index, [byName('Photos')]);
    expect(all.has(byName('plage.jpg'))).toBe(true);
    expect(all.has(byName('Voyages'))).toBe(true);
    expect(all.has(byName('cv.pdf'))).toBe(false);
  });
});
