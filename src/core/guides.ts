import { matchApp, normalizeName } from './catalog';
import type { AppEntry } from './ocrParse';
import { staleness } from './ocrParse';
import type { Snapshot } from './snapshots';

/**
 * Nettoyage guidé. Aucune app ne peut en vider une autre : chaque étape est donc une action
 * que TU fais dans l'app concernée ou dans les Réglages. Les gains sont des ESTIMATIONS
 * (part typique de la taille de l'app) ; la vraie mesure vient de ta capture suivante.
 */
export type StepKind = 'in-app' | 'ios' | 'reinstall' | 'offload';

export interface GuideStep {
  id: string;
  kind: StepKind;
  title: string;
  how: string[];
  /** Part typique de la taille de l'app libérée par cette étape (0 = prévention, rien de libéré tout de suite). */
  gain: number;
  /** Les étapes d'un même groupe se recouvrent : on ne compte que la plus grosse. */
  group?: string;
}

export interface AppGuide {
  id: string;
  label: string;
  intro?: string;
  /** Astuce générale iOS, affichée même si l'app n'a pas été vue sur ta capture. */
  general?: boolean;
  steps: GuideStep[];
}

const SETTINGS_STORAGE = 'Réglages › Général › Stockage iPhone';

const offload = (gain = 0.2): GuideStep => ({
  id: 'offload',
  kind: 'offload',
  title: "Décharger l'app",
  how: [
    `Ouvre ${SETTINGS_STORAGE}.`,
    "Touche l'app dans la liste, puis « Décharger l'app ».",
    "Elle disparaît mais garde ses données et ses documents : tu la retrouves telle quelle en la réinstallant.",
    "Libère surtout le « poids » de l'app elle-même, pas ses données.",
  ],
  gain,
  group: 'reset',
});

const reinstall = (gain: number, warning?: string): GuideStep => ({
  id: 'reinstall',
  kind: 'reinstall',
  title: "Supprimer puis réinstaller l'app",
  how: [
    `Ouvre ${SETTINGS_STORAGE}, touche l'app puis « Supprimer l'app ».`,
    "Réinstalle-la depuis l'App Store : elle repart avec un cache vide.",
    warning ?? "Vérifie que tu connais ton mot de passe avant : tu devras te reconnecter.",
  ],
  gain,
  group: 'reset',
});

export const APP_GUIDES: AppGuide[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    steps: [
      {
        id: 'manage',
        kind: 'in-app',
        title: 'Gérer le stockage',
        how: [
          'Ouvre WhatsApp › Réglages (en bas à droite) › Stockage et données › Gérer le stockage.',
          'Touche « Plus de 5 Mo » ou « Transférés plusieurs fois » : ce sont les plus gros fichiers.',
          'Sélectionne-les et supprime-les, ou ouvre une discussion lourde pour la vider de ses médias.',
        ],
        gain: 0.6,
        group: 'data',
      },
      {
        id: 'auto',
        kind: 'in-app',
        title: 'Arrêter le téléchargement automatique',
        how: [
          'WhatsApp › Réglages › Stockage et données › Téléchargement automatique des médias.',
          'Mets Photos, Audio, Vidéos et Documents sur « Jamais ».',
          "Prévention : rien n'est libéré tout de suite, mais ça évite que ça regrossisse.",
        ],
        gain: 0,
      },
      {
        id: 'camera-roll',
        kind: 'in-app',
        title: 'Ne plus enregistrer dans Photos',
        how: [
          "WhatsApp › Réglages › Discussions › « Enregistrer dans Photos » : désactive.",
          'Sans ça, chaque photo reçue est stockée deux fois (WhatsApp + Photos).',
        ],
        gain: 0,
      },
      reinstall(0.7, "Fais d'abord une sauvegarde : WhatsApp › Réglages › Discussions › Sauvegarde › Sauvegarder maintenant. Sans sauvegarde, tu perds tes discussions."),
    ],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    intro: "À ma connaissance, Instagram n'a pas de bouton « vider le cache » sur iPhone : la méthode fiable est de le réinstaller.",
    steps: [
      {
        id: 'save-original',
        kind: 'in-app',
        title: "Ne plus enregistrer les publications sur l'iPhone",
        how: [
          "Dans Instagram › Profil › ☰ › Paramètres : cherche les options « Enregistrer… » (publications originales, stories) et désactive-les.",
          'Les menus changent souvent : utilise la loupe de recherche des paramètres.',
          "Prévention : évite les doublons dans Photos.",
        ],
        gain: 0,
      },
      reinstall(0.8),
      offload(0.15),
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    steps: [
      {
        id: 'cache',
        kind: 'in-app',
        title: 'Libérer de l’espace (vider le cache)',
        how: [
          'TikTok › Profil › ☰ › Paramètres et confidentialité.',
          'Descends à « Cache et données mobiles » (ou « Cache et données cellulaires ») › Libérer de l’espace.',
          'Confirme. C’est sans danger : tes vidéos et ton compte ne bougent pas.',
        ],
        gain: 0.7,
        group: 'data',
      },
      {
        id: 'downloads',
        kind: 'in-app',
        title: 'Supprimer les brouillons et vidéos téléchargées',
        how: ['TikTok › Profil › Brouillons › Sélectionner › Supprimer.', 'Fais pareil pour les vidéos que tu as téléchargées dans tes favoris.'],
        gain: 0.1,
      },
      reinstall(0.85),
    ],
  },
  {
    id: 'snapchat',
    label: 'Snapchat',
    steps: [
      {
        id: 'cache',
        kind: 'in-app',
        title: 'Vider le cache',
        how: [
          'Snapchat › ton avatar › ⚙️ Paramètres.',
          'Descends jusqu’à « Actions du compte » › Vider le cache › Continuer.',
          'Tes Souvenirs et tes conversations sont conservés.',
        ],
        gain: 0.6,
        group: 'data',
      },
      reinstall(0.8, 'Vérifie que tes Souvenirs sont bien sauvegardés dans le cloud de Snapchat avant de supprimer l’app.'),
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    steps: [
      {
        id: 'browser',
        kind: 'in-app',
        title: 'Effacer les données de navigation',
        how: [
          'Facebook › menu ≡ › Paramètres et confidentialité › Paramètres.',
          'Cherche « Navigateur » (dans « Autorisations ») › Effacer vos données de navigation.',
          'Les noms de menus varient selon la version : utilise la loupe en haut des paramètres.',
        ],
        gain: 0.35,
        group: 'data',
      },
      reinstall(0.8),
    ],
  },
  {
    id: 'messenger',
    label: 'Messenger',
    intro: 'Si tu ne trouves pas d’option de stockage dans les paramètres de Messenger, la réinstallation est la méthode la plus sûre.',
    steps: [
      {
        id: 'save',
        kind: 'in-app',
        title: 'Ne plus enregistrer les photos reçues',
        how: ['Messenger › ta photo de profil › cherche « Photos et médias » › désactive « Enregistrer les photos ».', 'Prévention : évite les doublons dans Photos.'],
        gain: 0,
      },
      reinstall(0.8),
      offload(0.15),
    ],
  },
  {
    id: 'telegram',
    label: 'Telegram',
    steps: [
      {
        id: 'cache',
        kind: 'in-app',
        title: 'Vider le cache entier',
        how: [
          'Telegram › Réglages › Données et stockage › Gestion du stockage.',
          'Touche « Vider le cache entier ». Les médias restent disponibles dans le cloud Telegram et se retéléchargent si tu les rouvres.',
        ],
        gain: 0.8,
        group: 'data',
      },
      {
        id: 'keep',
        kind: 'in-app',
        title: 'Limiter la durée de conservation',
        how: ['Dans le même écran, « Conserver les médias » : choisis 3 jours, 1 semaine ou 1 mois.', 'Prévention : Telegram nettoiera tout seul.'],
        gain: 0,
      },
      reinstall(0.85),
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    steps: [
      {
        id: 'downloads',
        kind: 'in-app',
        title: 'Supprimer les vidéos téléchargées',
        how: [
          'YouTube › Bibliothèque › Téléchargements › ⋮ à côté de chaque vidéo › Supprimer.',
          'Désactive aussi les téléchargements intelligents : Profil › Paramètres › Arrière-plan et téléchargements.',
          'Pour YouTube Music : Bibliothèque › Téléchargements.',
        ],
        gain: 0.5,
        group: 'data',
      },
      reinstall(0.85),
    ],
  },
  {
    id: 'spotify',
    label: 'Spotify',
    steps: [
      {
        id: 'cache',
        kind: 'in-app',
        title: 'Supprimer le cache',
        how: ['Spotify › Accueil › ⚙️ Paramètres › Stockage.', 'Touche « Supprimer le cache ».'],
        gain: 0.35,
        group: 'cache',
      },
      {
        id: 'downloads',
        kind: 'in-app',
        title: 'Supprimer les téléchargements',
        how: [
          'Même écran : « Supprimer tous les téléchargements », ou retire les playlists une par une.',
          'Tu peux les retélécharger quand tu as du Wi-Fi.',
        ],
        gain: 0.5,
        group: 'downloads',
      },
      reinstall(0.9),
    ],
  },
  {
    id: 'netflix',
    label: 'Netflix',
    steps: [
      {
        id: 'downloads',
        kind: 'in-app',
        title: 'Supprimer les téléchargements',
        how: [
          'Netflix › Mes téléchargements (ou Plus › Mes téléchargements).',
          'Touche ✏️ Modifier, puis supprime les titres, ou « Supprimer tous les téléchargements » dans les paramètres de l’app.',
        ],
        gain: 0.7,
        group: 'data',
      },
      reinstall(0.9),
    ],
  },
  {
    id: 'primevideo',
    label: 'Prime Video',
    steps: [
      {
        id: 'downloads',
        kind: 'in-app',
        title: 'Supprimer les téléchargements',
        how: ['Prime Video › Téléchargements.', 'Touche l’icône de chaque titre téléchargé › Supprimer le téléchargement (ou « Modifier » pour en choisir plusieurs).'],
        gain: 0.7,
        group: 'data',
      },
      reinstall(0.9),
    ],
  },
  {
    id: 'safari',
    label: 'Safari',
    general: true,
    steps: [
      {
        id: 'data',
        kind: 'ios',
        title: 'Effacer les données de sites web',
        how: [
          'iOS 18 : Réglages › Apps › Safari. Avant : Réglages › Safari.',
          'Descends à « Effacer historique, données de site » › Effacer.',
          'Plus ciblé : Avancé › Données de sites web › Tout supprimer.',
          'Tu seras déconnecté de certains sites.',
        ],
        gain: 0.5,
      },
    ],
  },
  {
    id: 'messages',
    label: 'Messages',
    general: true,
    steps: [
      {
        id: 'keep30',
        kind: 'ios',
        title: 'Conserver les messages 30 jours',
        how: [
          'iOS 18 : Réglages › Apps › Messages. Avant : Réglages › Messages.',
          'Touche « Conserver les messages » › 30 jours (ou 1 an).',
          'Attention : les messages plus anciens seront supprimés définitivement. Sauvegarde ce qui compte avant.',
        ],
        gain: 0.5,
        group: 'msg',
      },
      {
        id: 'attachments',
        kind: 'ios',
        title: 'Supprimer les grosses pièces jointes',
        how: [
          `Ouvre ${SETTINGS_STORAGE} › Messages.`,
          'Regarde « Photos », « Vidéos », « GIF et stickers » › Modifier › supprime les plus lourds.',
          'Plus ciblé : dans une conversation, touche le nom en haut › Photos › sélectionne et supprime.',
        ],
        gain: 0.5,
        group: 'msg',
      },
    ],
  },
  {
    id: 'photos',
    label: 'Photos',
    general: true,
    steps: [
      {
        id: 'trash',
        kind: 'ios',
        title: 'Vider « Supprimés récemment »',
        how: [
          'Photos › Albums › Utilitaires › Supprimés récemment (Face ID demandé).',
          'Sélectionner › Tout supprimer. Sans ça, les photos effacées gardent leur place 30 jours.',
        ],
        gain: 0.08,
      },
      {
        id: 'duplicates',
        kind: 'ios',
        title: 'Fusionner les doublons',
        how: ['Photos › Albums › Utilitaires › Doublons › Fusionner (disponible sur iOS 16 et plus).', "Pour aller plus loin, utilise l'onglet Photos de PhoneClean : doublons, similaires, floues, captures d'écran."],
        gain: 0.05,
      },
      {
        id: 'optimize',
        kind: 'ios',
        title: 'Optimiser le stockage iPhone',
        how: [
          'Réglages › [ton nom] › iCloud › Photos : active « Synchroniser cet iPhone », puis « Optimiser le stockage iPhone ».',
          "Les photos en pleine taille vont dans iCloud (il te faut assez d'espace iCloud, offre payante possible) ; l'iPhone garde des versions légères.",
        ],
        gain: 0.5,
      },
    ],
  },
  {
    id: 'mail',
    label: 'Mail',
    steps: [
      {
        id: 'trash',
        kind: 'in-app',
        title: 'Vider la corbeille et les indésirables',
        how: ['Mail › Boîtes › Corbeille › Modifier › Tout supprimer. Pareil pour « Indésirables ».'],
        gain: 0.1,
      },
      {
        id: 'readd',
        kind: 'ios',
        title: 'Supprimer puis rajouter le compte',
        how: [
          'iOS 18 : Réglages › Apps › Mail › Comptes. Avant : Réglages › Mail › Comptes.',
          'Touche le compte › Supprimer le compte, puis « Ajouter un compte » pour le remettre.',
          'Les mails restent sur le serveur ; seul le cache local est vidé.',
        ],
        gain: 0.6,
        group: 'reset',
      },
    ],
  },
  {
    id: 'gmail',
    label: 'Gmail',
    steps: [
      {
        id: 'sync',
        kind: 'in-app',
        title: 'Réduire les jours de mail synchronisés',
        how: ['Gmail › ☰ › Paramètres › ton compte › « Jours de mail à synchroniser » (ou équivalent) : mets 30 jours.', 'Le cache local du téléphone diminue ; tes mails restent dans Gmail.'],
        gain: 0.4,
        group: 'data',
      },
      {
        id: 'mailsort',
        kind: 'in-app',
        title: 'Faire le ménage de la boîte avec MailSort',
        how: ['Ouvre MailSort : désinscription, tri par expéditeur et mise à la corbeille en masse.', 'Ça libère de la place dans ton compte Google, pas sur l’iPhone.'],
        gain: 0,
      },
      reinstall(0.7),
    ],
  },
  {
    id: 'maps',
    label: 'Google Maps',
    steps: [
      {
        id: 'offline',
        kind: 'in-app',
        title: 'Supprimer les cartes hors connexion',
        how: ['Google Maps › ta photo de profil › Cartes hors connexion.', 'Touche ⋯ à côté de chaque carte › Supprimer.'],
        gain: 0.6,
        group: 'data',
      },
      reinstall(0.8),
    ],
  },
  {
    id: 'chrome',
    label: 'Chrome',
    steps: [
      {
        id: 'cache',
        kind: 'in-app',
        title: 'Effacer les données de navigation',
        how: [
          'Chrome › ⋯ › Paramètres › Confidentialité et sécurité › Effacer les données de navigation.',
          'Coche « Images et fichiers en cache » (et « Cookies » si tu veux aller plus loin) › Effacer.',
        ],
        gain: 0.5,
        group: 'data',
      },
      reinstall(0.8),
    ],
  },
  {
    id: 'discord',
    label: 'Discord',
    intro: "Je n'ai pas trouvé de bouton « vider le cache » fiable dans Discord sur iPhone : la réinstallation est la méthode sûre.",
    steps: [reinstall(0.8), offload(0.15)],
  },
  {
    id: 'podcasts',
    label: 'Podcasts',
    general: true,
    steps: [
      {
        id: 'downloads',
        kind: 'in-app',
        title: 'Supprimer les épisodes téléchargés',
        how: [
          'Podcasts › Bibliothèque › Épisodes téléchargés › Modifier (ou balaie vers la gauche) › Supprimer.',
          "Dans les réglages de Podcasts (Réglages › Apps › Podcasts), active la suppression automatique des épisodes lus.",
        ],
        gain: 0.7,
      },
    ],
  },
  {
    id: 'music',
    label: 'Musique',
    general: true,
    steps: [
      {
        id: 'offline',
        kind: 'ios',
        title: 'Supprimer la musique téléchargée',
        how: [
          `Ouvre ${SETTINGS_STORAGE} › Musique › Modifier › supprime par artiste ou « Toutes les chansons ».`,
          'Ou dans l’app : Bibliothèque › Téléchargé › retire les morceaux.',
          'Réglages › Musique › « Optimiser le stockage » : l’iPhone supprime seul les morceaux peu écoutés.',
        ],
        gain: 0.8,
      },
    ],
  },
  {
    id: 'iosupdate',
    label: 'Mise à jour iOS téléchargée',
    general: true,
    steps: [
      {
        id: 'delete',
        kind: 'ios',
        title: 'Supprimer la mise à jour téléchargée',
        how: [
          `Ouvre ${SETTINGS_STORAGE}.`,
          'Si une ligne « Mise à jour iOS » apparaît, touche-la › Supprimer la mise à jour.',
          'Tu pourras la retélécharger plus tard.',
        ],
        gain: 0.95,
      },
    ],
  },
];

/** Astuces générales qui ne dépendent d'aucune app précise. */
export const GENERIC_TIPS: AppGuide = {
  id: 'generic',
  label: 'Réglages utiles',
  general: true,
  steps: [
    {
      id: 'auto-offload',
      kind: 'ios',
      title: 'Décharger automatiquement les apps inutilisées',
      how: [
        'Réglages › App Store › active « Décharger les apps inutilisées ».',
        "iOS retire seul les apps que tu n'ouvres plus, en gardant leurs données.",
      ],
      gain: 0,
    },
    {
      id: 'reboot',
      kind: 'ios',
      title: 'Redémarrer l’iPhone',
      how: ['Éteins puis rallume l’iPhone : iOS efface une partie de ses fichiers temporaires (« Données système »).', 'Le gain est variable et rarement énorme.'],
      gain: 0,
    },
  ],
};

export const GUIDE_BY_ID = new Map(APP_GUIDES.map((g) => [g.id, g]));

export function stepGainBytes(step: GuideStep, appBytes?: number): number | undefined {
  if (appBytes === undefined) return undefined;
  return Math.round(appBytes * step.gain);
}

export interface PlanStep extends GuideStep {
  key: string;
  gainBytes?: number;
}

export interface PlanItem {
  id: string;
  guide: AppGuide;
  title: string;
  appName?: string;
  appBytes?: number;
  steps: PlanStep[];
  /** Gain maximal estimé en cochant toutes les étapes (sans double comptage). */
  potential: number;
}

const GAIN_CAP = 0.95;

/** Gain estimé d'un ensemble d'étapes : recouvrements comptés une fois, plafonné à 95 % de la taille de l'app. */
export function combinedGain(steps: PlanStep[], appBytes?: number): number {
  if (appBytes === undefined) return 0;
  const groups = new Map<string, number>();
  let sum = 0;
  for (const s of steps) {
    const g = s.gainBytes ?? 0;
    if (s.group) groups.set(s.group, Math.max(groups.get(s.group) ?? 0, g));
    else sum += g;
  }
  for (const v of groups.values()) sum += v;
  return Math.min(sum, Math.round(appBytes * GAIN_CAP));
}

function toItem(guide: AppGuide, app?: AppEntry): PlanItem {
  const steps: PlanStep[] = guide.steps.map((s) => ({
    ...s,
    key: `${guide.id}:${s.id}`,
    gainBytes: stepGainBytes(s, app?.bytes),
  }));
  return {
    id: guide.id,
    guide,
    title: guide.label,
    appName: app?.name,
    appBytes: app?.bytes,
    steps,
    potential: combinedGain(steps, app?.bytes),
  };
}

export interface Plan {
  /** Tes apps (vues sur la capture), triées par gain potentiel. */
  mine: PlanItem[];
  /** Apps jamais ou plus ouvertes depuis longtemps : à décharger. */
  unused: PlanItem[];
  /** Astuces iOS générales (avec un gain si l'app concernée est sur la capture). */
  general: PlanItem[];
  /** Guides des autres apps, utiles si elles sont installées mais pas vues. */
  others: PlanItem[];
}

/** Construit le plan de nettoyage à partir de la dernière capture (ou sans, avec des guides sans chiffres). */
export function buildPlan(snapshot?: Snapshot): Plan {
  const apps = snapshot?.apps ?? [];
  const byGuide = new Map<string, AppEntry>();
  for (const a of apps) {
    const m = matchApp(a.name);
    if (m.guideId && (!byGuide.has(m.guideId) || a.bytes > byGuide.get(m.guideId)!.bytes)) byGuide.set(m.guideId, a);
  }

  const mine: PlanItem[] = [];
  const general: PlanItem[] = [];
  const others: PlanItem[] = [];
  for (const g of APP_GUIDES) {
    const app = byGuide.get(g.id);
    const item = toItem(g, app);
    if (g.general) general.push(item);
    else if (app) mine.push(item);
    else others.push(item);
  }
  general.push(toItem(GENERIC_TIPS));

  const unused: PlanItem[] = [];
  const guided = new Set([...byGuide.values()].map((a) => normalizeName(a.name)));
  for (const a of apps) {
    const st = staleness(a.lastUsed);
    const key = normalizeName(a.name);
    if ((st === 'never' || st === 'old') && a.bytes >= 100e6 && !guided.has(key) && matchApp(a.name).category !== 'system') {
      const guide: AppGuide = {
        id: `unused:${key}`,
        label: a.name,
        intro: st === 'never' ? 'Cette app ne semble jamais avoir été ouverte.' : 'Tu ne sembles plus ouvrir cette app depuis longtemps.',
        steps: [{ ...offload(st === 'never' ? 0.8 : 0.4), title: "Décharger l'app (ou la supprimer si tu n'en as plus besoin)" }],
      };
      unused.push(toItem(guide, a));
    }
  }

  const byPotential = (a: PlanItem, b: PlanItem) => b.potential - a.potential;
  mine.sort(byPotential);
  unused.sort(byPotential);
  general.sort(byPotential);
  return { mine, unused, general, others };
}

/** Gain estimé des étapes cochées, sur tout le plan. Les étapes sans chiffre comptent pour 0. */
export function checkedTotal(plan: Plan, checked: Record<string, boolean>): { gain: number; done: number; total: number } {
  let gain = 0;
  let done = 0;
  let total = 0;
  for (const item of [...plan.mine, ...plan.unused, ...plan.general, ...plan.others]) {
    const on = item.steps.filter((s) => checked[s.key]);
    total += item.steps.length;
    done += on.length;
    gain += combinedGain(on, item.appBytes);
  }
  return { gain, done, total };
}
