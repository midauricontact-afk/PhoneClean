// Génère les icônes PNG de l'app (sans dépendance) : node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const C1 = [14, 165, 164]; // turquoise
const C2 = [59, 130, 246]; // bleu

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function background(x, y) {
  const t = Math.min(1, Math.max(0, (x + y) / 2));
  return C1.map((c, i) => Math.round(c + (C2[i] - c) * t));
}

/** Couleur d'un point (coordonnées 0..1). Renvoie [r,g,b,a]. */
function shade(x, y, { rounded }) {
  if (rounded && sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22) > 0) return [0, 0, 0, 0];
  const bg = background(x, y);
  // Téléphone : cadre blanc, écran de la couleur du fond, coche blanche
  if (sdRoundRect(x, y, 0.5, 0.5, 0.17, 0.28, 0.05) > 0) return [...bg, 255];
  if (sdRoundRect(x, y, 0.5, 0.5, 0.135, 0.245, 0.03) > 0) return [255, 255, 255, 255];
  const check = Math.min(sdSegment(x, y, 0.43, 0.5, 0.485, 0.56), sdSegment(x, y, 0.485, 0.56, 0.575, 0.43));
  if (check < 0.022) return [255, 255, 255, 255];
  return [...bg, 255];
}

function render(size, opts) {
  const SS = 4; // suréchantillonnage pour l'anticrénelage
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    data[py * (size * 4 + 1)] = 0; // filtre PNG « none »
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          let x = (px + (sx + 0.5) / SS) / size;
          let y = (py + (sy + 0.5) / SS) / size;
          if (opts.scale) {
            x = 0.5 + (x - 0.5) / opts.scale;
            y = 0.5 + (y - 0.5) / opts.scale;
          }
          const outside = opts.scale && (x < 0 || x > 1 || y < 0 || y > 1);
          const [cr, cg, cb, ca] = outside ? [...background(x, y), 255] : shade(x, y, opts);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const n = SS * SS;
      data[o] = a ? Math.round(r / a) : 0;
      data[o + 1] = a ? Math.round(g / a) : 0;
      data[o + 2] = a ? Math.round(b / a) : 0;
      data[o + 3] = Math.round(a / n);
    }
  }
  return png(size, data);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = [
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  // iOS arrondit lui-même : icône carrée, sans transparence.
  ['apple-touch-icon.png', 180, { rounded: false }],
  // « maskable » : le dessin reste dans la zone sûre centrale (80 %).
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.8 }],
];
for (const [name, size, opts] of files) {
  writeFileSync(join(OUT, name), render(size, opts));
  console.log('écrit', name);
}

writeFileSync(
  join(OUT, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0ea5a4"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <rect x="33" y="22" width="34" height="56" rx="5" fill="#fff"/>
  <rect x="36.5" y="25.5" width="27" height="49" rx="3" fill="url(#g)"/>
  <path d="M43 50 L48.5 56 L57.5 43" fill="none" stroke="#fff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`,
);
console.log('écrit icon.svg');
