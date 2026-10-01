import { describe, expect, it } from 'vitest';
import { Context } from '../../src/renderer/pet/context';
import { Mochi } from '../../src/renderer/pet/physics/mochi';
import { THRESHOLDS } from '../../src/shared/thresholds';
import { blankSnapshot } from '../../src/renderer/pet/context';
import { snapshot } from './helpers';

/**
 * The renderer's per-frame state, and eye follow (feature 02).
 *
 * Two things live here. The eye follow is the user-visible feature: pupils track
 * the cursor, easing toward it and never leaving the socket. The rest is the
 * derived state that would otherwise be recomputed - and recomputed differently -
 * in five behaviors: how long since any input, and when to blink.
 *
 * Everything is driven by an injected snapshot, so the whole class runs with no
 * clock and no DOM (PLAN.md 9.1).
 */

const context = () => new Context(new Mochi());

/** Run `seconds` of frames with the cursor at a fixed stage position. */
function run(ctx: Context, seconds: number, cursor = { x: 0, y: 0 }, dt = 1 / 60): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    ctx.beginFrame(dt, snapshot({ cursor: { x: cursor.x, y: cursor.y, speed: 0, inside: true } }));
  }
}

describe('Context eye follow', () => {
  it('eases toward the cursor rather than snapping', () => {
    // Snapping reads as a twitch, not as a glance. The first frame must move the
    // pupil a long way less than the target, or the easing is not happening.
    const ctx = context();
    ctx.lookAt(1, 0);
    run(ctx, 1 / 60);
    expect(ctx.pupil.x).toBeGreaterThan(0);
    expect(ctx.pupil.x).toBeLessThan(1);
  });

  it('arrives', () => {
    const ctx = context();
    ctx.lookAt(1, 0);
    run(ctx, 1);
    expect(ctx.pupil.x).toBeCloseTo(1, 1);
    expect(ctx.pupil.y).toBeCloseTo(0, 1);
  });

  it('is framerate independent', () => {
    // The easing is exponential, so a 30 Hz frame covers the same ground as a 144 Hz
    // one over the same wall-clock time. Integrating it per frame instead would make
    // the pupils twice as fast on a 30 Hz machine.
    const at = (dt: number) => {
      const ctx = context();
      ctx.lookAt(1, 0);
      run(ctx, 0.5, { x: 0, y: 0 }, dt);
      return ctx.pupil.x;
    };
    expect(at(1 / 30)).toBeCloseTo(at(1 / 144), 2);
  });

  it('never leaves the socket, however far away the cursor is', () => {
    // This is the whole safety property of feature 02. A cursor in the far corner of
    // a 4K screen is 3000 px from the cat; without the clamp the pupil would slide
    // out of its socket and the cat would look like it had a wandering eye.
    const ctx = context();
    ctx.lookAt(3000, -2000);
    run(ctx, 5);
    expect(Math.hypot(ctx.pupil.x, ctx.pupil.y)).toBeLessThanOrEqual(
      THRESHOLDS.PUPIL_MAX_OFFSET + 1e-6,
    );
  });

  it('keeps the direction when it clamps', () => {
    // Clamping by shortening the vector would keep the magnitude and lose the
    // direction, so a cursor to the upper right would pull the pupils right and down.
    const ctx = context();
    ctx.lookAt(3000, 3000);
    run(ctx, 5);
    expect(ctx.pupil.x).toBeCloseTo(ctx.pupil.y, 6);
  });

  it('centres when the cursor is on the head', () => {
    const ctx = context();
    ctx.lookAt(0.0001, 0);
    run(ctx, 5);
    expect(ctx.pupil.x).toBe(0);
  });

  it('still moves for a cursor a fraction of a cell away', () => {
    // The deadzone exists to stop shimmer, not to make the cat blind. A cursor one
    // tenth of a cell off the centre should still shift the pupil.
    const ctx = context();
    ctx.lookAt(0.2, 0);
    run(ctx, 5);
    expect(ctx.pupil.x).toBeCloseTo(0.2, 2);
  });

  it('snaps on demand, so a behavior does not visibly slide into place', () => {
    const ctx = context();
    ctx.lookAt(1, 0);
    ctx.snapPupils();
    expect(ctx.pupil.x).toBe(1);
  });
});

describe('Context idle tracking', () => {
  it('counts up while nothing happens', () => {
    const ctx = context();
    run(ctx, 5);
    expect(ctx.idleFor).toBeCloseTo(5, 1);
  });

  it('resets on keyboard input', () => {
    const ctx = context();
    run(ctx, 5);
    const before = ctx.idleFor;
    ctx.beginFrame(1 / 60, snapshot({ keyRate: 200 }));
    expect(before).toBeGreaterThan(4);
    expect(ctx.idleFor).toBe(0);
  });

  it('resets on scroll', () => {
    const ctx = context();
    run(ctx, 5);
    ctx.beginFrame(1 / 60, snapshot({ wheelEnergy: 40 }));
    expect(ctx.idleFor).toBe(0);
  });

  it('resets on cursor movement, but not on a cursor that has not moved', () => {
    // The threshold is sub-pixel: a cursor that jitters by a fraction of a pixel as it
    // sits on a HiDPI screen must not keep the cat awake forever.
    const ctx = context();
    run(ctx, 5, { x: 100, y: 100 });
    ctx.beginFrame(1 / 60, snapshot({ cursor: { x: 100.2, y: 100, speed: 0, inside: true } }));
    expect(ctx.idleFor).toBeCloseTo(5, 1);

    ctx.beginFrame(1 / 60, snapshot({ cursor: { x: 140, y: 100, speed: 0, inside: true } }));
    expect(ctx.idleFor).toBe(0);
  });

  it('falls asleep after the idle threshold and wakes on input', () => {
    const ctx = context();
    run(ctx, THRESHOLDS.IDLE_SLEEP + 1);
    expect(ctx.asleep).toBe(true);
    expect(ctx.expression).toBe('sleepy');

    ctx.beginFrame(1 / 60, snapshot({ keyRate: 100 }));
    expect(ctx.asleep).toBe(false);
    expect(ctx.expression).toBe('neutral');
  });

  it('keeps its eyes shut while asleep, whatever the blink schedule says', () => {
    // A sleeping cat that blinks open looks like it is staring at you at 3am.
    const ctx = context();
    run(ctx, THRESHOLDS.IDLE_SLEEP + 1);
    for (let i = 0; i < 600; i++) {
      ctx.beginFrame(1 / 60, blankSnapshot());
      expect(ctx.blink).toBe(1);
    }
  });
});

describe('Context blink', () => {
  it('blinks on a randomised schedule, not a metronome', () => {
    // A fixed interval is the single most noticeable way to make a cat look robotic.
    // Sampling the gaps over many blinks and checking the spread is the cheapest
    // honest test of that without asserting on a specific random sequence.
    const gaps: number[] = [];
    for (let seed = 0; seed < 24; seed++) {
      const ctx = context();
      let last = 0;
      let blinks = 0;
      for (let i = 0; i < 60 * 60; i++) {
        const wasBlinking = ctx.blink > 0;
        ctx.beginFrame(1 / 60, blankSnapshot());
        if (ctx.blink > 0 && !wasBlinking) {
          if (blinks > 0) gaps.push(ctx.time - last);
          last = ctx.time;
          blinks++;
        }
      }
      expect(blinks, `run ${seed} never blinked`).toBeGreaterThan(2);
    }
    for (const gap of gaps) {
      // Measured start to start, so the blink's own duration is included: the
      // scheduler spaces blinks by a gap of *open eyes*, and a blink that begins
      // immediately after the previous one ends is the shortest allowed interval.
      expect(gap).toBeGreaterThanOrEqual(THRESHOLDS.BLINK_MIN_GAP - 0.1);
      expect(gap).toBeLessThanOrEqual(THRESHOLDS.BLINK_MAX_GAP + THRESHOLDS.BLINK_DURATION + 0.1);
    }
    // Real spread, not a constant with float noise.
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.5);
  });

  it('completes a blink inside its duration', () => {
    // A blink that never closes is a permanently narrowed eye, which reads as a squint
    // rather than as a blink.
    const ctx = context();
    for (let i = 0; i < 60 * 60 && ctx.blink === 0; i++) {
      ctx.beginFrame(1 / 60, blankSnapshot());
    }
    expect(ctx.blink).toBeGreaterThan(0);
    const steps = Math.ceil(THRESHOLDS.BLINK_DURATION * 60) + 2;
    for (let i = 0; i < steps; i++) ctx.beginFrame(1 / 60, blankSnapshot());
    expect(ctx.blink).toBe(0);
  });

  it('never goes below zero or above one', () => {
    // The eye layer scales the pupil by (1 - blink), so an overshoot would invert it.
    const ctx = context();
    for (let i = 0; i < 60 * 120; i++) {
      ctx.beginFrame(1 / 60, blankSnapshot());
      expect(ctx.blink).toBeGreaterThanOrEqual(0);
      expect(ctx.blink).toBeLessThanOrEqual(1);
    }
  });

  it('pushes the next blink back when a behavior asks for it', () => {
    // Otherwise a surprised face blinks through the one frame it was meant to be seen.
    // Suppression has to survive the case where the blink is already due, which is
    // exactly when a behavior is most likely to call it.
    const ctx = context();
    for (let i = 0; i < 60 * 30; i++) {
      ctx.beginFrame(1 / 60, blankSnapshot());
      if (ctx.time > 5 && ctx.blink === 0) {
        ctx.suppressBlink();
        const suppressedAt = ctx.time;
        const steps = Math.floor(THRESHOLDS.BLINK_MIN_GAP * 60) - 2;
        for (let j = 0; j < steps; j++) {
          ctx.beginFrame(1 / 60, blankSnapshot());
          expect(
            ctx.blink,
            `blinked ${(ctx.time - suppressedAt).toFixed(2)}s after suppression`,
          ).toBe(0);
        }
        return;
      }
    }
    throw new Error('no blink happened in 30s to suppress');
  });

  it('never brings a blink forward', () => {
    const ctx = context();
    for (let i = 0; i < 60 * 60; i++) {
      ctx.beginFrame(1 / 60, blankSnapshot());
      // Called every frame, which is what a behavior that wants a clear view does.
      ctx.suppressBlink();
      expect(ctx.blink, `blink started at ${ctx.time.toFixed(2)}s of continuous suppression`).toBe(
        0,
      );
    }
  });
});

describe('Context cursor tracking', () => {
  it('exposes the cursor in stage pixels, which is what the hit test needs', () => {
    // Not screen coordinates: the renderer cannot convert, because only main knows
    // the window origin and the display scale factor.
    const ctx = context();
    ctx.beginFrame(1 / 60, snapshot({ cursor: { x: 42, y: 24, speed: 0, inside: true } }));
    expect(ctx.stageCursor).toEqual({ x: 42, y: 24 });
  });

  it('tracks how long the cursor has been still, separately from all input', () => {
    // Sleep is about *total* input, but some reactions want to know whether the hand
    // is resting on the cat rather than typing.
    const ctx = context();
    run(ctx, 3, { x: 10, y: 10 });
    expect(ctx.cursorStillFor).toBeCloseTo(3, 1);
    ctx.beginFrame(
      1 / 60,
      snapshot({ keyRate: 300, cursor: { x: 10, y: 10, speed: 0, inside: true } }),
    );
    expect(ctx.idleFor).toBe(0);
    expect(ctx.cursorStillFor).toBeCloseTo(3, 1);
  });
});

describe('Context robustness', () => {
  it('survives a backgrounded tab handing back a huge dt', () => {
    // Returning from a background tab can hand back seconds in one frame. The blink
    // ramp and pupil easing both use `1 - exp(-k*dt)`, which is stable for large dt
    // but must not produce NaN.
    const ctx = context();
    ctx.lookAt(1, 1);
    ctx.beginFrame(30, blankSnapshot());
    expect(Number.isFinite(ctx.blink)).toBe(true);
    expect(Number.isFinite(ctx.pupil.x)).toBe(true);
    expect(ctx.pupil.x).toBeLessThanOrEqual(THRESHOLDS.PUPIL_MAX_OFFSET + 1e-6);
  });

  it('survives a zero dt', () => {
    const ctx = context();
    expect(() => ctx.beginFrame(0, blankSnapshot())).not.toThrow();
    expect(Number.isFinite(ctx.pupil.x)).toBe(true);
  });

  it('survives a negative dt', () => {
    // A clock that steps backwards should not push the pupils past their clamp.
    const ctx = context();
    ctx.lookAt(1, 0);
    ctx.beginFrame(-0.5, blankSnapshot());
    expect(Number.isFinite(ctx.pupil.x)).toBe(true);
  });
});
