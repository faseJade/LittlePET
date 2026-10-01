import { resolvePalette } from '../../sprites/palette';
import { NUNU, NUNU_EYES } from '../../sprites/cats/nunu';
import {
  CAT_ANCHOR,
  CAT_H,
  CAT_SCALE,
  CAT_W,
  STAGE_H,
  STAGE_W,
  type EyeAnchor,
  type PetSnapshot,
  type Settings,
} from '../../shared/types';
import { Animator } from './animator';
import { BehaviorMachine } from './behavior';
import { DragBehavior } from './behaviors/drag';
import { GroomBehavior } from './behaviors/groom';
import { IdleBehavior } from './behaviors/idle';
import { WalkBehavior } from './behaviors/walk';
import { Context, blankSnapshot } from './context';
import { HitTester } from './hit';
import { Mochi } from './physics/mochi';
import { Atlas } from './render/atlas';
import { Renderer } from './render/draw';

/**
 * The pet renderer (PLAN.md 3).
 *
 * A pure view: it receives input snapshots, simulates, draws, and sends back only
 * commands ("I need clicks", "I'm being dragged"). Everything it needs arrives
 * over the bridge, which is why the same code runs under Playwright with no
 * Electron at all (PLAN.md 9.1).
 *
 * The loop is delta-time driven throughout. Frame counts never enter the
 * simulation, so the cat behaves identically at 60, 120 and 144 Hz.
 */

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const atlas = new Atlas(NUNU);
const renderer = new Renderer(canvas, atlas);
const hit = new HitTester(atlas.layout);
const mochi = new Mochi();
const context = new Context(mochi);
const animator = new Animator();

// Behaviors, in the order the priority table cares about (PLAN.md 4.2).
const drag = new DragBehavior();
const walk = new WalkBehavior();
const groom = new GroomBehavior();
const idle = new IdleBehavior();
const machine = new BehaviorMachine([drag, walk, groom, idle]);

let snapshot: PetSnapshot = blankSnapshot();
/** Highest time seen, so the first frame does not produce a giant dt. */
let lastFrameAt = 0;

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

const api = window.littlepet;

api.connect();

window.addEventListener(
  'message',
  (event: MessageEvent<{ type: string; snapshot?: PetSnapshot }>) => {
    if (event.data?.type !== 'littlepet:snapshot' || !event.data.snapshot) return;
    snapshot = event.data.snapshot;
  },
);

api.init().then((boot) => {
  snapshot = boot.snapshot;
  // The cat's art size comes from settings rather than the constant, so it has to
  // land before the first frame or the hit mask and the drawn cat disagree.
  catScale = boot.settings.scale;
  applySettings(boot.settings);
  requestAnimationFrame(frame);
});

function applySettings(next: Settings): void {
  const palette = resolvePalette(next.patternId, next.paletteOverride);
  if (atlas.applyPalette(next.patternId, palette)) {
    renderer.setEyeColor(palette.eye ?? [24, 20, 26], palette.eyeShine ?? [255, 255, 255]);
  }
  // Window and hit mask must agree, or the cat becomes unclickable.
  sizeCanvas();
}

let catScale = CAT_SCALE;

function sizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${STAGE_W}px`;
  canvas.style.height = `${STAGE_H}px`;
  canvas.width = Math.round(STAGE_W * dpr);
  canvas.height = Math.round(STAGE_H * dpr);
}

window.addEventListener('resize', sizeCanvas);

// ---------------------------------------------------------------------------
// Pointer
// ---------------------------------------------------------------------------

/**
 * Drag handling lives here rather than in main, because only the renderer knows
 * which pixel was grabbed - the hit test lives here too (PLAN.md 3.2).
 *
 * `mousedown` reaches us because main flips the window out of click-through the
 * moment the cursor is over the cat. `setIgnoreMouseEvents(false, {forward: true})`
 * means clicks on the cat land on us and clicks around it still fall through.
 */
window.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  // Ask the mask, not the last frame's mode: a fast click can arrive on the same
  // frame the cursor crossed onto the cat, before that frame's hysteresis has run.
  // `contains` is pure, so this does not advance the counters a second time.
  if (!hit.contains(snapshot.cursor.x, snapshot.cursor.y, origin(), catScale)) return;
  context.dragging = true;
  drag.onDrop(snapshot);
  api.send({ type: 'dragStart' });
});

window.addEventListener('mouseup', () => {
  if (!context.dragging) return;
  context.dragging = false;
  drag.onDrop(snapshot);
  api.send({ type: 'dragEnd' });
});

// Losing the window mid-drag (alt-tab, a system dialog) must not leave the cat
// stuck to the pointer.
window.addEventListener('blur', () => {
  if (!context.dragging) return;
  context.dragging = false;
  api.send({ type: 'dragEnd' });
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function frame(now: number): void {
  const dt = lastFrameAt === 0 ? 1 / 60 : Math.min((now - lastFrameAt) / 1000, 1 / 20);
  lastFrameAt = now;

  context.beginFrame(dt, snapshot);
  mochi.update(dt);

  // Keep the cat's art box inside the stage, so a long walk cannot push it out of
  // the window and lose it. On a stage smaller than the cat the range inverts, so
  // it collapses to a centred value.
  context.position.x = clampRange(context.position.x, STAGE_W - CAT_W);
  context.position.y = clampRange(context.position.y, STAGE_H - CAT_H);

  // Behaviors.
  machine.update(context);
  dispatchIdleActivity();

  // Eye follow (feature 02). Fed in here rather than inside the renderer, so the
  // eased pupil is advanced exactly once per frame and the draw pass is a pure
  // function of the context.
  context.lookAt(...lookVector(context));

  // Animation.
  const animName = chooseAnimation();
  animator.set(animName, atlas.frames(animName), atlas.durationsFor(animName));
  animator.loop = animName !== 'stretch' && animName !== 'cheer';
  animator.update(dt);

  // Click-through. Held interactive while dragging: the cursor is often off the cat
  // by then, and the window still has to keep receiving the mouseup.
  const mode = hit.test(snapshot.cursor.x, snapshot.cursor.y, origin(), catScale, context.dragging);
  if (mode !== snapshot.inputMode) api.send({ type: 'inputMode', mode });

  // Draw.
  const anchors = eyeAnchors(animName, animator.frameIndex);
  renderer.draw(animator.frame, anchors, context, catScale);

  requestAnimationFrame(frame);
}

/** Where the cat's art box sits, given its offset inside the stage. */
function origin(): { x: number; y: number } {
  return { x: CAT_ANCHOR.x + context.position.x, y: CAT_ANCHOR.y + context.position.y };
}

/**
 * Clamp an offset to `[0, span]`, collapsing to the middle when the span is
 * negative (a stage smaller than the cat).
 */
function clampRange(value: number, span: number): number {
  if (span <= 0) return span / 2;
  return value < 0 ? 0 : value > span ? span : value;
}

/**
 * Direction from the cat's head to the cursor, in art cells.
 *
 * The head sits about a third of the way down the art box; using the box centre
 * instead makes the eyes lead the cursor noticeably early. The magnitude is
 * irrelevant - `lookAt` normalises and clamps it - so only the direction is kept.
 */
function lookVector(context: Context): [number, number] {
  const headX = CAT_ANCHOR.x + context.position.x + CAT_W / 2;
  const headY = CAT_ANCHOR.y + CAT_H * 0.3;
  return [context.stageCursor.x - headX, context.stageCursor.y - headY];
}

function eyeAnchors(anim: string, frameIndex: number): readonly EyeAnchor[] {
  const frames = NUNU_EYES[anim];
  if (!frames || frames.length === 0) return [];
  // The eye table is indexed by position within the animation, not by the atlas'
  // flat frame number.
  return frames[Math.min(frameIndex, frames.length - 1)] ?? [];
}

/**
 * Which animation to show.
 *
 * The active behavior owns the pose, falling back to `idle`. `dangle` is the drag
 * pose: hanging from the cursor rather than standing on the floor.
 */
function chooseAnimation(): string {
  if (context.dragging) return 'dangle';
  switch (machine.active?.id) {
    case 'drag':
      return 'dangle';
    case 'groom':
      return 'groom';
    case 'walk':
      return 'walk';
    default:
      break;
  }
  switch (idle.activity) {
    case 'groom':
      return 'groom';
    case 'stretch':
      return 'stretch';
    default:
      return 'idle';
  }
}

/**
 * The idle director announces a flourish; this routes it to the behavior that
 * owns it. Keeps the director free of a branch per behavior (PLAN.md 4.4).
 */
function dispatchIdleActivity(): void {
  const picked = idle.consumeDispatch();
  if (picked === 'groom') groom.request();
  if (picked === 'stretch') {
    // A self-stretch is a walk to nowhere: nudge the cat a step so the pose reads
    // as the cat moving into it rather than snapping.
    context.walkTarget = {
      x: context.position.x + (Math.random() < 0.5 ? -12 : 12),
    };
    context.walkUntil = 0;
  }
}

// Exposed for Playwright integration tests (PLAN.md 9.1). Not used by the app.
Object.assign(window as unknown as Record<string, unknown>, {
  __pet: {
    context,
    animator,
    machine,
    atlas,
    hit,
    get snapshot() {
      return snapshot;
    },
    /** Force a snapshot, so a test can drive the cat without a real mouse. */
    setSnapshot(next: Partial<PetSnapshot>) {
      snapshot = { ...snapshot, ...next };
    },
    frameCount: () => context.time,
    catBox: () => ({ ...origin(), w: CAT_W, h: CAT_H, scale: catScale }),
  },
});
