import { describe, expect, it } from 'vitest';
import { mergeParsed, parseStorageText, staleness } from '../src/core/ocrParse';
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
