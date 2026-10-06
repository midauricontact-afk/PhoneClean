import { ReauthRequiredError, type TokenProvider } from '../auth/googleAuth';
import type { DriveFile, DriveQuota } from '../core/driveAnalysis';

export interface DriveApi {
  about(): Promise<{ email?: string; quota: DriveQuota }>;
  /** Tous les fichiers dont tu es propriétaire (hors corbeille). */
  listFiles(onProgress: (count: number) => void): Promise<DriveFile[]>;
  /** Met à la corbeille. Renvoie les identifiants réellement traités. */
  trash(ids: string[], onProgress: (done: number, total: number) => void): Promise<string[]>;
  /** Vide la corbeille Drive : suppression DÉFINITIVE de ce qui s'y trouve. */
  emptyTrash(): Promise<void>;
}

export class DriveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DriveApiError';
  }
}

const API = 'https://www.googleapis.com/drive/v3';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(16_000, 1000 * 2 ** attempt) + Math.random() * 500;

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  quotaBytesUsed?: string;
  md5Checksum?: string;
  parents?: string[];
  modifiedTime?: string;
}

export function toDriveFile(f: RawFile): DriveFile {
  return {
    id: f.id,
    name: f.name,
    mime: f.mimeType,
    size: Number(f.quotaBytesUsed ?? f.size ?? 0) || 0,
    md5: f.md5Checksum,
    parents: f.parents ?? [],
    modified: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
  };
}

export class RealDriveClient implements DriveApi {
  constructor(private readonly auth: TokenProvider) {}

  private async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const token = await this.auth.getToken();
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      if (attempt < 3) {
        await sleep(backoff(attempt));
        return this.request(method, path, body, attempt + 1);
      }
      throw new DriveApiError('Pas de connexion internet', 0);
    }
    if (res.status === 401 && attempt === 0) {
      this.auth.invalidate();
      return this.request(method, path, body, attempt + 1);
    }
    const text = res.status === 204 ? '' : await res.text();
    const rateLimited = res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(text);
    if ((res.status === 429 || res.status >= 500 || rateLimited) && attempt < 5) {
      await sleep(backoff(attempt));
      return this.request(method, path, body, attempt + 1);
    }
    if (!res.ok) {
      if (res.status === 401) throw new ReauthRequiredError();
      let message = `Erreur Google Drive ${res.status}`;
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        /* garde le message par défaut */
      }
      if (res.status === 403 && /insufficient|scope|accessNotConfigured|has not been used|disabled/i.test(text)) {
        message = "Accès à Drive refusé : vérifie que l'API Google Drive est activée et que l'autorisation Drive a bien été cochée.";
      }
      throw new DriveApiError(message, res.status);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async about() {
    const r = await this.request<{
      user?: { emailAddress?: string };
      storageQuota: { limit?: string; usage?: string; usageInDrive?: string; usageInDriveTrash?: string };
    }>('GET', '/about?fields=user(emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)');
    const q = r.storageQuota;
    return {
      email: r.user?.emailAddress,
      quota: {
        limit: q.limit ? Number(q.limit) : undefined,
        usage: Number(q.usage ?? 0),
        usageInDrive: Number(q.usageInDrive ?? 0),
        usageInTrash: Number(q.usageInDriveTrash ?? 0),
      },
    };
  }

  async listFiles(onProgress: (count: number) => void): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: "'me' in owners and trashed = false",
        pageSize: '1000',
        fields: 'nextPageToken,files(id,name,mimeType,size,quotaBytesUsed,md5Checksum,parents,modifiedTime)',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.request<{ files?: RawFile[]; nextPageToken?: string }>('GET', `/files?${params}`);
      for (const f of page.files ?? []) out.push(toDriveFile(f));
      pageToken = page.nextPageToken;
      onProgress(out.length);
    } while (pageToken);
    return out;
  }

  async trash(ids: string[], onProgress: (done: number, total: number) => void): Promise<string[]> {
    const ok: string[] = [];
    let next = 0;
    let done = 0;
    onProgress(0, ids.length);
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          await this.request('PATCH', `/files/${encodeURIComponent(id)}?fields=id`, { trashed: true });
          ok.push(id);
        } catch (e) {
          if (e instanceof ReauthRequiredError) throw e;
          if (e instanceof DriveApiError && e.status === 404) ok.push(id); // déjà supprimé ailleurs
        }
        onProgress(++done, ids.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    return ok;
  }

  async emptyTrash() {
    await this.request('DELETE', '/files/trash');
  }
}
