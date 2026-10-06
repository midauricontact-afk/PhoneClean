import { createContext, useContext } from 'react';
import type { TabId } from '../core/actions';

export interface DialogAction {
  id: string;
  label: string;
  style?: 'default' | 'destructive' | 'cancel' | 'primary';
}

export interface DialogRequest {
  title: string;
  message?: string;
  actions: DialogAction[];
}

export interface UI {
  /** Affiche une boîte de confirmation ; renvoie l'id de l'action choisie (null si annulé). */
  ask(req: DialogRequest): Promise<string | null>;
  goTab(tab: TabId): void;
}

export const UIContext = createContext<UI | null>(null);

export function useUI(): UI {
  const ui = useContext(UIContext);
  if (!ui) throw new Error('UIContext manquant');
  return ui;
}

/** Confirmation standard « Annuler / Action rouge ». */
export async function confirmDestructive(ui: UI, title: string, message: string, label: string): Promise<boolean> {
  const choice = await ui.ask({
    title,
    message,
    actions: [
      { id: 'cancel', label: 'Annuler', style: 'cancel' },
      { id: 'ok', label, style: 'destructive' },
    ],
  });
  return choice === 'ok';
}
