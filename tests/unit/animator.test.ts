import { describe, expect, it } from 'vitest';
import { Animator } from '../../src/renderer/pet/animator';

/**
 * The animation clock is the one piece of the engine every behavior depends on, and
 * the property that matters most is that it is framerate-independent: the cat must
 * not walk twice as fast on a 144 Hz display (PLAN.md 4.1).
 */

const WALK = [0, 1, 2, 3];
const DURATIONS = [100, 100, 100, 100];

describe('Animator', () => {
  it('advances one frame per authored duration', () => {
    const a = new Animator();
    a.set('walk', WALK, DURATIONS);

    expect(a.frame).toBe(0);
    a.update(0.1);
    expect(a.frame).toBe(1);
    a.update(0.1);
    expect(a.frame).toBe(2);
    a.update(0.1);
    expect(a.frame).toBe(3);
  });

  it('loops back to the first frame', () => {
    const a = new Animator();
    a.set('walk', WALK, DURATIONS);
    for (let i = 0; i < 4; i++) a.update(0.1);
    expect(a.frame).toBe(0);
  });

  it('reaches the same frame regardless of framerate', () => {
    // One second at 60 Hz is 60 steps; at 144 Hz it is 144; at 30 Hz it is 30. All
    // three must land on the same frame of a 400 ms cycle. Summing `dt` per frame
    // fails this: float error accumulates and the high-framerate case drifts.
    const at = (steps: number, dt: number) => {
      const a = new Animator();
      a.set('walk', WALK, DURATIONS);
      for (let i = 0; i < steps; i++) a.update(dt);
      return a.frame;
    };
    expect(at(60, 1 / 60)).toBe(at(144, 1 / 144));
    expect(at(60, 1 / 60)).toBe(at(30, 1 / 30));
  });

  it('does not visibly drift over a long run', () => {
    // 10 minutes at 144 Hz. Any dt-driven simulation accumulates float error: this
    // one ends ~1e-11 s off 600 s, which is eleven orders of magnitude below a frame
    // and therefore invisible. The assertion is that it is within a frame, not that
    // it is exact - demanding exactness would force wall-clock arithmetic into the
    // animation layer and make it untestable with a fake clock.
    const a = new Animator();
    a.set('walk', WALK, DURATIONS);
    const steps = 144 * 600;
    for (let i = 0; i < steps; i++) a.update(1 / 144);

    // 600 s is exactly 1500 cycles, so the position should be back at the start. A
    // sum of 86400 copies of 1/144 lands ~7e-13 s *under* 600 s, so the animation
    // wraps one fewer time and sits just short of the boundary rather than on it.
    // What matters is that it is at a boundary, not which side.
    const off = Math.min(a.position, a.duration - a.position);
    // Eight orders of magnitude below the shortest frame: it cannot produce a
    // visible desync. A tighter bound would be asserting float behaviour rather
    // than animation behaviour.
    expect(off).toBeLessThan(1e-6);
  });

  it('honours per-frame durations rather than a single loop duration', () => {
    // A contact pose held three times as long must be visible for three times as
    // long. Sampled before the boundary, since 0.2+0.2 lands exactly on it and
    // landing exactly on a boundary is a coin flip in any float scheme.
    const a = new Animator();
    a.set('walk', WALK, [300, 100, 100, 100]);
    a.update(0.2);
    expect(a.frame).toBe(0);
    a.update(0.19);
    expect(a.frame).toBe(1);
  });

  it('stops on the last frame when not looping', () => {
    const a = new Animator();
    a.loop = false;
    a.set('cheer', [7, 8], DURATIONS);
    a.update(0.1);
    expect(a.frameIndex).toBe(1);
    a.update(5);
    expect(a.frameIndex).toBe(1);
    expect(a.frame).toBe(8);
    expect(a.done).toBe(true);
  });

  it('reports phase within the current frame', () => {
    const a = new Animator();
    a.set('walk', WALK, DURATIONS);
    a.update(0.05);
    expect(a.t).toBeCloseTo(0.5, 5);
  });

  it('resets when the animation changes but not when it is re-set to itself', () => {
    const a = new Animator();
    a.set('walk', WALK, DURATIONS);
    a.update(0.25);
    expect(a.frame).toBe(2);

    expect(a.set('walk', WALK, DURATIONS)).toBe(false);
    expect(a.frame).toBe(2);

    expect(a.set('idle', WALK, DURATIONS)).toBe(true);
    expect(a.frame).toBe(0);
  });

  it('cannot be stalled by a zero duration', () => {
    const a = new Animator();
    a.set('broken', [0, 1, 2], [0, 0, 0]);
    expect(() => a.update(1)).not.toThrow();
  });
});
