import { MOCHI } from '../../../shared/thresholds';
import type { PetSnapshot } from '../../../shared/types';
import { PRIORITY, type Behavior, type PetContext, type StopReason } from '../behavior';

/**
 * Mochi drag, feature 03.
 *
 * Holding the cat is the interaction that has to feel best, because it is the one
 * people discover first. Three things sell it:
 *
 *  1. The body lags the cursor. It is not parented to the pointer; it is a mass
 *     with velocity, so fast movements stretch it.
 *  2. Shaking produces a **side-to-side wobble**, not a vertical bounce. Real
 *     mochi jiggles across the hand you are shaking it with.
 *  3. Dropping squashes on landing and settles.
 *
 * Priority 100, above everything, because a held cat is not participating in any
 * other reaction.
 */
export class DragBehavior implements Behavior {
  readonly id = 'drag';
  readonly priority = PRIORITY.drag;

  /** Window velocity of the last frame, px/s, for the mochi springs. */
  private vx = 0;
  private vy = 0;
  private last: { x: number; y: number } | null = null;
  /** True while the springs are visibly moving after the drop. */
  private settling = 0;

  canStart(ctx: PetContext): boolean {
    if (ctx.dragging) return true;
    // Nothing to do while settling unless the cat is grabbed again.
    return this.settling > 0;
  }

  start(ctx: PetContext): void {
    this.last = null;
    this.vx = 0;
    this.vy = 0;
    if (ctx.dragging) {
      this.settling = 0;
      ctx.expression = 'surprised';
      ctx.suppressBlink();
    }
  }

  update(ctx: PetContext): void {
    if (ctx.dragging) {
      const cursor = ctx.snapshot.cursor;
      if (this.last) {
        this.vx = (cursor.x - this.last.x) / Math.max(ctx.dt, 1e-4);
        this.vy = (cursor.y - this.last.y) / Math.max(ctx.dt, 1e-4);
      }
      this.last = { x: cursor.x, y: cursor.y };

      // The window velocity is the real quantity: it already accounts for how fast
      // the *cat* is moving, which is what the springs should respond to. Feeding
      // it with dt keeps the response framerate-independent.
      ctx.mochi.applyDragVelocity(this.vx, this.vy, ctx.dt);
      ctx.facing = this.vx > 20 ? 1 : this.vx < -20 ? -1 : ctx.facing;
      ctx.expression = 'surprised';
      return;
    }

    // Released. The springs take over; once they are within a pixel of neutral
    // there is nothing left to animate.
    this.last = null;
    if (ctx.mochi.deformed) {
      this.settling = 1;
    } else {
      this.settling = 0;
      ctx.expression = 'neutral';
    }
  }

  done(ctx: PetContext): boolean {
    return !ctx.dragging && !ctx.mochi.deformed;
  }

  stop(ctx: PetContext, reason: StopReason): void {
    if (!ctx.dragging && reason === 'preempted') {
      // Nothing higher can preempt this, but a quit or hide can.
      ctx.mochi.impact(MOCHI.DROP_SQUASH * 0.5);
    }
    this.last = null;
  }

  /** Drop squash, called by the pointer handler the frame the button is released. */
  onDrop(snapshot: PetSnapshot): void {
    // Only squash on a real downward release. A gentle placement should not bounce.
    if (snapshot.drag.vy > 120) {
      this.settling = 1;
    }
  }
}
