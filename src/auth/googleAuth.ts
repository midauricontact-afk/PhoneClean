const STORAGE_KEY = 'phoneclean.auth';
const REDIRECT_STATE_KEY = 'phoneclean.oauthState';
/** On renouvelle le jeton 5 minutes avant son expiration. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface StoredAuth {
  accessToken?: string;
  expiresAt?: number;
  email?: string;
}

/** Levée quand Google demande une action de l'utilisateur (un toucher) pour renouveler la session. */
export class ReauthRequiredError extends Error {
  constructor(message = 'Session Google expirée : touche « Reconnecter ».') {
    super(message);
    this.name = 'ReauthRequiredError';
  }
}

export interface TokenProvider {
  getToken(): Promise<string>;
  invalidate(): void;
}

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (typeof google !== 'undefined' && google.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Impossible de charger Google Identity Services (connexion internet ?)'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/**
 * Connexion Google côté navigateur, sans serveur.
 *
 * Google Identity Services ne fournit pas de « refresh token » aux apps sans serveur :
 * le jeton d'accès dure 1 heure. Pour le renouveler sans rien ressaisir, on redemande
 * un jeton en silence (prompt vide + compte déjà choisi) un peu avant l'expiration.
 * Si le navigateur bloque la fenêtre (iPhone hors geste de l'utilisateur), on affiche
 * un bandeau « Reconnecter » : un seul toucher suffit, sans mot de passe.
 */
export class GoogleAuth implements TokenProvider {
  private stored: StoredAuth;
  private tokenClient: google.accounts.oauth2.TokenClient | null = null;
  private waiters: { resolve: (t: string) => void; reject: (e: Error) => void }[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  needsReconnect = false;

  constructor(
    private readonly clientId: string,
    private readonly scopes: string[],
  ) {
    this.stored = readStored();
    this.consumeRedirectResponse();
    this.scheduleRefresh();
  }

  get email(): string | undefined {
    return this.stored.email;
  }

  /** L'utilisateur s'est-il déjà connecté sur cet appareil ? */
  get hasAccount(): boolean {
    return !!this.stored.email || this.hasValidToken();
  }

  setEmail(email: string) {
    this.stored.email = email;
    writeStored(this.stored);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  hasValidToken(marginMs = 60_000): boolean {
    return !!this.stored.accessToken && (this.stored.expiresAt ?? 0) - marginMs > Date.now();
  }

  /** Prépare la bibliothèque Google à l'avance, pour que la fenêtre de connexion s'ouvre au toucher. */
  async prepare(): Promise<void> {
    await loadGis();
    this.tokenClient ??= google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: this.scopes.join(' '),
      include_granted_scopes: true,
      callback: (resp) => this.handleTokenResponse(resp),
      error_callback: (err) => this.handleError(err),
    });
  }

  /**
   * Connexion interactive. Doit être appelée directement depuis un toucher/clic.
   * `consent` force l'écran d'autorisation (première connexion).
   */
  signIn(consent = false): Promise<string> {
    const promise = this.waitForToken();
    if (!this.tokenClient) {
      // La bibliothèque n'est pas prête : on passe par une redirection pleine page.
      this.signInWithRedirect(consent);
      return promise;
    }
    this.tokenClient.requestAccessToken({
      prompt: consent ? 'consent' : this.stored.email ? '' : 'select_account',
      login_hint: this.stored.email,
    });
    return promise;
  }

  async getToken(): Promise<string> {
    if (this.hasValidToken()) return this.stored.accessToken!;
    return this.refresh();
  }

  invalidate() {
    this.stored.accessToken = undefined;
    this.stored.expiresAt = undefined;
    writeStored(this.stored);
  }

  /** Renouvellement silencieux (aucun écran si le compte est déjà autorisé). */
  async refresh(): Promise<string> {
    if (!this.stored.email && !this.stored.accessToken) throw new ReauthRequiredError('Non connecté.');
    await this.prepare();
    const promise = this.waitForToken();
    if (this.waiters.length === 1) {
      this.tokenClient!.requestAccessToken({ prompt: '', login_hint: this.stored.email });
      // Si la fenêtre reste bloquée sans réponse, on n'attend pas indéfiniment.
      setTimeout(() => {
        if (this.waiters.length) this.failWaiters(new ReauthRequiredError());
      }, 45_000);
    }
    return promise;
  }

  /** Variante sans fenêtre : on quitte l'app vers Google puis on revient (utile en mode écran d'accueil). */
  signInWithRedirect(consent = false) {
    const state = crypto.randomUUID();
    sessionStorage.setItem(REDIRECT_STATE_KEY, state);
    const redirectUri = location.origin + location.pathname;
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: this.scopes.join(' '),
      include_granted_scopes: 'true',
      state,
      prompt: consent ? 'consent' : this.stored.email ? 'none' : 'select_account',
    });
    if (this.stored.email) params.set('login_hint', this.stored.email);
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  signOut() {
    const token = this.stored.accessToken;
    if (token && typeof google !== 'undefined') {
      try {
        google.accounts.oauth2.revoke(token);
      } catch {
        /* ignoré */
      }
    }
    clearTimeout(this.refreshTimer);
    this.stored = {};
    localStorage.removeItem(STORAGE_KEY);
    this.needsReconnect = false;
    this.emit();
  }

  private waitForToken(): Promise<string> {
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private handleTokenResponse(resp: google.accounts.oauth2.TokenResponse) {
    if (resp.error || !resp.access_token) {
      this.failWaiters(
        resp.error === 'interaction_required' || resp.error === 'consent_required' || resp.error === 'login_required'
          ? new ReauthRequiredError()
          : new Error(resp.error_description || resp.error || 'Connexion refusée'),
      );
      return;
    }
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...this.scopes)) {
      this.failWaiters(
        new Error("Coche toutes les autorisations demandées par Google (accès à ton Drive)."),
      );
      return;
    }
    this.acceptToken(resp.access_token, Number(resp.expires_in));
  }

  private handleError(err: google.accounts.oauth2.ClientConfigError) {
    if (err.type === 'popup_failed_to_open' || err.type === 'popup_closed') {
      this.failWaiters(new ReauthRequiredError());
    } else {
      this.failWaiters(new Error(err.message || 'Erreur de connexion Google'));
    }
  }

  private acceptToken(token: string, expiresInSec: number) {
    this.stored.accessToken = token;
    this.stored.expiresAt = Date.now() + (expiresInSec || 3600) * 1000;
    writeStored(this.stored);
    this.needsReconnect = false;
    this.scheduleRefresh();
    const waiters = this.waiters.splice(0);
    for (const w of waiters) w.resolve(token);
    this.emit();
  }

  private failWaiters(error: Error) {
    if (error instanceof ReauthRequiredError) this.needsReconnect = true;
    const waiters = this.waiters.splice(0);
    for (const w of waiters) w.reject(error);
    this.emit();
  }

  private scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    if (!this.stored.expiresAt) return;
    const delay = this.stored.expiresAt - REFRESH_MARGIN_MS - Date.now();
    this.refreshTimer = setTimeout(
      () => {
        this.refresh().catch(() => {
          /* le bandeau « Reconnecter » prendra le relais */
        });
      },
      Math.max(delay, 1000),
    );
  }

  private consumeRedirectResponse() {
    if (!location.hash.includes('access_token') && !location.hash.includes('error=')) return;
    const params = new URLSearchParams(location.hash.slice(1));
    const expected = sessionStorage.getItem(REDIRECT_STATE_KEY);
    sessionStorage.removeItem(REDIRECT_STATE_KEY);
    history.replaceState(null, '', location.pathname + location.search);
    if (!expected || params.get('state') !== expected) return;
    const token = params.get('access_token');
    if (token) {
      const granted = (params.get('scope') ?? '').split(' ');
      if (this.scopes.every((s) => granted.includes(s))) {
        this.acceptToken(token, Number(params.get('expires_in') ?? 3600));
      }
    } else if (params.get('error')) {
      this.needsReconnect = !!this.stored.email;
    }
  }
}

function readStored(): StoredAuth {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as StoredAuth;
  } catch {
    return {};
  }
}

function writeStored(s: StoredAuth) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible */
  }
}
