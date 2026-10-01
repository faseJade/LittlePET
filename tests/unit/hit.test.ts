import { describe, expect, it } from 'vitest';
import { HitTester } from '../../src/renderer/pet/hit';
import { buildLayout, type CatSprite } from '../../src/sprites/compile';
import { THRESHOLDS } from '../../src/shared/thresholds';

/**
 * Click-through hit test (PLAN.md 3.2).
 *
 * The property that decides whether the app feels right is not "is the hit area
 * accurate" - it is "does the hit area stay still while the cat moves". Two things
 * follow from that, and both are asserted here:
 *
 *  - the mask is the union across every frame, so the tail swishing does not punch
 *    holes in the cat;
 *  - entry and exit use different frame counts, so a cursor crossing the cat in one
 *    frame is ignored and a cursor resting on the boundary does not flicker.
 */

const ORIGIN = { x: 0, y: 0 };
const SCALE = 3;

/**
 * A 4x4 cat: a body in the middle two columns, plus a tail that only appears in the
 * second frame. The tail is the point - a per-frame mask would drop it.
 */
const SPRITE: CatSprite = {
  id: 'test',
  grid: { w: 4, h: 4 },
  anims: {
    sit: [['....', '.BB.', '.BB.', '....']],
    tail: [
      ['....', '.BB.', '.BB.', '....'],
      ['...B', '.BB.', '.BB.', '....'],
    ],
  },
  durations: { sit: [100], tail: [100, 100] },
};

describe('HitTester mask', () => {
  const layout = buildLayout(SPRITE);

  it('is the union of every frame, not the current one', () => {
    // The tail pixel at (3,0) exists only in the second tail frame.
    expect(layout.layout.tail).toEqual([1, 2]);
    expect(layout.mask[0 * layout.grid.w + 3]).toBe(1);
    // ...and it is a hit on the first tail frame too, because the mask is not
    // per-frame. Testing the current frame would make the tail unclickable for half
    // the cycle, so the cat would feel like it had a hole in it.
    const h = new HitTester(layout);
    // The tail pixel is grid cell (3, 0). The padding is applied before dividing, so
    // it widens the cell rather than shifting the grid - any point in this cell's
    // padded span lands on it.
    const px = 3 * SCALE;
    const py = 0;
    for (let i = 0; i < THRESHOLDS.HIT_ENTER_FRAMES; i++) h.test(px, py, ORIGIN, SCALE);
    expect(h.inputMode).toBe('interactive');
  });

  it('leaves genuinely empty cells click-through', () => {
    const h = new HitTester(layout);
    for (let i = 0; i < 10; i++) h.test(0, 0, ORIGIN, SCALE);
    expect(h.inputMode).toBe('passthrough');
  });

  it('passes clicks outside the art box to whatever is underneath', () => {
    // A 320x240 stage with a 144px cat: most of the window is not the cat, and
    // swallowing clicks there would make every other app unusable.
    const h = new HitTester(layout);
    for (let i = 0; i < 10; i++) h.test(5000, 5000, ORIGIN, SCALE);
    expect(h.inputMode).toBe('passthrough');
  });

  it('accepts a negative origin, as when the cat walks off the left edge', () => {
    // The cat can be part-way outside the stage; the mask must still be sampled in
    // art-grid coordinates, not clamped away.
    const shifted = buildLayout({
      ...SPRITE,
      anims: { tail: [SPRITE.anims.tail![0]!] },
      durations: { tail: [100] },
    });
    const h = new HitTester(shifted);
    const origin = { x: -6, y: 0 };
    for (let i = 0; i < THRESHOLDS.HIT_ENTER_FRAMES; i++) h.test(-6 + 3, 3, origin, SCALE);
    expect(h.inputMode).toBe('interactive');
  });
});

describe('HitTester hysteresis', () => {
  const layout = buildLayout(SPRITE);
  // A point on the cat's body, and a point in empty space.
  const ON = { x: 1 * SCALE + 1, y: 1 * SCALE + 1 };
  const OFF = { x: 0, y: 0 };

  it('needs two consecutive hits to grab', () => {
    const h = new HitTester(layout);
    expect(h.test(ON.x, ON.y, ORIGIN, SCALE)).toBe('passthrough');
    expect(h.test(ON.x, ON.y, ORIGIN, SCALE)).toBe('interactive');
  });

  it('ignores a cursor that crosses the cat in a single frame', () => {
    // A flick of the mouse can jump clean across a 144px cat between two frames.
    // Without the entry count the cat would flicker interactive for one frame and
    // swallow a click meant for the app underneath.
    const h = new HitTester(layout);
    h.test(ON.x, ON.y, ORIGIN, SCALE);
    h.test(OFF.x, OFF.y, ORIGIN, SCALE);
    expect(h.test(ON.x, ON.y, ORIGIN, SCALE)).toBe('passthrough');
  });

  it('needs four consecutive misses to let go', () => {
    const h = new HitTester(layout);
    for (let i = 0; i < THRESHOLDS.HIT_ENTER_FRAMES; i++) h.test(ON.x, ON.y, ORIGIN, SCALE);
    expect(h.inputMode).toBe('interactive');
    for (let i = 0; i < THRESHOLDS.HIT_EXIT_FRAMES - 1; i++) {
      expect(h.test(OFF.x, OFF.y, ORIGIN, SCALE)).toBe('interactive');
    }
    expect(h.test(OFF.x, OFF.y, ORIGIN, SCALE)).toBe('passthrough');
  });

  it('keeps holding while the cursor hovers on the boundary', () => {
    // The padding exists so a cursor resting on the cat's edge does not toggle.
    // The exit count is what actually absorbs the jitter; the padding makes the
    // ambiguous band narrow.
    const h = new HitTester(layout);
    for (let i = 0; i < THRESHOLDS.HIT_ENTER_FRAMES; i++) h.test(ON.x, ON.y, ORIGIN, SCALE);
    for (let i = 0; i < 200; i++) {
      const onEdge = i % 2 === 0;
      h.test(onEdge ? ON.x : ON.x + THRESHOLDS.HIT_PAD_PX + 1, ON.y, ORIGIN, SCALE);
      expect(h.inputMode).toBe('interactive');
    }
  });

  it('stays interactive while held, when the cursor may leave the cat entirely', () => {
    // Dragging the cat around the screen: the cursor is wherever the hand is, which
    // is often nowhere near the cat. Without the hold the window would flip back to
    // click-through mid-drag and the `mouseup` would never arrive, stranding the cat
    // stuck to the pointer.
    const h = new HitTester(layout);
    for (let i = 0; i < 50; i++) h.test(5000, 5000, ORIGIN, SCALE, true);
    expect(h.inputMode).toBe('interactive');
  });

  it('resumes the exit count from zero after a hold ends', () => {
    // The hold zeroes both counters, so releasing the mouse over empty space takes
    // a full exit window before the window goes click-through again. Without that,
    // the frames of misses accumulated during the drag would release it instantly -
    // and it would go through click-through on the very next frame.
    const h = new HitTester(layout);
    for (let i = 0; i < 50; i++) h.test(5000, 5000, ORIGIN, SCALE, true);
    for (let i = 0; i < THRESHOLDS.HIT_EXIT_FRAMES - 1; i++) {
      expect(h.test(5000, 5000, ORIGIN, SCALE), `miss ${i}`).toBe('interactive');
    }
    expect(h.test(5000, 5000, ORIGIN, SCALE)).toBe('passthrough');
  });

  it('does not count the frames spent holding toward the entry window', () => {
    // A cursor that drifts onto the cat, is held for a while, then leaves: the two
    // real hits it accumulated are what matter, not the held frames.
    const h = new HitTester(layout);
    h.test(ON.x, ON.y, ORIGIN, SCALE, true);
    h.test(ON.x, ON.y, ORIGIN, SCALE, true);
    // One more genuine hit completes the entry window...
    expect(h.test(ON.x, ON.y, ORIGIN, SCALE)).toBe('interactive');
  });

  it('answers a click query without advancing the counters', () => {
    // `mousedown` can arrive on the same frame the cursor crossed onto the cat,
    // before that frame's `test` has run. If the click path called `test` it would
    // run the hysteresis twice in one frame, so one frame of hover plus a click
    // would count as the two frames required to grab.
    const h = new HitTester(layout);
    expect(h.contains(ON.x, ON.y, ORIGIN, SCALE)).toBe(true);
    expect(h.inputMode).toBe('passthrough');
    for (let i = 0; i < 10; i++) h.contains(ON.x, ON.y, ORIGIN, SCALE);
    expect(h.inputMode).toBe('passthrough');
    // The counters are untouched, so the first real `test` still needs both frames.
    expect(h.test(ON.x, ON.y, ORIGIN, SCALE)).toBe('passthrough');
    expect(h.test(ON.x, ON.y, ORIGIN, SCALE)).toBe('interactive');
  });

  it('resets to passthrough when the window moves to another display', () => {
    const h = new HitTester(layout);
    for (let i = 0; i < THRESHOLDS.HIT_ENTER_FRAMES; i++) h.test(ON.x, ON.y, ORIGIN, SCALE);
    h.reset();
    expect(h.inputMode).toBe('passthrough');
    // The counters are cleared too, so the first frame on the new display is a
    // clean start rather than a continuation of the old one's hysteresis.
    expect(h.test(ON.x, ON.y, ORIGIN, SCALE)).toBe('passthrough');
  });
});

describe('HitTester.locate', () => {
  const layout = buildLayout(SPRITE);

  it('reports art-grid coordinates, not stage pixels', () => {
    // Behaviors that need a body part - petting the head, kneading by the paws -
    // ask where in the art the cursor is, because that is stable while the cat
    // walks and the stage pixels are not.
    const h = new HitTester(layout);
    expect(h.locate(1 * SCALE + 1, 2 * SCALE + 2, ORIGIN, SCALE)).toEqual({ x: 1, y: 2 });
  });

  it('returns null off the cat', () => {
    const h = new HitTester(layout);
    expect(h.locate(0, 0, ORIGIN, SCALE)).toBeNull();
    expect(h.locate(999, 999, ORIGIN, SCALE)).toBeNull();
  });

  it('does not apply the hit padding, so it never claims an empty cell', () => {
    // `test` is padded so the edges are grabbable; `locate` is not, so a behavior
    // asking "is the cursor on the head" is not told yes by 2px of padding.
    const h = new HitTester(layout);
    expect(h.locate(0, 1 * SCALE + 1, ORIGIN, SCALE)).toBeNull();
  });
});
