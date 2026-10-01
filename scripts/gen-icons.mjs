#!/usr/bin/env node
/**
 * Application icon generator (PLAN.md 0.1, M8).
 *
 * The app ships no image files. This script *draws* the icon from the same
 * primitives `gen-cat.mjs` uses for the cat - a dark outline, a light field, two
 * sockets with pupils - so the icon and the pet cannot drift apart, and so nothing
 * under `src/` is ever a binary of unknown provenance.
 *
 * Output goes to `build/icon/`, which is gitignored. electron-builder is pointed
 * at that directory in electron-builder.yml; nothing generated here is committed.
 *
 *   node scripts/gen-icons.mjs            # png + icns + ico into build/icon
 *   node scripts/gen-icons.mjs --png-only
 *
 * Format notes:
 *  - ICO and ICNS both carry PNG payloads rather than BMP. Windows has read
 *    PNG-in-ICO since Vista and macOS 10.7 accepts PNG chunks in an icns, which
 *    means one encoder covers every size we need. electron-builder converts them
 *    anyway during packaging; these exist so a plain `electron .` run has an icon.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './lib/pixel.mjs';
import { encodePNG } from './lib/png.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'build/icon');
const pngOnly = process.argv.includes('--png-only');

// ---------------------------------------------------------------------------
// The icon, drawn on a 32x32 grid and scaled up
// ---------------------------------------------------------------------------

const GRID = 32;

const INK = [32, 26, 30];
const FUR = [236, 152, 74]; // ginger, so the icon reads at 16px
const FUR_LIGHT = [246, 197, 131];
const PATCH = [58, 52, 58];
const BG = [246, 242, 234];
const BG_EDGE = [214, 206, 196];
const PUPIL = [24, 20, 26];
const SHINE = [255, 255, 255];

/**
 * A whole head, not the 48x48 sitting pose: at 16px an icon has about eight
 * pixels of width, and a body disappears. A head is the only silhouette that
 * survives being scaled to a dock or a taskbar.
 */
function iconGrid() {
  const g = P.makeGrid(GRID, GRID);

  // Rounded-square plate, so the icon is legible on both light and dark desktops.
  P.ellipse(g, GRID / 2, GRID / 2, 15, 15, 'B');
  P.ellipse(g, GRID / 2, GRID / 2, 14.2, 14.2, 'L');

  const hx = GRID / 2;
  const hy = 17;

  // Ears first, so the skull hides their bases.
  P.triangle(g, hx - 9, hy - 12, hx - 2, hy - 5, hx - 10, hy - 1, 'B');
  P.triangle(g, hx + 9, hy - 12, hx + 2, hy - 5, hx + 10, hy - 1, 'B');
  P.ellipse(g, hx, hy, 10.5, 9, 'B');
  P.triangle(g, hx - 7.5, hy - 9, hx - 4.5, hy - 5.5, hx - 8.5, hy - 3, 'N', true);
  P.triangle(g, hx + 7.5, hy - 9, hx + 4.5, hy - 5.5, hx + 8.5, hy - 3, 'N', true);

  // Muzzle and brow marking. At 16px the brow is the only thing that separates
  // "cat" from "panda", so it earns its two pixels.
  P.ellipse(g, hx, hy + 6, 6, 4.4, 'L', true);
  P.ellipse(g, hx, hy - 6, 7, 2.6, 'P', true);
  P.ellipse(g, hx, hy + 3.6, 1.6, 1.2, 'N', true); // nose

  // Sockets: 5x5 rim, 3x3 white, 2-cell pupil with a one-cell shine. Same sizing
  // rule as the sprite art, so the icon's eyes and the cat's eyes match.
  for (const ex of [hx - 5, hx + 5]) {
    P.ellipse(g, ex, hy, 2.8, 2.8, 'K', true);
    P.ellipse(g, ex, hy, 2.1, 2.1, 'W', true);
    P.ellipse(g, ex + 0.4, hy + 0.4, 1.1, 1.1, 'E', true);
    P.set(g, Math.round(ex - 0.8), Math.round(hy - 1), 'e');
  }

  P.outline(g, 'K');
  return g;
}

/** Char -> RGBA for the icon only. Slot letters here are icon-local. */
const CHAR_COLOR = {
  K: INK,
  B: BG,
  L: BG_EDGE,
  W: FUR,
  P: PATCH,
  E: PUPIL,
  e: SHINE,
  N: FUR_LIGHT,
};

/**
 * Render at an exact pixel size.
 *
 * Rasterised at SS times the grid and then point-sampled down, rather than
 * scaling the grid by a whole-number factor: 16 and 48 are not multiples of the
 * 32-cell grid, and `Math.round(size / GRID)` would emit a 32px "16px" icon.
 */
const SS = 16;

function render(size) {
  const big = GRID * SS;
  const grid = iconGrid();

  // Supersample to RGBA first, then resolve to the requested size. Alpha is
  // averaged rather than point-sampled, which is what keeps the ears from
  // disappearing at 16px.
  const acc = new Float32Array(big * big * 4);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const ch = P.get(grid, x, y);
      const color = ch === '.' ? null : CHAR_COLOR[ch];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          if (!color) continue;
          acc[i] = color[0];
          acc[i + 1] = color[1];
          acc[i + 2] = color[2];
          acc[i + 3] = 255;
        }
      }
    }
  }

  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor((y * big) / size);
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * big) / size);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const py = y0 + (Math.floor((sy * big) / (size * SS)) % SS);
          const px = x0 + (Math.floor((sx * big) / (size * SS)) % SS);
          const i = (py * big + px) * 4;
          if (acc[i + 3] === 0) continue;
          r += acc[i];
          g += acc[i + 1];
          b += acc[i + 2];
          a += acc[i + 3];
          n++;
        }
      }
      const d = (y * size + x) * 4;
      if (n === 0) continue;
      rgba[d] = Math.round(r / n);
      rgba[d + 1] = Math.round(g / n);
      rgba[d + 2] = Math.round(b / n);
      rgba[d + 3] = Math.round(a / n);
    }
  }
  return { W: size, rgba };
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/**
 * ICO with PNG payloads.
 *
 * Layout: 6-byte header, one 16-byte directory entry per image, then the
 * payloads. Width and height are 0 for 256, which is the legacy way of saying
 * "256" in a single byte.
 */
function buildICO(sizes) {
  const images = sizes.map((s) => {
    const { W, rgba } = render(s);
    return { size: s, png: encodePNG(W, W, rgba) };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach((img, i) => {
    const at = i * 16;
    dir[at] = img.size >= 256 ? 0 : img.size;
    dir[at + 1] = img.size >= 256 ? 0 : img.size;
    dir[at + 2] = 0; // palette
    dir[at + 3] = 0; // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(img.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.png.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

/**
 * ICNS with PNG chunks.
 *
 * Chunk types are keyed by pixel size, and the length field covers the 8-byte
 * header as well as the payload. Only the sizes that exist on modern macOS are
 * emitted; anything else is ignored by AppKit.
 */
function buildICNS(sizes) {
  // Type letters are keyed by pixel size. Only the sizes that exist on modern
  // macOS are emitted; AppKit ignores chunks it does not recognise.
  const TYPES = { 16: 'icp4', 32: 'icp5', 128: 'ic07', 256: 'ic08', 512: 'ic09' };

  const chunks = [];
  for (const size of sizes) {
    const type = TYPES[size];
    if (!type) continue;
    const { W, rgba } = render(size);
    const png = encodePNG(W, W, rgba);
    // The chunk's length field covers its own 8-byte header, which is only known
    // once the payload length is - hence the two-step write.
    const chunk = Buffer.alloc(8 + png.length);
    chunk.write(type, 0, 'ascii');
    chunk.writeUInt32BE(chunk.length, 4);
    png.copy(chunk, 8);
    chunks.push(chunk);
  }

  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + chunks.reduce((s, c) => s + c.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
const written = [];

const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512];
for (const size of PNG_SIZES) {
  const { W, rgba } = render(size);
  writeFileSync(resolve(outDir, `icon-${size}.png`), encodePNG(W, W, rgba));
  written.push(`icon-${size}.png (${W}x${W})`);
}

if (!pngOnly) {
  writeFileSync(resolve(outDir, 'icon.ico'), buildICO([16, 32, 48, 64, 128, 256]));
  written.push('icon.ico');
  writeFileSync(resolve(outDir, 'icon.icns'), buildICNS([16, 32, 128, 256, 512]));
  written.push('icon.icns');
}

console.log(`[gen-icons] wrote ${written.length} files to build/icon/`);
for (const w of written) console.log(`  ${w}`);
console.log('[gen-icons] none of these are committed - build/ is gitignored.');

/**
 * Print the icon to the terminal, the same way `preview.mjs` does for the cat.
 *
 * The icon has to be reviewable in text, because that is the only way it can be
 * reviewed by someone - or something - that cannot view a PNG. `npm run icons:preview`.
 */
if (process.argv.includes('--preview')) {
  const RAMP = {
    K: '#', // outline
    B: ' ', // plate
    L: ':', // plate edge
    W: '\u2591', // fur
    P: '@', // brow marking
    E: 'O', // pupil
    e: '*', // shine
    N: '\u25e2', // inner ear
  };
  const grid = iconGrid();
  console.log(`\nICON ${GRID}x${GRID}`);
  console.log('legend: # outline  (blank) plate  : plate edge  \u2591 fur  @ marking  O pupil\n');
  for (let y = 0; y < GRID; y++) {
    let row = '';
    for (let x = 0; x < GRID; x++) {
      const ch = P.get(grid, x, y);
      row += ch === '.' ? ' ' : (RAMP[ch] ?? '?');
    }
    console.log(row);
  }
}
