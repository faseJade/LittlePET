import { THRESHOLDS } from './thresholds';
import type { CursorState, DragState, InputMode, PetSnapshot } from './types';

/**
 * Input signal derivations (PLAN.md 5.1).
 *
 * All of it happens in the main process, in memory, and only the derived signals
 * leave. Key *counts* are counted; the keys themselves are never read, stored or
 * logged, which is what makes the privacy claim in PLAN.md 0.3 checkable rather
 * than aspirational.
 *
 * DOM-free and clock-free on purpose: `update(dt, cursor, events)` is a pure-ish
 * function of what it is handed, so the thresholds can be tuned in tests.
 */

/** Exponentially smoothed cursor speed, so one jittery sample cannot trigger a hunt. */
const SPEED_ALPHA = 0.3;

/** Key counts are kept in a ring of one-second buckets for the sliding window. */
const KEY_WINDOW_SEC = 60;
const KEY_BUCKETS = KEY_WINDOW_SEC;

export class InputSampler {
  private readonly keyBuckets = new Float32Array(KEY_BUCKETS);
  /** Index of the bucket holding the current second. */
  private bucketHead = 0;
  /** Fractional seconds accumulated since the last whole-second rollover. */
  private bucketCarry = 0;

  private cursor: CursorState = { x: 0, y: 0, speed: 0, inside: false };
  private wheelEnergy = 0;
  private drag: DragState = { active: false, vx: 0, vy: 0 };
  private inputMode: InputMode = 'passthrough';
  private hookActive = false;
  private monotonic = 0;

  /** Call on window blur: keystroke rate must not carry across apps. */
  resetKeys(): void {
    this.keyBuckets.fill(0);
  }

  setHookActive(active: boolean): void {
    this.hookActive = active;
  }

  setInputMode(mode: InputMode): void {
    this.inputMode = mode;
  }

  setDrag(active: boolean, vx = 0, vy = 0): void {
    this.drag = { active, vx, vy };
  }

  /** Add scroll energy. Called from the wheel event, with the absolute delta. */
  addWheel(deltaY: number): void {
    this.wheelEnergy += Math.abs(deltaY);
  }

  /**
   * Count one keypress.
   *
   * The parameter is deliberately absent. There is no path by which key content
   * could reach this object, so there is nothing to leak even by accident.
   */
  countKey(): void {
    this.keyBuckets[this.bucketHead]! += 1;
    this.filled.add(this.bucketHead);
  }

  /**
   * Advance the sampler by one frame.
   *
   * @param dt      Seconds since the last frame.
   * @param x       Cursor x in *stage-local logical* pixels. Main converts, because
   *                it is the only process that knows the window origin and the
   *                display scale factor.
   * @param y       Cursor y in stage-local logical pixels.
   * @param inside  Whether the cursor is over the stage window at all.
   */
  update(dt: number, x: number, y: number, inside = true): PetSnapshot {
    this.monotonic += dt * 1000;
    this.advanceBuckets(dt);

    // Movement is measured whether or not the cursor is over the window, so
    // crossing the edge registers as motion rather than as a jump from stale
    // coordinates.
    const dist = Math.hypot(x - this.cursor.x, y - this.cursor.y);
    const instant = dist / Math.max(dt, 1e-4);
    this.cursor.speed += (instant - this.cursor.speed) * SPEED_ALPHA;
    this.cursor.x = x;
    this.cursor.y = y;
    this.cursor.inside = inside;

    this.wheelEnergy = Math.max(
      0,
      InputSampler.decay(this.wheelEnergy, THRESHOLDS.UNROLL_DECAY, dt),
    );

    return {
      t: this.monotonic,
      cursor: {
        x: this.cursor.x,
        y: this.cursor.y,
        speed: this.cursor.speed,
        inside: this.cursor.inside,
      },
      keyRate: this.keysPerMinute(),
      wheelEnergy: this.wheelEnergy,
      inputMode: this.inputMode,
      drag: { ...this.drag },
      hookActive: this.hookActive,
    };
  }

  /** Keys per minute over the last 60 s. */
  private keysPerMinute(): number {
    let sum = 0;
    let buckets = 0;
    for (let i = 0; i < KEY_BUCKETS; i++) {
      sum += this.keyBuckets[i]!;
      // A bucket still in the ring only counts if it has been filled at least once.
      if (this.keyBuckets[i]! > 0 || this.filled.has(i)) buckets++;
    }
    if (buckets === 0) return 0;
    // Normalise by the seconds actually observed, so the first few seconds of a
    // session do not report a 60x rate from a single burst.
    return (sum / buckets) * 60;
  }

  /**
   * Roll the one-second buckets forward.
   *
   * Sub-second time is accumulated rather than discarded, because wheel and key
   * events do not arrive on frame boundaries and dropping the remainder would
   * lose a meaningful share of a fast typist's keystrokes.
   */
  private advanceBuckets(dt: number): void {
    this.bucketCarry += dt;
    const whole = Math.floor(this.bucketCarry);
    if (whole < 1) return;
    this.bucketCarry -= whole;
    // Clear every bucket the rollover passes over. Moving the head alone would
    // leave stale counts in the skipped slots.
    for (let i = 0; i < whole; i++) {
      this.bucketHead = (this.bucketHead + 1) % KEY_BUCKETS;
      this.keyBuckets[this.bucketHead] = 0;
      this.filled.delete(this.bucketHead);
    }
  }

  /** Bucket indices known to have received at least one count. */
  private readonly filled = new Set<number>();

  /**
   * Exponential decay per frame. Framerate-independent: the decay constant is per
   * second, so a 144 Hz display bleeds energy at the same rate as a 60 Hz one.
   */
  static decay(value: number, perSecond: number, dt: number): number {
    return value * Math.exp(-perSecond * dt);
  }
}
