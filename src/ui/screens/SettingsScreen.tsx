import { MAILSORT_URL } from '../../config';
import { appStore, resetChecklist, setTheme, toast, wipeEverything, type Theme } from '../../state/app';
import { driveStore, signOutDrive } from '../../state/drive';
import { clearPhotos } from '../../state/photos';
import { Disclosure } from '../components/Bits';
import { confirmDestructive, useUI } from '../uiContext';

/** Onglet « Réglages ». */
export function SettingsScreen() {
  const app = appStore.use();
  const drive = driveStore.use();
  const ui = useUI();

  const wipe = async () => {
    if (!(await confirmDestructive(ui, 'Tout effacer ?', 'Captures, historique, analyse des photos et cache Drive seront effacés de ce téléphone. Tes photos et ton Drive ne sont pas touchés.', 'Tout effacer'))) return;
    await clearPhotos();
    if (drive.phase === 'ready') await signOutDrive();
    await wipeEverything();
    toast('Données locales effacées', 'ok');
    setTimeout(() => location.reload(), 600);
  };

  return (
    <>
      <div className="group-title">Apparence</div>
      <div className="card settings">
        <div className="setting">
          <span>Thème</span>
          <div className="segmented small">
            {(
              [
                ['auto', 'Auto'],
                ['light', 'Clair'],
                ['dark', 'Sombre'],
              ] as [Theme, string][]
            ).map(([id, label]) => (
              <button key={id} className={app.theme === id ? 'active' : ''} onClick={() => setTheme(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="group-title">Compte Google</div>
      <div className="card settings">
        <div className="setting">
          <span>Drive</span>
          <span className="muted ellipsis">{drive.phase === 'ready' ? `${drive.email ?? ''}${drive.demo ? ' (démo)' : ''}` : 'non connecté'}</span>
        </div>
        {drive.phase === 'ready' && (
          <button className="setting link" onClick={() => void signOutDrive()}>
            {drive.demo ? 'Quitter la démo' : 'Se déconnecter de Google'}
          </button>
        )}
        <a className="setting link" href={MAILSORT_URL} target="_blank" rel="noopener">
          Ouvrir MailSort (ménage de Gmail)
        </a>
      </div>

      <div className="group-title">Données</div>
      <div className="card settings">
        <button className="setting link" onClick={() => void resetChecklist()}>
          Décocher toute la checklist de nettoyage
        </button>
        <button className="setting link danger" onClick={() => void wipe()}>
          Effacer toutes les données de PhoneClean
        </button>
      </div>

      <div className="group-title">Ce que PhoneClean peut et ne peut pas faire</div>
      <div className="card">
        <Disclosure title="Limites d’iOS, expliquées honnêtement" defaultOpen>
          <ul className="tips-list">
            <li>
              <b>Vider le cache des autres apps : impossible.</b> iOS isole chaque app. PhoneClean te guide donc geste par geste
              (cache, téléchargements, réinstallation) et n’affiche aucun faux bouton « tout vider ».
            </li>
            <li>
              <b>Lire le stockage de l’iPhone : par capture d’écran.</b> Une web app ne peut pas lire ces chiffres ; l’OCR lit ta
              capture sur le téléphone. Tu vérifies et corriges les valeurs avant de les enregistrer.
            </li>
            <li>
              <b>Supprimer des photos : à ta main.</b> Une web app ne peut pas supprimer dans Photos. PhoneClean prépare la liste
              (aperçu, date, taille) et te dit comment faire.
            </li>
            <li>
              <b>Google Drive : vrai nettoyage.</b> Mise à la corbeille en masse (restaurable), puis vidage de la corbeille avec
              double confirmation.
            </li>
            <li>
              <b>Les gains affichés comme « estimés »</b> sont des ordres de grandeur. Seuls les chiffres mesurés (deux captures
              comparées, corbeille Drive vidée) comptent dans « espace déjà gagné ».
            </li>
          </ul>
        </Disclosure>
      </div>

      <p className="footnote">
        Tout est traité sur ton téléphone : la lecture des captures (OCR), l’analyse des photos et le cache. La seule communication
        réseau est celle, facultative, avec ton compte Google pour Drive.
      </p>
    </>
  );
}
