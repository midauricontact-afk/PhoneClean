import { describe, expect, it } from 'vitest';
import { combinePasses, mergeParsed, parseStorageText, staleness } from '../src/core/ocrParse';
import { formatBytes, parseSizeInput, toBytes } from '../src/core/bytes';
import { matchApp, normalizeName } from '../src/core/catalog';

const bytes = (apps: { name: string; bytes: number }[], name: string) => apps.find((a) => a.name === name)?.bytes;

describe('tailles', () => {
  it('convertit en unités décimales comme iOS', () => {
    expect(toBytes('3,2', 'Go')).toBe(3_200_000_000);
    expect(toBytes('450', 'Mo')).toBe(450_000_000);
    expect(toBytes('1.5', 'GB')).toBe(1_500_000_000);
    expect(toBytes('x', 'Go')).toBeNull();
    expect(toBytes('3', 'Zz')).toBeNull();
  });
  it('lit une valeur saisie à la main', () => {
    expect(parseSizeInput('2,5 Go')).toBe(2_500_000_000);
    expect(parseSizeInput('800mo')).toBe(800_000_000);
    expect(parseSizeInput('abc')).toBeNull();
  });
  it('formate en français', () => {
    expect(formatBytes(3_200_000_000)).toBe('3,2 Go');
    expect(formatBytes(450_000_000)).toBe('450 Mo');
    expect(formatBytes(999)).toBe('999 o');
  });
});

describe('analyse OCR — capture « Stockage iPhone »', () => {
  it('lit une capture où nom et taille sont sur la même ligne', () => {
    const text = `Stockage iPhone
iPhone
89,4 Go sur 128 Go utilisés
RECOMMANDATIONS
Décharger les apps inutilisées  Économiser jusqu'à 3,2 Go
Instagram 3,2 Go
Photos 12,4 Go
WhatsApp 1,9 Go
Système iOS 11,3 Go
Données système 8,1 Go`;
    const r = parseStorageText(text);
    expect(r.usedBytes).toBe(89_400_000_000);
    expect(r.totalBytes).toBe(128_000_000_000);
    expect(bytes(r.apps, 'Instagram')).toBe(3_200_000_000);
    expect(bytes(r.apps, 'Photos')).toBe(12_400_000_000);
    expect(bytes(r.apps, 'WhatsApp')).toBe(1_900_000_000);
    expect(bytes(r.apps, 'Système iOS')).toBe(11_300_000_000);
    expect(r.apps.map((a) => a.name)).not.toContain('Décharger les apps inutilisées Économiser jusqu');
    expect(r.apps).toHaveLength(5);
  });

  it('lit le format avec « Dernière utilisation » et la taille sur la ligne du dessous', () => {
    const text = `TikTok
Dernière utilisation : hier
2,1 Go
Snapchat
Dernière utilisation : il y a 3 mois
850 Mo
Jeu Inutile
Jamais utilisée
1,2 Go`;
    const r = parseStorageText(text);
    expect(bytes(r.apps, 'TikTok')).toBe(2_100_000_000);
    expect(bytes(r.apps, 'Snapchat')).toBe(850_000_000);
    expect(bytes(r.apps, 'Jeu Inutile')).toBe(1_200_000_000);
    expect(r.apps.find((a) => a.name === 'Snapchat')?.lastUsed).toBe('il y a 3 mois');
    expect(r.apps.find((a) => a.name === 'Jeu Inutile')?.lastUsed).toBe('jamais');
  });

  it('lit « nom + dernière utilisation + taille » sur une seule ligne', () => {
    const r = parseStorageText('Spotify Dernière utilisation : aujourd’hui 1,4 Go >');
    expect(r.apps).toEqual([{ name: 'Spotify', bytes: 1_400_000_000, lastUsed: 'aujourd’hui' }]);
  });

  it('lit le vrai texte renvoyé par Tesseract (nom + taille, puis « Dernière utilisation » dessous)', () => {
    // Sortie réelle de l'OCR sur une capture simulée : taille alignée à droite avec des espaces.
    const text = [
      'Stockage iPhone', '', 'iPhone', '', '89,4 Go sur 128 Go utilisés',
      'Photos                                       12,4 Go', 'Dernière utilisation : hier',
      'Instagram                                  3,2 Go', 'Dernière utilisation : hier',
      'TikTok                                           2,1 Go', 'Dernière utilisation : il y a 2 jours',
      'Snapchat                              850 Mo', 'Dernière utilisation : il y a 3 mois',
      'Jeu Oublié                                1,2 Go', 'Jamais utilisée',
      'Système iOS                            11,3 Go',
      'Spotify                                640 Mo', 'Dernière utilisation : hier',
    ].join('\n');
    const r = parseStorageText(text);
    expect(r.apps).toHaveLength(7);
    expect(r.apps.find((a) => a.name === 'Jeu Oublié')).toMatchObject({ bytes: 1_200_000_000, lastUsed: 'jamais' });
    expect(r.apps.find((a) => a.name === 'Snapchat')?.lastUsed).toBe('il y a 3 mois');
    expect(r.apps.find((a) => a.name === 'TikTok')?.lastUsed).toBe('il y a 2 jours');
    expect(r.apps.find((a) => a.name === 'Système iOS')?.lastUsed).toBeUndefined();
    expect(r.usedBytes).toBe(89_400_000_000);
  });

  it('corrige les erreurs courantes de l’OCR sur les unités et les symboles', () => {
    const r = parseStorageText(`© Instagram 3,2 G0 >
| Discord 410 M0
e YouTube 95O Ko`);
    expect(bytes(r.apps, 'Instagram')).toBe(3_200_000_000);
    expect(bytes(r.apps, 'Discord')).toBe(410_000_000);
    expect(r.apps.find((a) => a.name === 'YouTube')).toBeUndefined(); // « 95O » illisible : pas de faux chiffre
  });

  it('ignore la légende, les apps à zéro octet et le bruit', () => {
    const r = parseStorageText(`Apps 31,5 Go
Médias 2 Go
Safari Zéro Ko
Netflix 640 Mo`);
    expect(r.apps).toEqual([{ name: 'Netflix', bytes: 640_000_000, lastUsed: undefined }]);
  });

  it('prévient quand rien n’est lu ou quand les chiffres sont incohérents', () => {
    expect(parseStorageText('bla bla').warnings[0]).toMatch(/Aucune application/);
    const r = parseStorageText('10 Go sur 20 Go\nGrosse App 30 Go');
    expect(r.warnings.some((w) => w.includes('dépasse'))).toBe(true);
  });

  it('fusionne plusieurs captures en gardant la plus grande valeur', () => {
    const a = parseStorageText('89 Go sur 128 Go\nInstagram 3 Go\nPhotos 12 Go');
    const b = parseStorageText('Instagram 3,2 Go\nTikTok 2 Go');
    const m = mergeParsed([a, b]);
    expect(m.apps.map((x) => [x.name, x.bytes])).toEqual([
      ['Photos', 12_000_000_000],
      ['Instagram', 3_200_000_000],
      ['TikTok', 2_000_000_000],
    ]);
    expect(m.totalBytes).toBe(128_000_000_000);
  });
});

describe('ancienneté d’utilisation', () => {
  it('distingue jamais / ancienne / récente', () => {
    expect(staleness('jamais')).toBe('never');
    expect(staleness('il y a 3 mois')).toBe('old');
    expect(staleness('il y a 5 jours')).toBe('recent');
    expect(staleness('hier')).toBe('recent');
    expect(staleness('il y a plus d’un an')).toBe('old');
    expect(staleness(undefined)).toBeUndefined();
  });
});

describe('catalogue', () => {
  it('reconnaît les apps connues et leur catégorie', () => {
    expect(matchApp('WhatsApp')).toMatchObject({ guideId: 'whatsapp', category: 'messaging' });
    expect(matchApp('Instagram')).toMatchObject({ guideId: 'instagram', category: 'social' });
    expect(matchApp('Système iOS').category).toBe('system');
    expect(matchApp('Roblox').category).toBe('games');
    expect(matchApp('Une App Inconnue')).toMatchObject({ known: false, category: 'other' });
  });
  it('ne confond pas les noms courts', () => {
    expect(matchApp('Max Fitness').known).toBe(false);
    expect(normalizeName('Données système')).toBe('donnees systeme');
  });
});

describe('lecture d’une vraie capture iPhone (icônes et fragments mal lus)', () => {
  // Lignes réellement renvoyées par l'OCR sur un iPhone : icônes lues comme du texte, « Dernière utilisation » abîmée…
  const text = [
    'Stockage iPhone',
    '125 Go sur 128 Go utilisés',
    'KB                          43,1 Go',
    'vos vidéos                  26,4 Go',
    'KDE                         26 Go',
    'Données système             15,7 Go',
    'Instagram                   10,1 Go',
    'YouTube                     9,3 Go',
    'ae TikTok                   9 Go',
    'Spotify                     5,1 Go',
    'Messenger                   1,9 Go',
    'ER                          1,2 Go',
    'CapCut                      1,1 Go',
    "Lu : Aujourd'hui            986 Mo",
    'Gmail                       972 Mo',
    "utilisation : Aujourd'hui   949 Mo",
    'Oo                          901 Mo',
    'Sur mon iPhone              775 Mo',
    '5 cb RE                     714 Mo',
    'ww                          651 Mo',
    'e ne 0                      527 Mo',
    'Discord                     521 Mo',
    'Google                      501 Mo',
    'PayPal                      476 Mo',
    'Pièces jointes volumineuses 167 Mo',
    'Safari                      48,7 Mo',
    'Ni Snapchat                 43 Mo',
    'e ae                        21,6 Mo',
  ].join('\n');
  const r = parseStorageText(text);
  const names = r.apps.map((a) => a.name);

  it('ne garde que les vraies apps et retire le préfixe d’icône (« ae TikTok » → TikTok)', () => {
    expect(names).toEqual(['Données système', 'Instagram', 'YouTube', 'TikTok', 'Spotify', 'Messenger', 'CapCut', 'Gmail', 'Discord', 'Google', 'PayPal', 'Safari', 'Snapchat']);
    expect(r.apps.find((a) => a.name === 'TikTok')?.bytes).toBe(9_000_000_000);
  });

  it('écarte les fragments de phrases et les recommandations', () => {
    for (const bad of ['vos vidéos', 'Sur mon iPhone', 'Pièces jointes volumineuses', 'Lu : Aujourd\'hui', 'KB', 'KDE', 'ER', 'Oo', 'ww']) {
      expect(names).not.toContain(bad);
    }
  });

  it('signale les grosses tailles dont le nom est illisible, au lieu de les perdre ou de les inventer', () => {
    expect(r.unnamed).toEqual(expect.arrayContaining([43_100_000_000, 26_000_000_000, 1_200_000_000, 986_000_000, 949_000_000, 901_000_000]));
    expect(r.unnamed).not.toContain(775_000_000); // « Sur mon iPhone » est du bruit, pas une app sans nom
    expect(r.unnamed.every((b) => b >= 200e6)).toBe(true);
  });

  it('lit le total de l’espace utilisé', () => {
    expect(r.usedBytes).toBe(125_000_000_000);
    expect(r.totalBytes).toBe(128_000_000_000);
  });
});

describe('recoupement de deux lectures', () => {
  it('garde le nom complet quand le masque a coupé le début, et ne duplique pas les tailles sans nom', () => {
    const masked = parseStorageText('tagram                      10,1 Go\nYouTube                     9,3 Go\nZZ                          1,3 Go');
    const full = parseStorageText('125 Go sur 128 Go utilisés\nInstagram                   10,1 Go\nYouTube                     9,3 Go\nZZ                          1,3 Go');
    const c = combinePasses(masked, full);
    expect(c.apps.map((a) => [a.name, a.bytes])).toEqual([
      ['Instagram', 10_100_000_000],
      ['YouTube', 9_300_000_000],
    ]);
    expect(c.unnamed).toEqual([1_300_000_000]); // vu deux fois, compté une seule fois
    expect(c.usedBytes).toBe(125_000_000_000);
  });
});

describe('défauts vus sur la lecture à deux passes', () => {
  it('ne prend pas un morceau d’en-tête pour une app et retire le préfixe d’icône sur une app connue', () => {
    const masked = parseStorageText(['kage iPhone', 'o sur 128 Go utilisés', 'Photos                 43,1 Go', 'Instagram              10,1 Go'].join('\n'));
    const full = parseStorageText(['Stockage iPhone', '125 Go sur 128 Go utilisés', 'KB Photos              43,1 Go', 'KDE Instagram          10,1 Go'].join('\n'));
    const c = combinePasses(masked, full);
    expect(c.apps.map((a) => a.name)).toEqual(['Photos', 'Instagram']);
    expect(c.apps.some((a) => a.bytes === 128_000_000_000)).toBe(false);
    expect(c.usedBytes).toBe(125_000_000_000);
  });

  it('écarte une taille égale à toute la capacité du téléphone', () => {
    const masked = parseStorageText('Truc                   127 Go\nSpotify                5,1 Go');
    const full = parseStorageText('125 Go sur 128 Go utilisés\nSpotify                5,1 Go');
    expect(combinePasses(masked, full).apps.map((a) => a.name)).toEqual(['Spotify']);
  });
});
