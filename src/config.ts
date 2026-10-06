const PLACEHOLDER_MARK = 'REMPLACER';
const CLIENT_ID_KEY = 'phoneclean.clientId';

/** Accès complet à Drive : nécessaire pour mettre à la corbeille des fichiers que l'app n'a pas créés. */
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

/** Adresse de MailSort (partie Gmail), même site, autre dossier. */
export const MAILSORT_URL = 'https://midauricontact-afk.github.io/MailSort/';

function isValidClientId(id: string | null | undefined): id is string {
  return !!id && !id.includes(PLACEHOLDER_MARK) && id.endsWith('.apps.googleusercontent.com');
}

/** Identifiant client OAuth : celui du fichier .env, ou à défaut celui collé dans l'app. */
export function getClientId(): string | null {
  const fromEnv = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (isValidClientId(fromEnv)) return fromEnv;
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (isValidClientId(stored)) return stored;
  } catch {
    /* stockage indisponible */
  }
  return null;
}

export function saveClientId(id: string): boolean {
  const trimmed = id.trim();
  if (!isValidClientId(trimmed)) return false;
  localStorage.setItem(CLIENT_ID_KEY, trimmed);
  return true;
}
