// Typage minimal de Google Identity Services (https://accounts.google.com/gsi/client).
declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string;
    expires_in: number | string;
    scope: string;
    token_type: string;
    error?: string;
    error_description?: string;
  }
  interface ClientConfigError {
    type: 'popup_failed_to_open' | 'popup_closed' | 'unknown';
    message?: string;
  }
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: ClientConfigError) => void;
    prompt?: string;
    include_granted_scopes?: boolean;
    login_hint?: string;
  }
  interface OverridableTokenClientConfig {
    prompt?: string;
    login_hint?: string;
    scope?: string;
  }
  interface TokenClient {
    requestAccessToken(overrides?: OverridableTokenClientConfig): void;
  }
  function initTokenClient(config: TokenClientConfig): TokenClient;
  function hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
  function revoke(token: string, done?: () => void): void;
}
