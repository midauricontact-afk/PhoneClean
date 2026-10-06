import { dHash, laplacianVariance, type PhotoRecord } from '../core/imageAnalysis';

/**
 * Analyse d'une photo ou d'une vidéo choisie dans le sélecteur iOS, entièrement sur le téléphone.
 * On ne garde que des métadonnées, des empreintes et une petite miniature : jamais le fichier.
 */

const ANALYSIS_SIDE = 320;
const THUMB_SIDE = 180;
const VIDEO_EXT = /\.(mov|mp4|m4v|3gp|webm)$/i;

export interface Analyzed {
  record: PhotoRecord;
  thumb?: Blob;
}

export const fileId = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

const isVideo = (f: File) => f.type.startsWith('video/') || VIDEO_EXT.test(f.name);

/** La date du fichier n'est fiable que si elle n'est pas « maintenant » (conversion à la volée par Safari). */
function takenOf(f: File): number | undefined {
  return Date.now() - f.lastModified > 5 * 60_000 ? f.lastModified : undefined;
}

async function hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sha256 = async (f: Blob) => hex(await f.arrayBuffer());

/** Vidéos : empreinte d'un échantillon (début + fin + taille), sans lire des centaines de Mo. */
async function sampleHash(f: File): Promise<string> {
  const CH = 256 * 1024;
  const head = await f.slice(0, CH).arrayBuffer();
  const tail = f.size > CH ? await f.slice(Math.max(CH, f.size - CH)).arrayBuffer() : new ArrayBuffer(0);
  const meta = new TextEncoder().encode(`${f.size}`);
  const all = new Uint8Array(head.byteLength + tail.byteLength + meta.length);
  all.set(new Uint8Array(head), 0);
  all.set(new Uint8Array(tail), head.byteLength);
  all.set(meta, head.byteLength + tail.byteLength);
  return `v:${await hex(all.buffer)}`;
}

/** Dimensions lues dans l'en-tête JPEG ou PNG (sans décoder l'image). */
export async function readDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  const buf = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf.length > 24) {
    const dv = new DataView(buf.buffer);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}

function grayOf(source: CanvasImageSource, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  return gray;
}

function thumbOf(source: CanvasImageSource, w: number, h: number): Promise<Blob | undefined> {
  const scale = Math.min(1, THUMB_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.72));
}

/** Image réduite pour l'analyse (le fichier d'origine, plusieurs Mo, n'est jamais décodé en entier si on peut l'éviter). */
async function decodeSmall(file: File, dims: { width: number; height: number } | null): Promise<ImageBitmap> {
  if (dims) {
    try {
      const opts = dims.width >= dims.height ? { resizeWidth: ANALYSIS_SIDE } : { resizeHeight: ANALYSIS_SIDE };
      return await createImageBitmap(file, { ...opts, resizeQuality: 'medium' });
    } catch {
      /* repli ci-dessous */
    }
  }
  const full = await createImageBitmap(file);
  const scale = Math.min(1, ANALYSIS_SIDE / Math.max(full.width, full.height));
  const small = await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round(full.width * scale)), resizeQuality: 'medium' });
  full.close();
  return small;
}

async function analyzeImage(file: File, base: PhotoRecord): Promise<Analyzed> {
  const record = { ...base };
  try {
    record.sha = await sha256(file);
  } catch {
    /* fichier trop gros pour la mémoire : pas d'empreinte exacte */
  }
  const dims = await readDimensions(file).catch(() => null);
  const bmp = await decodeSmall(file, dims);
  try {
    const w = bmp.width;
    const h = bmp.height;
    // L'orientation EXIF peut échanger largeur et hauteur : on se fie à ce que le navigateur affiche.
    const swap = dims ? dims.width >= dims.height !== w >= h : false;
    record.width = dims ? (swap ? dims.height : dims.width) : w;
    record.height = dims ? (swap ? dims.width : dims.height) : h;
    const gray = grayOf(bmp, w, h);
    record.phash = dHash(gray, w, h);
    record.blur = Math.round(laplacianVariance(gray, w, h));
    return { record, thumb: await thumbOf(bmp, w, h) };
  } finally {
    bmp.close();
  }
}

const once = (el: HTMLElement, event: string, ms: number) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} timeout`)), ms);
    el.addEventListener(
      event,
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
    el.addEventListener('error', () => reject(new Error('lecture impossible')), { once: true });
  });

async function analyzeVideo(file: File, base: PhotoRecord): Promise<Analyzed> {
  const record = { ...base, kind: 'video' as const };
  record.sha = await sampleHash(file).catch(() => undefined);
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = url;
  try {
    await once(video, 'loadedmetadata', 8000);
    record.duration = Number.isFinite(video.duration) ? Math.round(video.duration) : undefined;
    record.width = video.videoWidth || undefined;
    record.height = video.videoHeight || undefined;
    video.currentTime = Math.min(1, (video.duration || 2) / 2);
    await once(video, 'seeked', 6000);
    const scale = Math.min(1, ANALYSIS_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const gray = grayOf(video, w, h);
    record.phash = dHash(gray, w, h);
    record.blur = Math.round(laplacianVariance(gray, w, h));
    return { record, thumb: await thumbOf(video, w, h) };
  } catch {
    return { record }; // pas de miniature : la taille et la durée restent utiles
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

export async function analyzeFile(file: File): Promise<Analyzed> {
  const base: PhotoRecord = {
    id: fileId(file),
    name: file.name,
    size: file.size,
    type: file.type,
    kind: isVideo(file) ? 'video' : 'image',
    taken: takenOf(file),
    added: Date.now(),
  };
  try {
    return base.kind === 'video' ? await analyzeVideo(file, base) : await analyzeImage(file, base);
  } catch {
    return { record: base }; // format illisible (ex. HEIC sur un vieux navigateur) : on garde au moins les métadonnées
  }
}

export interface RunOptions {
  existing: Set<string>;
  signal?: AbortSignal;
  concurrency?: number;
  onResult: (a: Analyzed) => void | Promise<void>;
  onProgress: (done: number, total: number) => void;
}

/** Analyse par petits lots en laissant respirer l'interface, même avec des centaines de fichiers. */
export async function analyzeFiles(files: File[], opts: RunOptions): Promise<{ analyzed: number; skipped: number }> {
  const todo = files.filter((f) => !opts.existing.has(fileId(f)));
  let next = 0;
  let done = 0;
  opts.onProgress(0, todo.length);
  const worker = async () => {
    while (next < todo.length && !opts.signal?.aborted) {
      const file = todo[next++];
      const result = await analyzeFile(file);
      await opts.onResult(result);
      done++;
      opts.onProgress(done, todo.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 2, todo.length) }, worker));
  return { analyzed: done, skipped: files.length - todo.length };
}
