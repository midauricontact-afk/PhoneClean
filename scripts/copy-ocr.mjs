// Copie le moteur OCR (Tesseract) et le modèle français dans public/ocr, pour que l'app
// les serve elle-même : aucune requête vers un serveur tiers, et ça marche hors ligne.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'ocr');
mkdirSync(join(out, 'lang'), { recursive: true });

// Tesseract.js choisit à l'exécution la variante du moteur adaptée au téléphone (SIMD, relaxed SIMD…) :
// on copie donc toutes les variantes, sans en deviner la liste.
const coreDir = join(nm, 'tesseract.js-core');
const cores = existsSync(coreDir) ? readdirSync(coreDir).filter((f) => /^tesseract-core.*\.wasm\.js$/.test(f)) : [];
if (cores.length < 4) throw new Error('Moteur OCR introuvable ou incomplet (lance « npm install »).');

const files = [
  [join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js')],
  [join(nm, '@tesseract.js-data', 'fra', '4.0.0_best_int', 'fra.traineddata.gz'), join(out, 'lang', 'fra.traineddata.gz')],
  ...cores.map((f) => [join(coreDir, f), join(out, f)]),
];

for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`Fichier OCR introuvable : ${from} (lance « npm install »)`);
  cpSync(from, to);
}
console.log(`OCR copié dans public/ocr (${files.length} fichiers, dont ${cores.length} variantes du moteur)`);
