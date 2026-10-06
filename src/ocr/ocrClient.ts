import { mergeParsed, parseStorageText, type ParsedStorage } from '../core/ocrParse';

/**
 * Lecture des captures d'écran « Stockage iPhone » par OCR (Tesseract, en français).
 * Le moteur et le modèle sont servis par l'app elle-même (dossier ocr/) : l'image ne quitte jamais le téléphone.
 */

const MAX_PIXELS = 12_000_000; // limite de surface d'un canvas sur iOS : on reste en dessous
const TARGET_WIDTH = 1500;

/** Prépare l'image pour l'OCR : niveaux de gris, texte sombre sur fond clair (inversion si mode sombre). */
export async function prepareForOcr(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(2, Math.max(0.5, TARGET_WIDTH / bmp.width));
  scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const mean = sum / (d.length / 4);
  const invert = mean < 128;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
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
  const report = (label: string, ratio: number) => onProgress?.({ index: current, total: files.length, label, ratio });

  report('Préparation de la lecture…', 0);
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
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    const results: OcrResult[] = [];
    for (current = 0; current < files.length; current++) {
      report(`Lecture de la capture ${current + 1} sur ${files.length}…`, 0);
      const canvas = await prepareForOcr(files[current]);
      const { data } = await worker.recognize(canvas);
      results.push({ name: files[current].name, text: data.text, parsed: parseStorageText(data.text) });
    }
    return { results, merged: mergeParsed(results.map((r) => r.parsed)) };
  } finally {
    await worker.terminate();
  }
}
