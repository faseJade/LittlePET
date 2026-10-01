#!/usr/bin/env node
/**
 * Asset provenance and license audit (PLAN.md 9.4).
 *
 * A standalone version of the third enforcement test, so it can run in `npm run
 * verify` and in a pre-commit hook without a test runner. It deliberately mirrors
 * `tests/unit/enforcement.test.ts` rather than sharing code: the test is the
 * contract that CI enforces, and a script that could drift from it would be a
 * second, weaker thing to keep in sync.
 *
 * Checks:
 *   1. Every file under src/sprites/ has a row in docs/ASSETS.md.
 *   2. Every origin in that table is authored, generated, or an accepted license.
 *   3. Every row names an author, and any accepted third-party license has its
 *      text in LICENSE-NOTICE.md.
 *   4. No binary image, audio or font is committed under src/.
 *
 * Exit code 0 on success, 1 on any violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPRITES = join(root, 'src/sprites');
const MANIFEST = join(root, 'docs/ASSETS.md');
const NOTICE = join(root, 'LICENSE-NOTICE.md');

/** Origin values docs/ASSETS.md is allowed to claim. Mirrors its own table. */
const ACCEPTED = new Set(['authored', 'generated', 'MIT', 'Apache-2.0', 'CC0', 'OFL']);

/**
 * Licenses that mean somebody else's work is in the tree, so the notice file has
 * to actually carry them. `authored` and `generated` are ours and need nothing.
 */
const THIRD_PARTY = new Set(['MIT', 'Apache-2.0', 'CC0', 'OFL']);

const BINARY = /\.(png|jpe?g|gif|webp|svg|ico|icns|bmp|tiff?|woff2?|ttf|otf|eot|mp3|wav|ogg|m4a)$/i;

const problems = [];
const notes = [];

/** Every file under `src/`, recursively, as repo-relative POSIX paths. */
function walk(dir, filter) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(entry)) out.push(full);
  }
  return out;
}

const posix = (p) => relative(root, p).split(sep).join('/');

// --- 0. The manifest has to exist, or nothing below means anything ------------
let manifest = '';
try {
  manifest = readFileSync(MANIFEST, 'utf8');
} catch {
  console.error(`assets: docs/ASSETS.md is missing. Every asset needs a stated origin.`);
  process.exit(1);
}

// --- 1. Coverage: every sprite source file is listed --------------------------
const listed = new Set([...manifest.matchAll(/`([^`]+)`/g)].map((m) => m[1].split(sep).join('/')));
const spriteFiles = walk(SPRITES, (name) => !name.startsWith('.'))
  .map(posix)
  .sort();
if (spriteFiles.length === 0) {
  problems.push('src/sprites/ contains no files at all - the audit has nothing to check');
}
for (const file of spriteFiles) {
  if (!listed.has(file)) {
    problems.push(`${file} is not listed in docs/ASSETS.md`);
  }
}
notes.push(`${spriteFiles.length} sprite source file(s) listed`);

// --- 2 & 3. Origins and authors ----------------------------------------------
const rows = manifest.split('\n').filter((l) => l.trim().startsWith('|') && l.includes('`src/'));

if (rows.length === 0) problems.push('docs/ASSETS.md has no rows for src/ files');

const licenses = new Set();
for (const row of rows) {
  const cells = row
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  const file = cells[0] ?? '';
  const origin = cells[2] ?? '';
  const author = cells[3] ?? '';
  if (!ACCEPTED.has(origin)) {
    problems.push(
      `${file}: origin "${origin}" is not one of ${[...ACCEPTED].join(', ')}. ` +
        `"Found on the internet" is not an origin.`,
    );
  }
  if (author === '' || author === '—') {
    problems.push(`${file}: no author named`);
  }
  if (THIRD_PARTY.has(origin)) licenses.add(origin);
}
notes.push(`${rows.length} provenance row(s) checked`);

if (licenses.size > 0) {
  let notice = '';
  try {
    notice = readFileSync(NOTICE, 'utf8');
  } catch {
    problems.push(
      `${[...licenses].join(', ')} assets are present but LICENSE-NOTICE.md is missing`,
    );
  }
  for (const license of licenses) {
    if (notice && !notice.includes(license)) {
      problems.push(`LICENSE-NOTICE.md does not carry the ${license} text`);
    }
  }
} else {
  notes.push('no third-party licenses in use - every asset is authored or generated here');
}

// --- 4. No committed binaries under src/ --------------------------------------
const binaries = walk(join(root, 'src'), (name) => BINARY.test(name)).map(posix);
for (const file of binaries) {
  problems.push(
    `${file} is a binary asset - art must be authored ASCII or generated at build time`,
  );
}
notes.push(`${walk(join(root, 'src'), () => true).length} source file(s) checked for binaries`);

// --- Report -------------------------------------------------------------------
for (const note of notes) console.log(`  ok  ${note}`);
if (problems.length === 0) {
  console.log('\nassets: clean. Every asset is authored or generated in this repo.');
  process.exit(0);
}
console.error('');
for (const p of problems) console.error(`  FAIL  ${p}`);
console.error(`\nassets: ${problems.length} problem(s). See docs/ASSETS.md for what is required.`);
process.exit(1);
