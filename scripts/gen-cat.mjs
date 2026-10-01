#!/usr/bin/env node
/**
 * LittlePET base cat generator ("Nunu").
 *
 * LittlePET's artwork is authored as indexed ASCII (see PLAN.md 6.1) so that
 * fur colour and markings are a *data* operation - that is what makes the
 * "make it look like my cat" feature possible at all.
 *
 * This script is the authoring tool. It draws the base cat from parametric
 * primitives, then emits two things:
 *
 *   1. src/sprites/cats/nunu.ts   - the committed, human-readable source of truth
 *   2. .art/review/nunu.png       - a contact sheet for reviewing every frame
 *
 * Run `npm run cat` after changing anything here, then `npm run preview idle` to
 * read the frames as text. The committed ASCII is what the app loads; the
 * generator only exists so the 19 frames stay visually consistent with each
 * other.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './lib/pixel.mjs';
import { encodePNG } from './lib/png.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GRID_W = 48;
const GRID_H = 48;

/** Preview palette. The app remaps these slots per pattern at runtime. */
const PAL = {
  K: [32, 26, 30],
  B: [232, 228, 220],
  b: [186, 180, 174],
  L: [252, 250, 246],
  W: [255, 255, 255],
  P: [58, 52, 58],
  p: [96, 88, 96],
  E: [24, 20, 26],
  e: [255, 255, 255],
  N: [236, 148, 158],
  S: [255, 120, 120],
  T: [220, 200, 160],
};

// ---------------------------------------------------------------------------
// Pose primitives
// ---------------------------------------------------------------------------

/** Where the light falls, in normalised grid coords. */
const LIGHT = { x: 0.38, y: 0.3 };
/**
 * Distance bands. These need to be wider than instinct suggests: with tight
 * bands the falloff eats whole features (the bib marking vanished entirely at
 * 0.185/0.225). Lit = upper-left, shadow = lower-right, base between.
 */
const LIT_R = 0.27;
const SHADOW_R = 0.44;

function drawTail(g, phase, lift = 0) {
  const sway = Math.sin(phase) * 2;
  // Short, tapered, curling back toward the body. A long straight run reads as
  // a detached stick rather than a tail.
  const pts = [
    [30, 42],
    [39, 45 + lift],
    [44, 40 + lift],
    [41 - sway, 34 + lift],
  ];
  P.curve(g, pts, (t) => 3.4 - t * 2.2, 'B', true);
}

/** Ears go down before the head so the skull covers their bases. */
function drawEars(g, hx, hy, tilt) {
  // A ~9px base leaning outward. Wider than this and the base merges into the
  // skull outline, which reads as a horn instead of an ear.
  P.triangle(g, hx - 9 + tilt, hy - 13, hx - 2, hy - 4, hx - 11 + tilt, hy - 2, 'B');
  P.triangle(g, hx + 9 - tilt, hy - 13, hx + 2, hy - 4, hx + 11 - tilt, hy - 2, 'B');
}

/** Inner ear is roughly half the outer ear, seated on its base. */
function drawEarInners(g, hx, hy, tilt) {
  P.triangle(g, hx - 8 + tilt, hy - 10, hx - 4, hy - 5, hx - 10 + tilt, hy - 3, 'N', true);
  P.triangle(g, hx + 8 - tilt, hy - 10, hx + 4, hy - 5, hx + 10 - tilt, hy - 3, 'N', true);
}

/**
 * Where the eyes are, for the current frame.
 *
 * The art does not draw pupils - the eye layer draws them at runtime, which is
 * what makes blinking and expressions free (PLAN.md 6.3). But the runtime still
 * needs to know where the sockets are, so every pose records them here and the
 * generator emits them next to the frames. `r` is the socket radius in grid
 * cells, which is also the clamp for pupil movement.
 */
let lastEyes = [];

/**
 * Cells belonging to an eye socket in the frame being drawn, as "x,y".
 *
 * `shade2` brightens and deepens everything it considers body, and it considers
 * `W` body - which is right for a bib but wrong for an eyeball. Without this the
 * shading pass paints over the sockets and the cat ends up with lit, flat eyes
 * that the runtime then draws a pupil on top of. Recorded here rather than special
 * cased in the shade pass, so a pose cannot forget to opt out.
 */
let lastEyeCells = new Set();

/**
 * The face is drawn last and always with `over`, because every feature here
 * sits on top of an already-painted skull.
 *
 * Deliberately minimal. At a 48px grid scaled 3x, one-pixel whiskers and a
 * drawn mouth turn into speckle rather than detail, so they are left out.
 *
 * The eyes are the one feature that *has* to be big. Feature 02 draws the pupil
 * at runtime and slides it around inside the socket, so a socket that is entirely
 * pupil has nowhere for the pupil to go - the cat can only stare straight ahead.
 * A 5x5 socket holds a 3px pupil with a cell of travel in every direction, which
 * is the smallest size that still reads as movement.
 */
function drawFace(g, hx, hy) {
  P.ellipse(g, hx, hy + 5, 5, 3.4, 'L', true); // muzzle

  // Sockets: a white eyeball inside a dark rim. The rim is drawn first and slightly
  // larger so the eyeball reads as inset rather than as a sticker.
  for (const ex of [hx - 6, hx + 6]) {
    P.ellipse(g, ex, hy, 2.6, 2.6, 'K', true);
    P.ellipse(g, ex, hy, 1.9, 1.9, 'W', true);
    for (let y = Math.round(hy - 3); y <= Math.round(hy + 3); y++) {
      for (let x = Math.round(ex - 3); x <= Math.round(ex + 3); x++) {
        lastEyeCells.add(`${x},${y}`);
      }
    }
  }
  P.ellipse(g, hx, hy + 4, 1.4, 1, 'N', true); // nose

  // Eye anchors. r is the socket radius in cells, and the eye layer uses it both to
  // size the pupil and as the hard limit on how far the pupil may travel - so the
  // pupil can never slide out of the socket, whatever the cursor does.
  lastEyes = [
    { x: hx - 6, y: hy, r: 2 },
    { x: hx + 6, y: hy, r: 2 },
  ];
}

/**
 * Two-step shading pass: brighten the lit (upper-left) side of the form, then
 * deepen everything in shadow (lower-right). Skips outlines, eyes and props.
 * Markings are included on purpose - the bib and saddle must stay readable.
 */
function shade2(g) {
  const dist = (x, y) =>
    Math.hypot((x - GRID_W * LIGHT.x) / GRID_W, (y - GRID_H * LIGHT.y) / GRID_H);
  const lit = P.shadeWhere(g, (x, y) => dist(x, y) < LIT_R && getIsBody(g, x, y), 'L');
  return P.shadeWhere(lit, (x, y) => dist(x, y) > SHADOW_R && getIsBody(g, x, y), 'b');
}

function getIsBody(g, x, y) {
  if (lastEyeCells.has(`${x},${y}`)) return false;
  const c = P.get(g, x, y);
  return c === 'B' || c === 'L' || c === 'W' || c === 'P';
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

/**
 * Upright sitting cat - the default pose and the base for most reactions.
 * Draw order matters: rear to front, so each shape overlaps the one behind it.
 */
function poseSit({
  headDy = 0,
  headDx = 0,
  tailPhase = 0,
  bodyDy = 0,
  earTilt = 0,
  squash = 0,
} = {}) {
  const g = P.makeGrid(GRID_W, GRID_H);
  // Pixel art: every landmark is snapped to whole pixels so limbs and whiskers
  // land on the grid instead of shimmering between frames.
  const by = Math.round(bodyDy);
  const hx = 22 + Math.round(headDx);
  const hy = 14 + Math.round(headDy) + Math.round(by * 0.3);

  P.ellipse(g, 20, 31 + by, 11, 10.5, 'B'); // torso
  P.ellipse(g, 20, 38 + by, 14 - squash, 7.5 - squash, 'B'); // haunches
  P.ellipse(g, 21, 30 + by, 6.5, 5.5, 'L', true); // chest
  // Bib sits below the chin, or the skull paints over it.
  P.ellipse(g, 20, 29 + by, 5, 4.6, 'P', true);

  // Front legs, drawn over the torso so they read as separate limbs.
  for (const lx of [15, 21]) {
    for (let y = 36 + by; y < 42 + by; y++) {
      P.set(g, lx, y, 'B');
      P.set(g, lx + 1, y, 'B');
    }
    P.ellipse(g, lx + 0.5, 43 + by, 3.4, 2.4, 'L', true);
  }

  // Tail last of the body parts, so it laps over the hindquarters.
  drawTail(g, tailPhase, 0);

  drawEars(g, hx, hy, earTilt);
  P.ellipse(g, hx, hy, 10.5, 8.5, 'B'); // skull last of the masses
  drawEarInners(g, hx, hy, earTilt);
  drawFace(g, hx, hy);

  return P.outline(shade2(g));
}

/** Standing cat on four legs - used for walking and hunting. */
function poseWalk({ t = 0, lean = 0, tailPhase = 0, headDy = 0 } = {}) {
  const g = P.makeGrid(GRID_W, GRID_H);

  drawTail(g, tailPhase, -7);

  // Legs first, so the torso covers their tops.
  const legs = [
    { x: 11, phase: 0.0 },
    { x: 16, phase: 0.5 },
    { x: 24, phase: 0.25 },
    { x: 29, phase: 0.75 },
  ];
  for (const leg of legs) {
    const ph = (t + leg.phase) % 1;
    // Second half of the cycle is the swing, lifted clear of the ground.
    const lift = ph > 0.5 ? Math.sin((ph - 0.5) * Math.PI * 2) * 2.4 : 0;
    const top = 34;
    const len = 11 - lift;
    for (let y = top; y < top + len; y++) {
      P.set(g, leg.x, y, 'B');
      P.set(g, leg.x + 1, y, 'B');
    }
    P.ellipse(g, leg.x + 0.5, top + len, 3, 2.2, 'L', true);
  }

  P.ellipse(g, 20, 29, 12.5, 8.5, 'B'); // torso
  P.ellipse(g, 20, 27, 10.5, 5.5, 'P', true); // saddle marking
  P.ellipse(g, 25, 30, 6, 5.4, 'L', true); // chest

  const hx = 27 + lean;
  const hy = 18 + headDy;
  drawEars(g, hx, hy, 0);
  P.ellipse(g, hx, hy, 9.6, 8.2, 'B');
  drawEarInners(g, hx, hy, 0);
  drawFace(g, hx, hy);

  return P.outline(shade2(g));
}

/** Limbs splayed and body hanging - the frame used while the cat is picked up. */
function poseDangle({ t = 0, tilt = 0 } = {}) {
  const g = P.makeGrid(GRID_W, GRID_H);
  const hx = 21 + Math.round(tilt);
  const hy = 14;

  drawTail(g, t * Math.PI * 2, -9);

  P.ellipse(g, 21, 31, 11, 10, 'B'); // body
  P.ellipse(g, 21, 33, 6.5, 6, 'P', true); // belly marking

  // Hanging legs, splaying further as they swing away from vertical.
  for (const [lx, phase] of [
    [14, 0.0],
    [19, 0.33],
    [26, 0.66],
  ]) {
    const swing = Math.sin((t + phase) * Math.PI * 2) * 2.2;
    for (let i = 0; i < 9; i++) {
      const f = i / 9;
      const x = lx + Math.round(swing * f * f);
      P.set(g, x, 36 + i, 'B');
      P.set(g, x + 1, 36 + i, 'B');
    }
    P.ellipse(g, lx + swing + 0.5, 45, 3, 2.2, 'L', true);
  }

  drawEars(g, hx, hy, tilt);
  P.ellipse(g, hx, hy, 10.5, 8.5, 'B');
  drawEarInners(g, hx, hy, tilt);
  drawFace(g, hx, hy);

  return P.outline(shade2(g));
}

/** Long and low - the stretch, and the frame after being dropped. */
function poseStretch({ amount = 0 } = {}) {
  const g = P.makeGrid(GRID_W, GRID_H);
  const a = amount;

  drawTail(g, 0.4, -13 - a * 4);

  P.ellipse(g, 30, 41, 9, 4, 'B'); // front paws reaching forward
  P.ellipse(g, 12, 42, 8, 3.6, 'B'); // rear paws pushing back
  P.ellipse(g, 20 + a * 2, 35 - a * 2, 11, 9 - a * 1.5, 'B'); // body
  P.ellipse(g, 20 + a * 2, 33 - a * 2, 6.5, 5.5, 'P', true);

  const hx = 27 + a * 4;
  const hy = 21 - a * 3;
  drawEars(g, hx, hy, 0);
  P.ellipse(g, hx, hy, 9.6, 8.2, 'B');
  drawEarInners(g, hx, hy, 0);
  drawFace(g, hx, hy);

  return P.outline(shade2(g));
}

/** Bent over, licking a paw - idle-life variety. */
function poseGroom({ t = 0 } = {}) {
  const g = P.makeGrid(GRID_W, GRID_H);
  const hx = 19;
  const hy = 18 + Math.round(Math.sin(t * Math.PI * 2) * 1);

  drawTail(g, 0.8 + t * 0.2, -5);

  P.ellipse(g, 20, 38, 13.5, 8.5, 'B'); // haunches
  P.ellipse(g, 20, 33, 10.5, 10.5, 'B'); // torso
  P.ellipse(g, 21, 30, 6, 6.4, 'P', true);
  P.ellipse(g, 16, 44, 3.4, 2.4, 'L', true); // planted hind paws
  P.ellipse(g, 25, 44, 3.4, 2.4, 'L', true);

  // One paw brought up to the face, licking it.
  const px = 21 + Math.round(Math.sin(t * Math.PI * 2) * 2);
  P.ellipse(g, px, 25 + Math.round(t * 2), 3, 2.6, 'L', true);

  drawEars(g, hx, hy, 1);
  P.ellipse(g, hx, hy, 10, 8.2, 'B');
  drawEarInners(g, hx, hy, 1);
  drawFace(g, hx, hy);

  return P.outline(shade2(g));
}

/** Up on the hind legs - celebration, and the stretch reminder. */
function poseCheer({ t = 0, armUp = 0 } = {}) {
  const g = P.makeGrid(GRID_W, GRID_H);
  const hx = 21;
  const hy = 14;

  drawTail(g, t * Math.PI * 2, -11);

  P.ellipse(g, 21, 40, 13, 8, 'B'); // haunches
  P.ellipse(g, 21, 31, 10.5, 10.5, 'B'); // torso
  P.ellipse(g, 21, 29, 6.4, 6.8, 'P', true);
  P.ellipse(g, 16, 44, 3.4, 2.4, 'L', true); // planted hind paws
  P.ellipse(g, 26, 44, 3.4, 2.4, 'L', true);

  // Raised forelegs.
  const au = armUp;
  P.ellipse(g, 12 - au * 2, 30 - au * 7, 3.2, 4.4, 'L', true);
  P.ellipse(g, 30 + au * 2, 30 - au * 7, 3.2, 4.4, 'L', true);

  drawEars(g, hx, hy, 0);
  P.ellipse(g, hx, hy, 10.5, 8.5, 'B');
  drawEarInners(g, hx, hy, 0);
  drawFace(g, hx, hy);

  return P.outline(shade2(g));
}

// ---------------------------------------------------------------------------
// Animation table
// ---------------------------------------------------------------------------

const ANIMS = [
  [
    'idle',
    [110, 110, 110, 110],
    [
      () => poseSit({ tailPhase: 0.0, headDy: 0 }),
      () => poseSit({ tailPhase: 0.6, headDy: -0.5, bodyDy: -0.5 }),
      () => poseSit({ tailPhase: 1.2, headDy: 0 }),
      () => poseSit({ tailPhase: 1.8, headDy: 0.5, bodyDy: 0.5 }),
    ],
  ],
  [
    'walk',
    [95, 95, 95, 95],
    [
      () => poseWalk({ t: 0.0 }),
      () => poseWalk({ t: 0.25 }),
      () => poseWalk({ t: 0.5 }),
      () => poseWalk({ t: 0.75 }),
    ],
  ],
  [
    'dangle',
    [110, 110, 110],
    [() => poseDangle({ t: 0 }), () => poseDangle({ t: 0.33 }), () => poseDangle({ t: 0.66 })],
  ],
  ['stretch', [420, 420], [() => poseStretch({ amount: 0 }), () => poseStretch({ amount: 1 })]],
  [
    'groom',
    [260, 260, 260, 260],
    [
      () => poseGroom({ t: 0 }),
      () => poseGroom({ t: 0.25 }),
      () => poseGroom({ t: 0.5 }),
      () => poseGroom({ t: 0.75 }),
    ],
  ],
  [
    'cheer',
    [130, 130],
    [() => poseCheer({ t: 0, armUp: 0 }), () => poseCheer({ t: 0.5, armUp: 1 })],
  ],
];

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/**
 * Run a frame function and return its rows plus the eye anchors it recorded.
 * Frames are pure generators, so calling one twice is harmless.
 */
function render(fn) {
  lastEyes = [];
  lastEyeCells = new Set();
  const rows = P.toRows(fn());
  return { rows, eyes: lastEyes };
}

function emitTS() {
  const parts = [];
  parts.push(`/**
 * Nunu - the LittlePET base cat.
 *
 * GENERATED by scripts/gen-cat.mjs - see docs/art-pipeline.md.
 * Every pixel is a palette SLOT, not a colour. That is what lets the
 * "make it look like my cat" feature work: a pattern is just a colour
 * assignment per slot (PLAN.md 6.2).
 *
 * Grid: ${GRID_W}x${GRID_H}. Eyes are not drawn here - the eye layer draws
 * pupils, shine or closed lids at runtime, so blinking and expressions cost
 * nothing and work over every animation (PLAN.md 6.3).
 *
 * Slot legend: . transparent  K outline  B body  b bodyShadow  L light
 *               W white  P patch1  p patch2  E eye  e eyeShine
 *               N pink  S effect  T prop
 */
import type { CatSprite } from '../compile';
import type { EyeAnchor } from '../../shared/types';

export type { EyeAnchor };
`);

  const eyesByAnim = {};
  for (const [name, durations, frames] of ANIMS) {
    parts.push(`const ${name.toUpperCase()}_DURATIONS = [${durations.join(', ')}];`);
    parts.push(`const ${name.toUpperCase()}_ROWS: readonly string[][] = [`);
    frames.forEach((fn, i) => {
      const rows = P.toRows(fn())
        .map((r) => `    '${r}'`)
        .join(',\n');
      parts.push(`  [\n${rows},\n  ], // frame ${i}`);
    });
    parts.push('];\n');

    parts.push(`const ${name.toUpperCase()}_EYES: readonly EyeAnchor[][] = [`);
    frames.forEach((fn, i) => {
      const { eyes } = render(fn);
      const body = eyes.map((e) => `{ x: ${e.x}, y: ${e.y}, r: ${e.r} }`).join(', ');
      parts.push(`  [${body}], // frame ${i}`);
    });
    parts.push('];\n');

    eyesByAnim[name] = frames.map((fn) => render(fn).eyes);
  }

  parts.push(`/** Frame duration per animation, in milliseconds. */
export const NUNU_DURATIONS: Record<string, readonly number[]> = {
${ANIMS.map(([n]) => `  ${n}: ${n.toUpperCase()}_DURATIONS,`).join('\n')}
};

/** Row data per animation. Characters are palette slots, not colours. */
export const NUNU_ROWS: Record<string, readonly (readonly string[])[]> = {
${ANIMS.map(([n]) => `  ${n}: ${n.toUpperCase()}_ROWS,`).join('\n')}
};

/**
 * Eye sockets per animation, per frame. The eye layer draws pupils here rather
 * than baking them into the art, so blinking and expressions cost nothing and
 * work over every animation (PLAN.md 6.3).
 */
export const NUNU_EYES: Record<string, readonly EyeAnchor[][]> = {
${ANIMS.map(([n]) => `  ${n}: ${n.toUpperCase()}_EYES,`).join('\n')}
};

export const NUNU_GRID = { w: ${GRID_W}, h: ${GRID_H} } as const;

/**
 * The assembled sprite. The compiler takes exactly this shape, so the app, the
 * tests and the art tooling all load the same object rather than each rebuilding
 * it from the three tables above.
 */
export const NUNU: CatSprite = {
  id: 'nunu',
  grid: NUNU_GRID,
  anims: NUNU_ROWS,
  durations: NUNU_DURATIONS,
};
`);

  return parts.join('\n');
}

function contactSheet(scale = 3) {
  const PAD = 4;
  const LABEL = 10;
  const cellW = GRID_W * scale + PAD * 2;
  const cellH = GRID_H * scale + PAD * 2 + LABEL;
  const animRows = [];
  for (const [name, , frames] of ANIMS) animRows.push([name, frames]);
  const maxCols = Math.max(...animRows.map(([, f]) => f.length));
  const W = maxCols * cellW + PAD;
  const H = animRows.length * cellH + PAD;
  const rgba = new Uint8Array(W * H * 4);
  rgba.fill(255);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = 255;

  animRows.forEach(([, frames], row) => {
    frames.forEach((fn, col) => {
      const ox = PAD + col * cellW + PAD;
      const oy = PAD + row * cellH + PAD + LABEL;
      P.paint(rgba, W, H, fn(), ox, oy, scale, PAL);
    });
  });

  // Simple 5x7 bitmap font for the labels.
  const FONT = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    R: ['11110', '10001', '11110', '10100', '10010', '10001', '10001'],
    S: ['01111', '10000', '01110', '00001', '00001', '10001', '01110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  };
  const text = (str, x0, y0, col) => {
    let x = x0;
    for (const chr of str.toUpperCase()) {
      const glyph = FONT[chr] ?? FONT[' '];
      glyph.forEach((line, gy) => {
        [...line].forEach((bit, gx) => {
          if (bit !== '1') return;
          for (let sy = 0; sy < 2; sy++) {
            for (let sx = 0; sx < 2; sx++) {
              const px = x + gx * 2 + sx;
              const py = y0 + gy * 2 + sy;
              const i = (py * W + px) * 4;
              rgba[i] = col[0];
              rgba[i + 1] = col[1];
              rgba[i + 2] = col[2];
              rgba[i + 3] = 255;
            }
          }
        });
      });
      x += 12;
    }
  };

  animRows.forEach(([name], row) => {
    text(name, PAD, PAD + row * cellH, [20, 20, 24]);
  });

  return { W, H, rgba };
}

mkdirSync(resolve(root, '.art/review'), { recursive: true });
mkdirSync(resolve(root, 'src/sprites/cats'), { recursive: true });
writeFileSync(resolve(root, 'src/sprites/cats/nunu.ts'), emitTS());
writeFileSync(
  resolve(root, '.art/review/nunu.json'),
  JSON.stringify(
    {
      grid: { w: GRID_W, h: GRID_H },
      anims: Object.fromEntries(
        ANIMS.map(([name, durations, frames]) => [
          name,
          { durations, frames: frames.map((fn) => P.toRows(fn())) },
        ]),
      ),
    },
    null,
    1,
  ),
);
const sheet = contactSheet();
writeFileSync(resolve(root, '.art/review/nunu.png'), encodePNG(sheet.W, sheet.H, sheet.rgba));
console.log(
  `[gen-cat] wrote src/sprites/cats/nunu.ts and .art/review/nunu.png (${sheet.W}x${sheet.H})`,
);
