export type AppCategory = 'social' | 'messaging' | 'media' | 'photos' | 'games' | 'tools' | 'system' | 'other';

export interface CategoryInfo {
  id: AppCategory;
  label: string;
  color: string;
}

export const APP_CATEGORIES: CategoryInfo[] = [
  { id: 'social', label: 'Réseaux sociaux', color: '#ec4899' },
  { id: 'messaging', label: 'Messagerie', color: '#3b82f6' },
  { id: 'media', label: 'Musique & vidéo', color: '#f59e0b' },
  { id: 'photos', label: 'Photos', color: '#10b981' },
  { id: 'games', label: 'Jeux', color: '#8b5cf6' },
  { id: 'tools', label: 'Outils', color: '#06b6d4' },
  { id: 'system', label: 'Système', color: '#6b7280' },
  { id: 'other', label: 'Autres', color: '#a3a3a3' },
];

export const CATEGORY_BY_ID = Object.fromEntries(APP_CATEGORIES.map((c) => [c.id, c])) as Record<AppCategory, CategoryInfo>;

/** Minuscules, sans accents ni ponctuation : « Système iOS » → « systeme ios ». */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface KnownApp {
  /** Identifiant du guide de nettoyage (voir guides.ts) quand il existe. */
  id: string;
  category: AppCategory;
  /** Noms normalisés. Un nom court (< 5 lettres) doit correspondre exactement. */
  keys: string[];
}

const KNOWN: KnownApp[] = [
  { id: 'whatsapp', category: 'messaging', keys: ['whatsapp', 'whatsapp business'] },
  { id: 'instagram', category: 'social', keys: ['instagram'] },
  { id: 'tiktok', category: 'social', keys: ['tiktok', 'tik tok'] },
  { id: 'snapchat', category: 'social', keys: ['snapchat'] },
  { id: 'facebook', category: 'social', keys: ['facebook'] },
  { id: 'messenger', category: 'messaging', keys: ['messenger'] },
  { id: 'telegram', category: 'messaging', keys: ['telegram'] },
  { id: 'youtube', category: 'media', keys: ['youtube', 'youtube music'] },
  { id: 'spotify', category: 'media', keys: ['spotify'] },
  { id: 'netflix', category: 'media', keys: ['netflix'] },
  { id: 'primevideo', category: 'media', keys: ['prime video', 'amazon prime video'] },
  { id: 'safari', category: 'tools', keys: ['safari'] },
  { id: 'messages', category: 'messaging', keys: ['messages'] },
  { id: 'photos', category: 'photos', keys: ['photos'] },
  { id: 'mail', category: 'tools', keys: ['mail'] },
  { id: 'gmail', category: 'tools', keys: ['gmail'] },
  { id: 'maps', category: 'tools', keys: ['google maps', 'maps'] },
  { id: 'chrome', category: 'tools', keys: ['chrome', 'google chrome'] },
  { id: 'discord', category: 'messaging', keys: ['discord'] },
  { id: 'podcasts', category: 'media', keys: ['podcasts'] },
  { id: 'music', category: 'media', keys: ['musique', 'music', 'apple music'] },
  { id: 'iosupdate', category: 'system', keys: ['mise a jour ios', 'mise a jour logicielle', 'ios update', 'software update'] },
  // Sans guide dédié : sert seulement à colorer la carte.
  { id: '', category: 'social', keys: ['twitter', 'x', 'reddit', 'pinterest', 'linkedin', 'bereal', 'threads', 'tumblr', 'twitch', 'bluesky'] },
  { id: '', category: 'messaging', keys: ['signal', 'skype', 'teams', 'slack', 'zoom', 'viber', 'line'] },
  { id: '', category: 'media', keys: ['disney', 'deezer', 'canal', 'apple tv', 'tv', 'molotov', 'crunchyroll', 'ocs', 'shazam', 'audible', 'soundcloud'] },
  { id: '', category: 'photos', keys: ['appareil photo', 'camera', 'capcut', 'vsco', 'lightroom', 'snapseed', 'photoshop', 'canva', 'imovie'] },
  {
    id: '',
    category: 'games',
    keys: ['roblox', 'minecraft', 'fortnite', 'clash of clans', 'clash royale', 'brawl stars', 'genshin impact', 'honkai star rail', 'candy crush', 'among us', 'pokemon go', 'call of duty', 'subway surfers', 'mario kart', 'pubg', 'free fire', 'ea sports fc', 'fc mobile', 'gacha life', 'wild rift', 'hearthstone', 'stumble guys'],
  },
  {
    id: '',
    category: 'tools',
    keys: ['fichiers', 'notes', 'drive', 'google drive', 'google', 'plans', 'calendrier', 'contacts', 'rappels', 'telephone', 'wallet', 'dictaphone', 'sante', 'meteo', 'horloge', 'calculette', 'raccourcis', 'livres', 'books', 'icloud drive', 'outlook', 'google docs', 'google sheets', 'translate', 'google traduction', 'amazon', 'leboncoin', 'vinted', 'uber', 'waze'],
  },
  { id: '', category: 'system', keys: ['systeme ios', 'systeme', 'donnees systeme', 'ios', 'system data', 'ios system', 'autre', 'autres'] },
];

export interface AppMatch {
  /** Identifiant du guide ('' s'il n'y en a pas). */
  guideId: string;
  category: AppCategory;
  known: boolean;
}

export function matchApp(name: string): AppMatch {
  const n = normalizeName(name);
  if (!n) return { guideId: '', category: 'other', known: false };
  for (const app of KNOWN) {
    for (const key of app.keys) {
      if (n === key || (key.length >= 5 && (n.startsWith(`${key} `) || n.endsWith(` ${key}`)))) {
        return { guideId: app.id, category: app.category, known: true };
      }
    }
  }
  return { guideId: '', category: 'other', known: false };
}

/** Le nom correspond exactement à une app connue (« Instagram », pas « KDE Instagram »). */
export function isExactKnown(name: string): boolean {
  const n = normalizeName(name);
  return KNOWN.some((app) => app.keys.includes(n));
}

export function categoryOf(name: string): AppCategory {
  return matchApp(name).category;
}

/** Noms d'affichage des apps courantes (la clé normalisée n'a ni majuscules ni accents). */
const DISPLAY: Record<string, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', tiktok: 'TikTok', snapchat: 'Snapchat', facebook: 'Facebook',
  messenger: 'Messenger', telegram: 'Telegram', youtube: 'YouTube', spotify: 'Spotify', netflix: 'Netflix',
  'prime video': 'Prime Video', safari: 'Safari', messages: 'Messages', photos: 'Photos', gmail: 'Gmail',
  'google maps': 'Google Maps', chrome: 'Chrome', discord: 'Discord', podcasts: 'Podcasts', musique: 'Musique',
  twitch: 'Twitch', bereal: 'BeReal', capcut: 'CapCut', paypal: 'PayPal', linkedin: 'LinkedIn', pinterest: 'Pinterest',
  reddit: 'Reddit', 'clash royale': 'Clash Royale', 'clash of clans': 'Clash of Clans', roblox: 'Roblox',
  minecraft: 'Minecraft', fortnite: 'Fortnite', 'pokemon go': 'Pokémon GO', 'brawl stars': 'Brawl Stars',
  'genshin impact': 'Genshin Impact', google: 'Google', outlook: 'Outlook', amazon: 'Amazon', vinted: 'Vinted',
  leboncoin: 'Leboncoin', x: 'X', ios: 'iOS',
};

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/**
 * Nom propre d'une app : « TikKTok » → « TikTok », « Discore » → « Discord ».
 * Un nom qui n'est proche d'aucune app connue est rendu tel quel.
 */
export function canonicalName(name: string): string {
  const n = normalizeName(name);
  if (!n) return name;
  const exact = KNOWN.some((a) => a.keys.includes(n));
  if (exact) return DISPLAY[n] ?? name;
  if (n.length < 5) return name;
  let best: { key: string; d: number } | undefined;
  for (const app of KNOWN) {
    for (const key of app.keys) {
      if (key.length < 5) continue;
      const d = levenshtein(n, key);
      const limit = key.length >= 9 ? 2 : 1;
      if (d <= limit && (!best || d < best.d)) best = { key, d };
    }
  }
  return best ? (DISPLAY[best.key] ?? titleCase(best.key)) : name;
}
