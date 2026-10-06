import { alignRows, type OcrLine } from '../core/ocrLayout';
import { mergeParsed, parseStorageText, repairSizes, type ParsedStorage } from '../core/ocrParse';

/**
 * Lecture des captures d'écran « Stockage iPhone » par OCR (Tesseract, en français).
 * Le moteur et le modèle sont servis par l'app elle-même (dossier ocr/) : l'image ne quitte jamais le téléphone.
 *
 * Trois passes par capture, chacune réglée sur ce qu'elle doit lire :
 *  1. la colonne des noms (sans les icônes, qui seraient lues comme du texte) ;
 *  2. la colonne des tailles, agrandie et réduite à des chiffres (le texte gris est trop pâle pour une lecture normale) ;
 *  3. l'en-tête « X Go sur Y Go ».
 * Les tailles sont ensuite associées aux noms par leur position verticale (voir core/ocrLayout.ts).
 */

const MAX_PIXELS = 12_000_000; // limite de surface d'un canvas sur iOS : on reste en dessous
const TARGET_WIDTH = 1500;

// Positions des colonnes, en part de la largeur de la capture (mesurées sur une vraie capture iPhone).
const NAME_COLUMN = { from: 0.16, to: 0.66 };
const SIZE_COLUMN = { from: 0.62, to: 0.92 };
const HEADER_HEIGHT = 0.3;
const SIZE_SCALE = 2;
const SIZE_WHITELIST = '0123456789,.GMKTo ';

/** Prépare l'image pour l'OCR : niveaux de gris, texte sombre sur fond clair (inversion si mode sombre). */
export async function prepareForOcr(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(2, Math.max(0.5, TARGET_WIDTH / bmp.width));
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const invert = sum / (d.length / 4) < 128;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function crop(src: HTMLCanvasElement, x0: number, y0: number, w: number, h: number, scale = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height);
  return c;
}

/** Noir et blanc par seuil d'Otsu : le texte gris devient franchement noir sur fond blanc. */
function binarize(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  const total = d.length / 4;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface RecognizeData {
  text: string;
  blocks?: { paragraphs: { lines: { text: string; bbox: { y0: number; y1: number } }[] }[] }[] | null;
}

function linesOf(data: RecognizeData, divisor = 1): OcrLine[] {
  const out: OcrLine[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) out.push({ text: l.text, y0: l.bbox.y0 / divisor, y1: l.bbox.y1 / divisor });
    }
  }
  return out;
}

export interface OcrResult {
  name: string;
  text: string;
  parsed: ParsedStorage;
}

export type OcrProgress = (info: { index: number; total: number; label: string; ratio: number }) => void;

export async function readScreenshots(files: File[], onProgress?: OcrProgress): Promise<{ results: OcrResult[]; merged: ParsedStorage }> {
  const { createWorker, PSM } = await import('tesseract.js');
  const base = new URL('./ocr/', document.baseURI).href.replace(/\/$/, '');
  let current = 0;
  let step = 0;
  const STEPS = 3;
  const report = (label: string, ratio = 0) => onProgress?.({ index: current, total: files.length, label, ratio: (step + ratio) / STEPS });

  report('Préparation de la lecture…');
  const worker = await createWorker('fra', 1, {
    workerPath: `${base}/worker.min.js`,
    corePath: base,
    langPath: `${base}/lang`,
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') report(`Lecture de la capture ${current + 1} sur ${files.length}…`, m.progress);
    },
  });
  try {
    const results: OcrResult[] = [];
    for (current = 0; current < files.length; current++) {
      const label = `Lecture de la capture ${current + 1} sur ${files.length}…`;
      const canvas = await prepareForOcr(files[current]);
      const W = canvas.width;
      const H = canvas.height;

      // 1. Noms (et « Dernière utilisation »), sans la colonne des icônes.
      step = 0;
      report(label);
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1', tessedit_char_whitelist: '' });
      const nameRes = await worker.recognize(crop(canvas, NAME_COLUMN.from * W, 0, (NAME_COLUMN.to - NAME_COLUMN.from) * W, H), {}, { text: true, blocks: true });

      // 2. Tailles : colonne de droite agrandie, chiffres et unités seulement.
      step = 1;
      report(label);
      await worker.setParameters({ tessedit_char_whitelist: SIZE_WHITELIST });
      const sizeCanvas = binarize(crop(canvas, SIZE_COLUMN.from * W, 0, (SIZE_COLUMN.to - SIZE_COLUMN.from) * W, H, SIZE_SCALE));
      const sizeRes = await worker.recognize(sizeCanvas, {}, { text: true, blocks: true });

      // 3. En-tête : « 124,79 Go sur 128 Go utilisé(s) ».
      step = 2;
      report(label);
      await worker.setParameters({ tessedit_char_whitelist: '' });
      const headRes = await worker.recognize(crop(canvas, 0, 0, W, H * HEADER_HEIGHT));

      const layout = alignRows(linesOf(nameRes.data as RecognizeData), linesOf(sizeRes.data as RecognizeData, SIZE_SCALE));
      const header = parseStorageText(headRes.data.text);
      let parsed: ParsedStorage = {
        apps: layout.apps,
        unnamed: layout.unnamed,
        usedBytes: header.usedBytes,
        totalBytes: header.totalBytes,
        warnings: [],
      };

      // Secours : mise en page inhabituelle (autre version d'iOS…) → lecture simple de toute la capture.
      let fallbackText = '';
      if (parsed.apps.length + parsed.unnamed.length === 0) {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        const whole = await worker.recognize(canvas);
        fallbackText = `\n--- Lecture complète (secours) ---\n${whole.data.text}`;
        const simple = parseStorageText(whole.data.text);
        parsed = { ...simple, usedBytes: header.usedBytes ?? simple.usedBytes, totalBytes: header.totalBytes ?? simple.totalBytes };
      }

      results.push({
        name: files[current].name,
        text: `--- Noms ---\n${nameRes.data.text}\n--- Tailles ---\n${sizeRes.data.text}\n--- En-tête ---\n${headRes.data.text}${fallbackText}`,
        parsed,
      });
    }
    return { results, merged: repairSizes(mergeParsed(results.map((r) => r.parsed))) };
  } finally {
    await worker.terminate();
  }
}
