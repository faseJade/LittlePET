import { describe, expect, it } from 'vitest';
import { InputSampler } from '../../src/shared/sampler';
import type { PetSnapshot } from '../../src/shared/types';

/**
 * The sampler is the boundary between "the app watches how you use the computer"
 * and everything else, so it carries the project's privacy promise (PLAN.md 0.3).
 * These tests check both that the derived signals are right and - just as
 * importantly - that there is no path by which key *content* could be retained.
 */

const advance = (s: InputSampler, frames: number, dt = 1 / 60, x = 0, y = 0) => {
  let last: PetSnapshot = s.update(0, x, y);
  for (let i = 0; i < frames; i++) last = s.update(dt, x, y);
  return last;
};

describe('InputSampler', () => {
  it('reports a cursor speed that rises and is smoothed', () => {
    const s = new InputSampler();
    s.update(0, 0, 0);
    // One frame of 600 px in 1/60 s is 36000 px/s instantaneous.
    const snap = s.update(1 / 60, 600, 0);
    // Smoothed with alpha 0.3, so the first sample is well below the raw value.
    expect(snap.cursor.speed).toBeGreaterThan(0);
    expect(snap.cursor.speed).toBeLessThan(36000);

    // A second identical frame should converge toward it.
    const second = s.update(1 / 60, 1200, 0);
    expect(second.cursor.speed).toBeGreaterThan(snap.cursor.speed);
  });

  it('does not register motion while the cursor is still', () => {
    const s = new InputSampler();
    advance(s, 60);
    expect(s.update(1 / 60, 0, 0).cursor.speed).toBeCloseTo(0, 5);
  });

  it('counts keys into a per-minute rate', () => {
    const s = new InputSampler();
    // 60 keys spread over one second is 60 keys/min.
    for (let i = 0; i < 60; i++) s.countKey();
    expect(s.update(1 / 60, 0, 0).keyRate).toBeGreaterThan(0);
  });

  it('normalises by the seconds actually observed', () => {
    const s = new InputSampler();
    // One key in the first 1/60 s must not read as 3600 keys/min just because only
    // one bucket has been filled.
    s.countKey();
    const snap = s.update(1 / 60, 0, 0);
    expect(snap.keyRate).toBeLessThan(600);
  });

  it('resets key rate on blur', () => {
    const s = new InputSampler();
    for (let i = 0; i < 50; i++) s.countKey();
    expect(s.update(1 / 60, 0, 0).keyRate).toBeGreaterThan(0);
    s.resetKeys();
    expect(s.update(1 / 60, 0, 0).keyRate).toBe(0);
  });

  it('decays wheel energy exponentially', () => {
    const s = new InputSampler();
    s.addWheel(100);
    // Read it before any decay has run, so the starting value is unambiguous.
    const start = s.update(0, 0, 0).wheelEnergy;
    expect(start).toBe(100);

    let previous = start;
    for (let i = 0; i < 60; i++) previous = s.update(1 / 60, 0, 0).wheelEnergy;
    // UNROLL_DECAY is 6/s, so one second should bleed most of it away.
    expect(previous).toBeLessThan(start * 0.05);
  });

  it('decays wheel energy at the same rate regardless of framerate', () => {
    // Stepping time rather than accumulating it: a `t += dt` loop lands on a
    // slightly different total at each rate, which would be measuring the test's
    // float arithmetic rather than the decay.
    const at = (dt: number) => {
      const s = new InputSampler();
      s.addWheel(100);
      s.update(0, 0, 0);
      for (let i = 0; i * dt < 1; i++) s.update(dt, 0, 0);
      return s.update(0, 0, 0).wheelEnergy;
    };
    const slow = at(1 / 30);
    const fast = at(1 / 240);
    // Both should be near 100 * e^-6 = 0.25, the exact answer for UNROLL_DECAY 6.
    expect(slow).toBeGreaterThan(0);
    expect(Math.abs(slow / fast - 1)).toBeLessThan(0.02);
  });

  it('never lets wheel energy go negative', () => {
    const s = new InputSampler();
    advance(s, 600);
    expect(s.update(1 / 60, 0, 0).wheelEnergy).toBe(0);
  });

  it('does not retain key content, because there is nowhere to put it', () => {
    // The type signature is the guarantee: `countKey` takes no argument, so there is
    // no value a caller could pass, and therefore no field that could hold a key.
    // If someone later adds a parameter, this test still compiles and the review
    // diff is the signal - but the type itself is the real protection.
    const s = new InputSampler();
    s.countKey();
    s.countKey();

    const json = JSON.stringify(s.update(1 / 60, 0, 0));
    expect(json).not.toMatch(/key(?!Rate)/i);
    // The only key-shaped thing in the snapshot is the derived rate.
    expect(JSON.parse(json)).toHaveProperty('keyRate');
  });

  it('exposes hook status so the UI can explain degraded mode', () => {
    const s = new InputSampler();
    expect(s.update(0, 0, 0).hookActive).toBe(false);
    s.setHookActive(true);
    expect(s.update(0, 0, 0).hookActive).toBe(true);
  });

  it('tolerates a huge dt from a backgrounded tab', () => {
    const s = new InputSampler();
    s.update(0, 0, 0);
    const snap = s.update(30, 500, 500);
    expect(Number.isFinite(snap.cursor.speed)).toBe(true);
    expect(Number.isFinite(snap.wheelEnergy)).toBe(true);
  });
});
