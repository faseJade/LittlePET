import { THRESHOLDS } from '../../shared/thresholds';
import type { AtlasLayout } from '../../sprites/compile';

/**
 * Click-through hit test (PLAN.md 3.2).
 *
 * The window is always click-through, because it covers a 320x240 rectangle and
 * swallowing clicks meant for whatever is underneath would make the app unusable.
 * To make the cat itself grabbable we test the cursor against the cat's opaque
 * pixels and ask the main process to flip `setIgnoreMouseEvents`.
 *
 * Two details make this feel solid rather than twitchy:
 *
 *  - The mask is the **union** across every frame, not the current frame. Testing
 *    per-frame would shrink the hit area as the tail swished and make the cat
 *    feel like it had holes in it.
 *  - Entry and exit use **different** frame counts. Entering needs 2 consecutive
 *    hits, leaving needs 4 consecutive misses. A cursor crossing the cat in one
 *    frame never registers; a cursor resting on the edge does not flicker.
 */
export class HitTester {
  private insideFrames = 0;
  private outsideFrames = 0;
  private mode: 'passthrough' | 'interactive' = 'passthrough';

  constructor(private readonly layout: AtlasLayout) {}

  get inputMode(): 'passthrough' | 'interactive' {
    return this.mode;
  }

  /**
   * Is this point on the cat?
   *
   * Pure: it reads the mask and advances nothing. `test` is the stateful version,
   * and calling it twice in one frame - once to query, once to advance - would run
   * the hysteresis twice as fast, so a click that arrived on the same frame the
   * cursor entered would count as two frames of hover.
   *
   * @param cursorX Cursor in *stage-local* logical pixels.
   * @param cursorY
   * @param origin  Where the cat's art box sits in the stage, in logical pixels.
   * @param scale   Logical pixels per art cell.
   */
  contains(
    cursorX: number,
    cursorY: number,
    origin: { x: number; y: number },
    scale: number,
  ): boolean {
    const pad = THRESHOLDS.HIT_PAD_PX;
    const gx = Math.floor((cursorX - origin.x + pad) / scale);
    const gy = Math.floor((cursorY - origin.y + pad) / scale);
    if (gx < 0 || gy < 0 || gx >= this.layout.grid.w || gy >= this.layout.grid.h) {
      return false;
    }
    return this.layout.mask[gy * this.layout.grid.w + gx] === 1;
  }

  /**
   * Advance the hysteresis one frame and report the resulting mode.
   *
   * @param held Force interactive regardless of the cursor. Set while the cat is
   *   being dragged: the cursor is wherever the hand is, often nowhere near the
   *   cat, and the window still has to receive the `mouseup` that ends the drag.
   */
  test(
    cursorX: number,
    cursorY: number,
    origin: { x: number; y: number },
    scale: number,
    held = false,
  ): 'passthrough' | 'interactive' {
    if (held) {
      this.mode = 'interactive';
      this.insideFrames = 0;
      this.outsideFrames = 0;
      return this.mode;
    }

    if (this.contains(cursorX, cursorY, origin, scale)) {
      this.insideFrames++;
      this.outsideFrames = 0;
      if (this.mode === 'passthrough' && this.insideFrames >= THRESHOLDS.HIT_ENTER_FRAMES) {
        this.mode = 'interactive';
        this.insideFrames = 0;
      }
    } else {
      this.outsideFrames++;
      this.insideFrames = 0;
      if (this.mode === 'interactive' && this.outsideFrames >= THRESHOLDS.HIT_EXIT_FRAMES) {
        this.mode = 'passthrough';
        this.outsideFrames = 0;
      }
    }
    return this.mode;
  }

  /**
   * Where in the art the cursor is, or null if it is off the cat. Behaviors that
   * need a body part (petting the head, kneading near the paws) use this.
   */
  locate(
    cursorX: number,
    cursorY: number,
    origin: { x: number; y: number },
    scale: number,
  ): { x: number; y: number } | null {
    const gx = Math.floor((cursorX - origin.x) / scale);
    const gy = Math.floor((cursorY - origin.y) / scale);
    if (gx < 0 || gy < 0 || gx >= this.layout.grid.w || gy >= this.layout.grid.h) return null;
    if (this.layout.mask[gy * this.layout.grid.w + gx] !== 1) return null;
    return { x: gx, y: gy };
  }

  /** Reset, e.g. after the window teleports to another display. */
  reset(): void {
    this.mode = 'passthrough';
    this.insideFrames = 0;
    this.outsideFrames = 0;
  }
}
