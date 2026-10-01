#!/usr/bin/env node
/**
 * Terminal preview of the generated cat, for art review without an image viewer.
 *   node scripts/preview.mjs [animation] [frameCount]
 * Requires `node scripts/gen-cat.mjs` to have been run first.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(resolve(root, '.art/review/nunu.json'), 'utf8'));
const { anims, grid } = data;

const which = process.argv[2] ?? 'idle';
const maxFrames = Number(process.argv[3] ?? 4);
if (!anims[which]) {
  console.error(`animations: ${Object.keys(anims).join(', ')}`);
  process.exit(1);
}
const frames = anims[which].frames.slice(0, maxFrames);

// A shading ramp, so the silhouette and form are readable as plain text.
const RAMP = {
  '.': ' ',
  K: '#', // outline
  B: '\u2591', // body
  b: '\u2592', // body shadow
  L: '.', // light
  W: '*', // white
  P: '@', // patch1
  p: '%', // patch2
  E: 'O', // eye
  e: 'o', // shine
  N: '~', // pink
  S: 's', // effect
  T: '#', // prop
};
const remap = (row) => [...row].map((c) => RAMP[c] ?? '?').join('');

const gutter = 4;
const W = grid.w;
console.log(`\n${which.toUpperCase()}  ${W}x${grid.h} per frame, ${frames.length} shown`);
console.log('legend: # outline  \u2591 body  \u2592 shadow  . light  * white  @ patch1  ~ pink\n');

for (let y = 0; y < grid.h; y++) {
  console.log(frames.map((f) => remap(f[y])).join(' '.repeat(gutter)));
}
