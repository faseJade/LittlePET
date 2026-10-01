import { MOCHI } from '../../../shared/thresholds';

/**
 * Mochi squash/stretch (feature 03).
 *
 * The cat is modelled as two orthogonal springs sharing one mass, plus a torsional
 * oscillator for the lateral wobble. Three things make it feel like jelly rather
 * than like a rubber band:
 *
 *  1. Drag velocity is applied as **velocity**, not as a direct nudge to the scale.
 *     Adding to the scale teleports the cat and bypasses the clamps; adding to the
 *     spring's velocity lets the spring do the work and the result is emergent.
 *  2. The two springs are **negatively coupled on their deviation**, so stretching
 *     one axis bulks the other out and volume is roughly preserved.
 *  3. The wobble is a real oscillator with a restoring term. Without one the angle
 *     just decays exponentially and the cat tilts instead of jiggles.
 *
 * Integration is a fixed 1/240 s sub-step, so the feel is identical at 60, 120 and
 * 144 Hz (PLAN.md 4.1).
 */
const SUBSTEP = 1 / 240;

/**
 * How strongly the two axes pull on each other. Small relative to `STIFFNESS`: it
 * only has to preserve volume, and a large value would make the springs fight each
 * other into a wobble that never settles.
 */
const COUPLE = 24;

/** Largest dt the integrator will honour. A backgrounded tab hands back seconds. */
const MAX_FRAME = 0.1;

/**
 * Drag velocity -> spring velocity, per second.
 *
 * A *rate*, not a fraction: this is multiplied by dt, so it describes how much
 * velocity accumulates per second of dragging at a given window speed.
 *
 * The size follows from the spring. Under a steady drag the stretch settles where
 * the injection balances the restoring force: `x = vx * GAIN / STIFFNESS`. With
 * STIFFNESS 190, a hard flick of ~2000 px/s should just reach the 0.22 clamp and
 * a gentle 200 px/s should barely move at all - which pins this near 0.03. Getting
 * this wrong by an order of magnitude is not subtle: the cat saturates at its limit
 * on any drag and stops looking like jelly.
 */
const DRAG_TO_SPRING = 0.03;

/** Vertical drag produces less stretch than horizontal, or the cat smears. */
const VERTICAL_RATIO = 0.4;

/**
 * Drag velocity -> angular velocity, per second.
 *
 * Sized against the wobble's own dynamics: the oscillator has an angular frequency
 * of `WOBBLE_FREQ` rad/s and damping `WOBBLE_DAMP`, so a shake at ~1200 px/s should
 * swing the angle by a fraction of a radian - visible as a lean, not a spin.
 */
const WOBBLE_DRIVE = 0.0035;

export class Mochi {
  /** Horizontal scale. 1 = neutral. */
  sx = 1;
  /** Vertical scale. 1 = neutral. */
  sy = 1;
  /** Spring velocities, art cells per second. */
  private svx = 0;
  private svy = 0;
  /** Current wobble angle, radians. */
  angle = 0;
  private wobbleVel = 0;

  private accumulator = 0;

  /**
   * Feed the drag velocity (window px/s) while the cat is held.
   *
   * The injection is scaled by `dt`, which makes it a *force* proportional to the
   * drag velocity rather than an impulse applied once per rendered frame. That
   * distinction is the whole reason this takes a delta: without it, the same physical
   * drag would stretch the cat twice as much on a 30 Hz display as on a 120 Hz one,
   * because a low framerate would apply the impulse fewer times but each at the same
   * magnitude.
   *
   * @param dt Seconds since the previous call, for the same reason as `update`.
   */
  applyDragVelocity(vx: number, vy: number, dt = 1 / 60): void {
    const h = Math.min(Math.max(dt, 0), MAX_FRAME);
    // Inject spring velocity. Multiplying by dt makes the gain "per second" of drag,
    // so framerate independence is automatic.
    this.svx += vx * DRAG_TO_SPRING * h;
    this.svy += Math.abs(vy) * DRAG_TO_SPRING * VERTICAL_RATIO * h;
    // A sideways flick kicks the torsional oscillator directly, as an angular
    // *velocity* increment. Opposite sign so the cat lags the hand rather than
    // leading it. Injecting velocity rather than angle is what makes the shake ring
    // and then settle, instead of snapping to a lean and stopping.
    this.wobbleVel -= vx * WOBBLE_DRIVE * h;
  }

  /**
   * One-off squash, used on landing.
   *
   * Applied as an impulse to the springs' velocity so they absorb and settle it,
   * rather than teleporting the scales past their clamps.
   */
  impact(strength = MOCHI.DROP_SQUASH): void {
    this.svy -= strength * 12;
    this.svx += strength * 8;
    this.wobbleVel += strength * 2;
  }

  /** Drive the springs back to neutral with no external force. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, MAX_FRAME);
    let guard = 0;
    while (this.accumulator >= SUBSTEP && guard++ < 512) {
      this.accumulator -= SUBSTEP;
      this.step(SUBSTEP);
    }
  }

  private step(dt: number): void {
    // --- Squash / stretch -------------------------------------------------
    // Each axis is pulled toward 1 and negatively coupled to the other's deviation.
    // Coupling on the *deviation* rather than the value matters: an absolute term
    // is a constant force at rest, so the cat would slowly inflate untouched.
    const ax = (1 - this.sx) * MOCHI.STIFFNESS - this.svx * MOCHI.DAMPING - (this.sy - 1) * COUPLE;
    const ay = (1 - this.sy) * MOCHI.STIFFNESS - this.svy * MOCHI.DAMPING - (this.sx - 1) * COUPLE;

    // Semi-implicit Euler: update velocity first, then position with the *new*
    // velocity. It is stable at this stiffness, where explicit Euler would ring.
    this.svx += ax * dt;
    this.svy += ay * dt;
    this.integrate(this.svx, this.svy, dt);

    // --- Lateral wobble ---------------------------------------------------
    // A genuine damped oscillator: WOBBLE_FREQ is the angular frequency, and
    // WOBBLE_DAMP scales both the restoring and the velocity term. Without the
    // restoring term the angle decays monotonically and the cat tilts rather than
    // rocks.
    const restoring = -this.angle * MOCHI.WOBBLE_FREQ * MOCHI.WOBBLE_FREQ;
    const drag = -this.wobbleVel * MOCHI.WOBBLE_DAMP;
    this.wobbleVel += (restoring + drag) * dt;
    this.angle += this.wobbleVel * dt;
    if (!Number.isFinite(this.angle)) {
      // Defensive: a NaN here would silently stop all future motion.
      this.angle = 0;
      this.wobbleVel = 0;
    }
  }

  /**
   * Advance both axes, then enforce the limits.
   *
   * Clamping a *position* while leaving its velocity alone is the subtle failure
   * here: the spring keeps pushing outward every sub-step, velocity grows without
   * bound, and the cat ends up pinned at the limit even after the drag stops. So
   * when an axis is clamped, its velocity is set to the component that will carry it
   * back inside - outward motion is destroyed, inward motion is kept so the cat can
   * bounce back.
   */
  private integrate(vx: number, vy: number, dt: number): void {
    const nextX = this.sx + vx * dt;
    if (nextX > MAX_SCALE) {
      this.sx = MAX_SCALE;
      this.svx = vx > 0 ? 0 : vx;
    } else if (nextX < MIN_SCALE) {
      this.sx = MIN_SCALE;
      this.svx = vx < 0 ? 0 : vx;
    } else {
      this.sx = nextX;
      this.svx = vx;
    }

    const nextY = this.sy + vy * dt;
    if (nextY > MAX_SCALE) {
      this.sy = MAX_SCALE;
      this.svy = vy > 0 ? 0 : vy;
    } else if (nextY < MIN_SCALE) {
      this.sy = MIN_SCALE;
      this.svy = vy < 0 ? 0 : vy;
    } else {
      this.sy = nextY;
      this.svy = vy;
    }
  }

  /** True when the cat is visibly distorted enough to be worth drawing differently. */
  get deformed(): boolean {
    return Math.abs(this.sx - 1) > 0.02 || Math.abs(this.sy - 1) > 0.02;
  }

  /** Snapshot for tests, rounded so float noise does not fail a comparison. */
  snapshot(): { sx: number; sy: number; angle: number } {
    return { sx: round3(this.sx), sy: round3(this.sy), angle: round3(this.angle) };
  }
}

/** Either axis may squash toward this, or stretch to `MAX_SCALE_X`, and not past. */
const MIN_SCALE = 1 / MOCHI.MAX_SCALE_Y;
/** The upper bound is shared: the cat may bulge on either axis, but not more. */
const MAX_SCALE = MOCHI.MAX_SCALE_X;

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
