import { THRESHOLDS } from '../../shared/thresholds';
import type { PetSnapshot } from '../../shared/types';
import type { ExpressionName, PetContext } from './behavior';
import type { Mochi } from './physics/mochi';

/**
 * Owns the mutable per-frame state that every behavior reads, and the small amount
 * of *derived* state that would otherwise get recomputed (and recomputed badly) in
 * five different behaviors: last-input time, blink schedule, pupil easing.
 *
 * The context is also the only place the wall clock enters the renderer, which is
 * what makes the whole simulation deterministic under test (PLAN.md 9.1).
 */
export class Context implements PetContext {
  dt = 1 / 60;
  time = 0;
  snapshot: PetSnapshot = blankSnapshot();
  mochi: Mochi;
  facing: 1 | -1 = 1;
  walkUntil = 0;
  walkTarget: { x: number } | null = null;
  dragging = false;
  expression: ExpressionName = 'neutral';

  /** Cursor position in *stage* pixels, which is what the hit test and eyes use. */
  stageCursor = { x: 0, y: 0 };
  /** The cat's offset inside the stage, in logical pixels. */
  position = { x: 0, y: 0 };

  /** Seconds since any input was seen. Drives sleep and the idle director. */
  idleFor = 0;
  /** Seconds since the cursor last moved meaningfully. */
  cursorStillFor = 0;
  /** True once the cat has been ignored long enough to fall asleep. */
  asleep = false;

  /** Eased pupil offset in art pixels, shared by both eyes. */
  pupil = { x: 0, y: 0 };
  private pupilTarget = { x: 0, y: 0 };
  /** 0 = open, 1 = fully closed. */
  blink = 0;
  private nextBlinkAt = 1.5;
  private blinkStartedAt = -1;

  constructor(mochi: Mochi) {
    this.mochi = mochi;
  }

  /** Advance every time-derived field. Called once per frame before behaviors run. */
  beginFrame(dt: number, snapshot: PetSnapshot): void {
    this.dt = dt;
    this.snapshot = snapshot;
    this.time += dt;

    const moved =
      Math.abs(snapshot.cursor.x - this.stageCursor.x) +
      Math.abs(snapshot.cursor.y - this.stageCursor.y);
    this.stageCursor.x = snapshot.cursor.x;
    this.stageCursor.y = snapshot.cursor.y;

    const anyInput = snapshot.keyRate > 0 || snapshot.wheelEnergy > 0 || snapshot.drag.active;
    this.idleFor = anyInput || moved > 0.5 ? 0 : this.idleFor + dt;
    this.cursorStillFor = moved > 0.5 ? 0 : this.cursorStillFor + dt;

    if (this.idleFor >= THRESHOLDS.IDLE_SLEEP) {
      this.asleep = true;
      this.expression = 'sleepy';
    } else if (this.asleep) {
      this.asleep = false;
      this.expression = 'neutral';
    }

    this.stepBlink(dt);
    this.stepPupils(dt);
  }

  /**
   * Blink on a randomised schedule. A blink is a short ramp up and back, so it
   * reads as a lid rather than a sprite swap - and it costs nothing because the
   * eyes are a separate layer (PLAN.md 6.3).
   */
  private stepBlink(dt: number): void {
    if (this.asleep) {
      // Asleep cats keep their eyes shut.
      this.blink = 1;
      return;
    }
    if (this.blinkStartedAt >= 0) {
      this.blinkStartedAt += dt;
      const half = THRESHOLDS.BLINK_DURATION / 2;
      if (this.blinkStartedAt >= THRESHOLDS.BLINK_DURATION) {
        this.blinkStartedAt = -1;
        this.blink = 0;
        this.scheduleBlink();
      } else {
        // Fast attack, slower release.
        const p = this.blinkStartedAt / half;
        this.blink = this.blinkStartedAt < half ? p : 1 - (this.blinkStartedAt - half) / half;
      }
      return;
    }
    if (this.time >= this.nextBlinkAt) {
      this.blinkStartedAt = 0;
      this.blink = 0;
    }
  }

  private scheduleBlink(): void {
    const { BLINK_MIN_GAP, BLINK_MAX_GAP } = THRESHOLDS;
    this.nextBlinkAt = this.time + BLINK_MIN_GAP + Math.random() * (BLINK_MAX_GAP - BLINK_MIN_GAP);
  }

  /**
   * Pupils chase the cursor.
   *
   * Easing is exponential and framerate-independent, and the *target* is clamped
   * rather than the eased value: a target that moved further away is simply further
   * away, whereas clamping the eased value would fight the easing and make the
   * pupils stutter at the edge of their travel.
   */
  private stepPupils(dt: number): void {
    const k = 1 - Math.exp(-THRESHOLDS.PUPIL_EASE * dt);
    this.pupil.x += (this.pupilTarget.x - this.pupil.x) * k;
    this.pupil.y += (this.pupilTarget.y - this.pupil.y) * k;
  }

  /**
   * Point the eyes at a direction, in art cells. Any length is accepted: the
   * direction is all that matters, and the value is clamped to the travel budget so
   * a cursor at the far corner of the screen pins the pupils exactly as hard as one
   * just off the cat's nose.
   */
  lookAt(x: number, y: number): void {
    const len = Math.hypot(x, y);
    const max = THRESHOLDS.PUPIL_MAX_OFFSET;
    // A deadzone of a hundredth of a cell: below that the offset rounds away to
    // nothing when the eye layer draws, so chasing it only adds shimmer.
    if (len < 0.01) {
      this.pupilTarget.x = 0;
      this.pupilTarget.y = 0;
      return;
    }
    const scale = len > max ? max / len : 1;
    this.pupilTarget.x = x * scale;
    this.pupilTarget.y = y * scale;
  }

  /** Snap the pupils, used when a behavior starts and should not visibly slide. */
  snapPupils(): void {
    this.pupil.x = this.pupilTarget.x;
    this.pupil.y = this.pupilTarget.y;
  }

  /**
   * Postpone the next blink, so a dramatic expression is not blinked through.
   *
   * Only ever pushes the blink *later*. A behavior that calls this on the frame the
   * blink was already due must not accidentally bring it forward.
   */
  suppressBlink(): void {
    this.nextBlinkAt = Math.max(this.nextBlinkAt, this.time + THRESHOLDS.BLINK_MIN_GAP);
  }
}

/** A snapshot with everything at rest - the seed for tests and the first frame. */
export function blankSnapshot(): PetSnapshot {
  return {
    t: 0,
    cursor: { x: 0, y: 0, speed: 0, inside: false },
    keyRate: 0,
    wheelEnergy: 0,
    inputMode: 'passthrough',
    drag: { active: false, vx: 0, vy: 0 },
    hookActive: false,
  };
}
