import { FOLDER_MIME, buildIndex, withDescendants, type DriveFile, type DriveQuota } from '../core/driveAnalysis';
import type { DriveApi } from './api';

/** Faux Drive pour essayer l'app sans compte : tout est simulé en mémoire. */
function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const DAY = 86_400_000;

function generate(): DriveFile[] {
  const r = rand(7);
  const now = Date.now();
  const out: DriveFile[] = [];
  let n = 0;
  const folder = (name: string, parent?: string) => {
    const f: DriveFile = { id: `d${++n}`, name, mime: FOLDER_MIME, size: 0, parents: parent ? [parent] : [], modified: now - Math.floor(r() * 900) * DAY };
    out.push(f);
    return f.id;
  };
  const file = (name: string, mime: string, size: number, parent: string, opts: { md5?: string; ageDays?: number } = {}) => {
    out.push({ id: `f${++n}`, name, mime, size, md5: opts.md5, parents: [parent], modified: now - (opts.ageDays ?? Math.floor(r() * 1200)) * DAY });
  };

  const photos = folder('Photos');
  const holidays = folder('Vacances 2022', photos);
  const wedding = folder('Mariage', photos);
  const school = folder('Cours');
  const backup = folder('Sauvegarde téléphone');
  const videos = folder('Vidéos');

  for (let i = 0; i < 40; i++) file(`IMG_${1000 + i}.jpg`, 'image/jpeg', 2_500_000 + Math.floor(r() * 3_000_000), i % 2 ? holidays : wedding, { md5: `photo${i}` });
  for (let i = 0; i < 12; i++) file(`IMG_${1000 + i} (1).jpg`, 'image/jpeg', 2_500_000, backup, { md5: `photo${i}` }); // doublons
  file('Mariage - film complet.mp4', 'video/mp4', 2_400_000_000, videos, { md5: 'film', ageDays: 700 });
  file('Mariage - film complet (copie).mp4', 'video/mp4', 2_400_000_000, backup, { md5: 'film', ageDays: 650 });
  for (let i = 0; i < 6; i++) file(`Clip ${i + 1}.mov`, 'video/quicktime', 150_000_000 + Math.floor(r() * 300_000_000), videos, { ageDays: 500 + i * 40 });
  for (let i = 0; i < 25; i++) file(`Cours ${i + 1}.pdf`, 'application/pdf', 800_000 + Math.floor(r() * 6_000_000), school, { md5: `pdf${i % 20}` });
  file('Ancien projet.zip', 'application/zip', 900_000_000, backup, { ageDays: 1100 });
  file('installer.dmg', 'application/x-apple-diskimage', 450_000_000, backup, { ageDays: 900 });
  for (let i = 0; i < 8; i++) file(`Musique ${i + 1}.mp3`, 'audio/mpeg', 6_000_000 + Math.floor(r() * 5_000_000), backup);
  file('Notes de cours', 'application/vnd.google-apps.document', 0, school);
  return out;
}

export class DemoDriveClient implements DriveApi {
  private files = generate();
  private trashed: DriveFile[] = [
    { id: 'old1', name: 'vieux-film.mkv', mime: 'video/x-matroska', size: 700_000_000, parents: [], modified: 0 },
    { id: 'old2', name: 'brouillon.psd', mime: 'image/vnd.adobe.photoshop', size: 120_000_000, parents: [], modified: 0 },
  ];

  private quota(): DriveQuota {
    const inDrive = this.files.reduce((s, f) => s + f.size, 0);
    const inTrash = this.trashed.reduce((s, f) => s + f.size, 0);
    return { limit: 15e9, usage: inDrive + inTrash + 3_200_000_000, usageInDrive: inDrive + inTrash, usageInTrash: inTrash };
  }

  async about() {
    return { email: 'demo@gmail.com', quota: this.quota() };
  }

  async listFiles(onProgress: (count: number) => void) {
    for (let i = 0; i <= this.files.length; i += 50) {
      await new Promise((r) => setTimeout(r, 40));
      onProgress(Math.min(i, this.files.length));
    }
    return this.files.map((f) => ({ ...f }));
  }

  async trash(ids: string[], onProgress: (done: number, total: number) => void) {
    for (let done = 1; done <= ids.length; done++) {
      await new Promise((r) => setTimeout(r, 15));
      onProgress(done, ids.length);
    }
    // Un dossier emporte son contenu.
    const gone = withDescendants(buildIndex(this.files), ids);
    this.trashed.push(...this.files.filter((f) => gone.has(f.id) && f.mime !== FOLDER_MIME));
    this.files = this.files.filter((f) => !gone.has(f.id));
    return ids;
  }

  async emptyTrash() {
    await new Promise((r) => setTimeout(r, 300));
    this.trashed = [];
  }
}
