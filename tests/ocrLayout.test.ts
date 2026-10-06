import { describe, expect, it } from 'vitest';
import { alignRows, buildRows, type OcrLine } from '../src/core/ocrLayout';
import { mergeParsed, parseSizeText, repairSizes, staleness } from '../src/core/ocrParse';
import { canonicalName } from '../src/core/catalog';

/** Positions (en pixels) relevées sur une vraie capture « Stockage iPhone » : une rangée tous les ~147 px. */
const line = (text: string, y0: number, y1: number): OcrLine => ({ text, y0, y1 });

const names: OcrLine[] = [
  line('Photos', 305, 340),
  line("|   Dernière utilisation : Aujourd'hui", 345, 375),
  line('\\ Instagram', 452, 487),
  line("   Dernière utilisation : Aujourd'hui", 492, 522),
  line('TikKTok', 599, 634),
  line("Dernière utilisation : Aujourd'hui", 639, 669),
  line('|   Messenger', 747, 782),
  line('Dernière utilisation : Hier', 787, 815),
  line('Clash Royale', 1041, 1076),
  line('   Dernière utilisation : 29/09/2026', 1081, 1111),
  line('X', 1481, 1516),
  line('Dernière utilisation : Avant-hier', 1521, 1551),
  line('|  Sur mon iPhone', 1632, 1668),
  line('Snapchat', 1747, 1782),
  line("Dernière utilisation : Aujourd'hui", 1787, 1817),
  line('Li : Aujourd\'hui', 1894, 1924), // nom illisible : seule la ligne « Dernière utilisation » est lue
  line('Économisez jusqu’à 26,44 Go. Voyez', 990, 1020),
];

const sizes: OcrLine[] = [
  line('43,01 Go', 318, 355),
  line('10,05 Go', 468, 503),
  line('8,99 Go', 615, 650),
  line('188 Go', 762, 797), // virgule perdue par l'OCR
  line('1,15 Go', 1058, 1093),
  line('964,6 Mo', 1497, 1532),
  line('774,8 Mo', 1632, 1668),
  line('714 3 Mo', 1764, 1799), // virgule lue comme une espace
  line('986,2 Mo', 1911, 1946),
  line('26,44 Go.', 990, 1020), // chiffre d'une recommandation, sans rangée d'app
];

describe('lecture par position (une rangée = nom + dernière utilisation + taille)', () => {
  const rows = buildRows(names);

  it('regroupe le nom et la ligne « Dernière utilisation » dans une même rangée', () => {
    const photos = rows.find((r) => r.name === 'Photos')!;
    expect(photos.hasSub).toBe(true);
    expect(photos.lastUsed).toBe("Aujourd'hui");
    expect(rows.find((r) => r.name === 'Clash Royale')?.lastUsed).toBe('29/09/2026');
  });

  const r = alignRows(names, sizes);
  const byName = (n: string) => r.apps.find((a) => a.name === n);

  it('associe chaque taille au bon nom grâce à la hauteur', () => {
    expect(byName('Photos')?.bytes).toBe(43_010_000_000);
    expect(byName('Instagram')?.bytes).toBe(10_050_000_000);
    expect(byName('TikTok')?.bytes).toBe(8_990_000_000); // « TikKTok » corrigé
    expect(byName('Clash Royale')?.bytes).toBe(1_150_000_000);
    expect(byName('X')?.bytes).toBe(964_600_000);
  });

  it('répare les virgules perdues sur les tailles', () => {
    expect(parseSizeText('714 3 Mo')).toBe(714_300_000);
    expect(parseSizeText('1 36 Go')).toBe(1_360_000_000);
    expect(byName('Snapchat')?.bytes).toBe(714_300_000);
    const fixed = repairSizes({ apps: [{ name: 'Messenger', bytes: 188e9 }], unnamed: [], totalBytes: 128e9, usedBytes: 125e9, warnings: [] });
    expect(fixed.apps[0].bytes).toBe(1_880_000_000);
  });

  it('rétablit la virgule perdue sur les Mo (7143Mo = 714,3 Mo) et départage deux captures par vote', () => {
    expect(parseSizeText('7143Mo')).toBe(714_300_000);
    expect(parseSizeText('5075 Mo')).toBe(507_500_000);
    expect(parseSizeText('972,2 Mo')).toBe(972_200_000);
    const mk = (bytes: number) => ({ apps: [{ name: 'Snapchat', bytes }], unnamed: [], warnings: [] });
    expect(mergeParsed([mk(7_143_000_000), mk(714_300_000), mk(714_300_000)]).apps[0].bytes).toBe(714_300_000); // 2 voix contre 1
    expect(mergeParsed([mk(521_600_000), mk(521_400_000)]).apps[0].bytes).toBe(521_600_000); // égalité : la plus grande
  });

  it('corrige M lu comme G : 714,3 « Go » est forcément 714,3 Mo sur un téléphone de 128 Go', () => {
    const fixed = repairSizes({
      apps: [
        { name: 'Snapchat', bytes: 714.3e9 },
        { name: 'Spotify', bytes: 507.5e9 },
        { name: 'Photos', bytes: 43.01e9 },
        { name: 'Données système', bytes: 15.7e9 },
      ],
      unnamed: [],
      totalBytes: 128e9,
      usedBytes: 124.79e9,
      warnings: [],
    });
    expect(fixed.apps.map((a) => [a.name, a.bytes])).toEqual([
      ['Snapchat', 714.3e6],
      ['Spotify', 507.5e6],
      ['Photos', 43.01e9],
      ['Données système', 15.7e9],
    ]);
  });

  it('ne touche pas à une grosse app légitime sur un téléphone de grande capacité', () => {
    const fixed = repairSizes({ apps: [{ name: 'Photos', bytes: 143e9 }], unnamed: [], totalBytes: 512e9, usedBytes: 300e9, warnings: [] });
    expect(fixed.apps[0].bytes).toBe(143e9);
  });

  it('ignore les lignes qui ne sont pas des apps et les chiffres des recommandations', () => {
    expect(r.apps.map((a) => a.name)).not.toContain('Sur mon iPhone');
    expect(r.apps.some((a) => a.bytes === 774_800_000)).toBe(false);
    expect(r.apps.some((a) => a.bytes === 26_440_000_000)).toBe(false);
  });

  it('garde une taille dont le nom est illisible, à nommer à la main', () => {
    expect(r.unnamed).toEqual([986_200_000]);
  });

  it('retient la dernière utilisation de chaque app', () => {
    expect(byName('Messenger')?.bytes).toBe(188e9); // virgule perdue : corrigée ensuite par repairSizes, avec la capacité
    expect(byName('Messenger')?.lastUsed).toBe('Hier');
    expect(byName('Instagram')?.lastUsed).toBe("Aujourd'hui");
  });
});

describe('noms et dates', () => {
  it('ramène un nom mal lu vers l’app connue la plus proche', () => {
    expect(canonicalName('TikKTok')).toBe('TikTok');
    expect(canonicalName('Discore')).toBe('Discord');
    expect(canonicalName('Instagram')).toBe('Instagram');
    expect(canonicalName('Une App Inconnue')).toBe('Une App Inconnue');
    expect(canonicalName('Mail')).toBe('Mail'); // trop court pour être corrigé
  });

  it('comprend les dates affichées par iOS', () => {
    const now = Date.UTC(2026, 9, 6);
    expect(staleness('29/09/2026', now)).toBe('recent');
    expect(staleness('20/06/2026', now)).toBe('old');
    expect(staleness('Avant-hier', now)).toBe('recent');
  });
});
