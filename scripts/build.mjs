#!/usr/bin/env node
/**
 * LittlePET build script.
 *
 * Bundles three targets with esbuild:
 *   dist/main/index.js      - Node / CJS, electron + native deps external
 *   dist/preload/index.js   - Node / CJS, electron external
 *   dist/renderer/pet.js    - browser / IIFE, classic <script> so file:// has no module-type issues
 *   dist/renderer/settings.js
 *
 * TypeScript is type-checked separately with `tsc --noEmit`; esbuild does not type-check.
 */
import * as esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/**
 * Native addons must never be bundled - they ship in node_modules and load at
 * runtime. `node:*` needs the wildcard form: `external` takes strings only, not
 * regexes.
 */
const nodeExternal = ['electron', 'uiohook-napi', 'node:*'];

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  minify: !dev,
  target: 'es2022',
  define: { __DEV__: String(dev) },
};

const targets = [
  {
    ...common,
    entryPoints: [resolve(root, 'src/main/index.ts')],
    outfile: resolve(root, 'dist/main/index.js'),
    platform: 'node',
    format: 'cjs',
    external: nodeExternal,
  },
  {
    ...common,
    entryPoints: [resolve(root, 'src/preload/index.ts')],
    outfile: resolve(root, 'dist/preload/index.js'),
    platform: 'node',
    format: 'cjs',
    external: nodeExternal,
  },
  {
    ...common,
    entryPoints: [resolve(root, 'src/renderer/pet/main.ts')],
    outfile: resolve(root, 'dist/renderer/pet.js'),
    platform: 'browser',
    format: 'iife',
  },
  {
    ...common,
    entryPoints: [resolve(root, 'src/renderer/settings/main.ts')],
    outfile: resolve(root, 'dist/renderer/settings.js'),
    platform: 'browser',
    format: 'iife',
  },
];

async function copyStatic() {
  const html = [
    ['src/renderer/pet/index.html', 'dist/renderer/pet.html'],
    ['src/renderer/settings/index.html', 'dist/renderer/settings.html'],
  ];
  for (const [from, to] of html) {
    await cp(resolve(root, from), resolve(root, to));
  }
  // Pattern presets ship as JSON; keep the directory structure the loader expects.
  await mkdir(resolve(root, 'dist/sprites'), { recursive: true });
  await cp(resolve(root, 'src/sprites/patterns'), resolve(root, 'dist/sprites/patterns'), {
    recursive: true,
  });
}

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(ctxs.map((c) => c.watch()));
  await copyStatic();
  console.log('[build] watching...');
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  await copyStatic();
  console.log('[build] done');
}
