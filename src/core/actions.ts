import type { Plan } from './guides';

export type TabId = 'home' | 'storage' | 'guide' | 'photos' | 'drive' | 'settings';

export interface NextAction {
  id: string;
  title: string;
  detail: string;
  /** Gain estimé en octets (0 = première étape sans chiffre). */
  gain: number;
  tab: TabId;
}

export interface ActionInput {
  hasSnapshot: boolean;
  plan: Plan;
  checked: Record<string, boolean>;
  photos?: { reclaimable: number; count: number };
  drive?: { trashBytes: number; duplicateBytes: number; oldBytes: number };
}

/** Prochaines actions conseillées, des plus rentables aux moins rentables. */
export function buildActions(input: ActionInput, limit = 6): NextAction[] {
  const out: NextAction[] = [];

  for (const item of [...input.plan.mine, ...input.plan.unused, ...input.plan.general]) {
    // On conseille d'abord les gestes doux (vider le cache…) ; supprimer l'app reste le dernier recours.
    const open = item.steps.filter((s) => !input.checked[s.key] && (s.gainBytes ?? 0) > 0);
    const gentle = open.filter((s) => s.kind !== 'reinstall' && s.kind !== 'offload');
    const best = (gentle.length ? gentle : open).sort((a, b) => (b.gainBytes ?? 0) - (a.gainBytes ?? 0))[0];
    if (best) {
      out.push({
        id: best.key,
        title: `${item.appName ?? item.title} : ${best.title.charAt(0).toLowerCase()}${best.title.slice(1)}`,
        detail: 'Nettoyage guidé · gain estimé',
        gain: best.gainBytes ?? 0,
        tab: 'guide',
      });
    }
  }

  if (input.photos && input.photos.reclaimable > 0) {
    out.push({
      id: 'photos',
      title: 'Supprimer les photos en trop',
      detail: `Doublons, similaires, floues, captures : ${input.photos.count.toLocaleString('fr-FR')} éléments proposés`,
      gain: input.photos.reclaimable,
      tab: 'photos',
    });
  }

  if (input.drive) {
    if (input.drive.trashBytes > 0) out.push({ id: 'drive-trash', title: 'Vider la corbeille Google Drive', detail: 'Libère vraiment la place', gain: input.drive.trashBytes, tab: 'drive' });
    if (input.drive.duplicateBytes > 0) out.push({ id: 'drive-dups', title: 'Supprimer les doublons du Drive', detail: 'Fichiers strictement identiques', gain: input.drive.duplicateBytes, tab: 'drive' });
    if (input.drive.oldBytes > 0) out.push({ id: 'drive-old', title: 'Faire le tri des vieux gros fichiers du Drive', detail: 'Modifiés il y a plus d’un an', gain: input.drive.oldBytes, tab: 'drive' });
  }

  out.sort((a, b) => b.gain - a.gain);
  const list = out.slice(0, limit);
  if (!input.hasSnapshot) {
    list.unshift({
      id: 'first-capture',
      title: 'Importer une capture du stockage de ton iPhone',
      detail: 'Pour voir ce qui prend de la place, app par app',
      gain: 0,
      tab: 'storage',
    });
  }
  return list;
}
