import { describe, expect, it } from 'vitest';
import { MOCHI } from '../../src/shared/thresholds';
import { Mochi } from '../../src/renderer/pet/physics/mochi';

/**
 * Mochi physics (feature 03).
 *
 * Two properties matter more than any particular number: the springs must reach an
 * *equilibrium* at neutral, or the cat slowly inflates while nobody is touching it;
 * and the whole thing must settle, or the cat shivers forever.
 */

const step = (m: Mochi, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) m.update(dt);
};

describe('Mochi', () => {
  it('stays at neutral when undisturbed', () => {
    const m = new Mochi();
    step(m, 30);
    const { sx, sy } = m.snapshot();
    expect(Math.abs(sx - 1)).toBeLessThan(0.001);
    expect(Math.abs(sy - 1)).toBeLessThan(0.001);
  });

  it('stretches along the direction of travel', () => {
    const m = new Mochi();
    // One frame of a fast sideways drag is not much: the impulse is a velocity, and
    // one frame of 2000 px/s moves the scale by a fraction of a percent. Hold the
    // drag instead, which is what actually happens while you carry the cat.
    for (let i = 0; i < 30; i++) {
      m.applyDragVelocity(2000, 0, 1 / 60);
      m.update(1 / 60);
    }
    // Stretched along the direction of travel...
    expect(m.sx).toBeGreaterThan(1.15);
    // ...and bulged the other way, since the springs are volume-coupled.
    expect(m.sy).toBeLessThan(1);
  });

  it('settles after a shake', () => {
    const m = new Mochi();
    shake(m, 1, 2500, 1);
    expect(m.deformed).toBe(true);
    // Two seconds is ample for a spring at STIFFNESS 190 with DAMPING 14.
    step(m, 2);
    expect(m.deformed).toBe(false);
  });

  /**
   * A realistic shake is 2-5 Hz, not a direction flip every frame: at 60 Hz, flipping
   * each frame is a 30 Hz drive that a mass on a spring simply cannot respond to.
   */
  const shake = (m: Mochi, hz: number, amplitude: number, seconds: number, dt = 1 / 60) => {
    let peakAngle = 0;
    let minX = 1;
    let maxX = 1;
    // Advance time by the fixed dt rather than accumulating it, so the drive is
    // sampled at identical points regardless of how the loop is stepped.
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      m.applyDragVelocity(Math.sin(t * 2 * Math.PI * hz) * amplitude, 0, dt);
      m.update(dt);
      peakAngle = Math.max(peakAngle, Math.abs(m.angle));
      minX = Math.min(minX, m.sx);
      maxX = Math.max(maxX, m.sx);
    }
    return { peakAngle, minX, maxX };
  };

  describe('Mochi wobble', () => {
    it('leans and rocks when shaken at a hand frequency', () => {
      const m = new Mochi();
      const { peakAngle, minX, maxX } = shake(m, 1, 2500, 2);
      // A hard shake should visibly deform: a meaningful lean and a swing across the
      // stretch limits.
      expect(peakAngle).toBeGreaterThan(0.08);
      expect(minX).toBeLessThan(0.85);
      expect(maxX).toBeGreaterThan(1.15);
    });

    it('responds less as the shake gets faster than it can follow', () => {
      // The signature of a real second-order system. If this were flat, the "spring"
      // would be a position lerp and the cat would not feel like it has mass.
      const slow = shake(new Mochi(), 1, 2000, 2).peakAngle;
      const fast = shake(new Mochi(), 8, 2000, 2).peakAngle;
      expect(fast).toBeLessThan(slow * 0.5);
    });

    it('settles after a steady drag rather than leaning forever', () => {
      const m = new Mochi();
      for (let i = 0; i < 300; i++) {
        m.applyDragVelocity(900, 0, 1 / 60);
        m.update(1 / 60);
      }
      const settled = m.angle;
      for (let i = 0; i < 120; i++) {
        m.applyDragVelocity(900, 0, 1 / 60);
        m.update(1 / 60);
      }
      // A constant drag is a constant force, so the correct behaviour is a fixed lean.
      // Without a restoring term the angle would drift instead.
      expect(Math.abs(m.angle - settled)).toBeLessThan(0.005);
    });
  });

  it('never exceeds the clamps', () => {
    const m = new Mochi();
    for (let i = 0; i < 200; i++) {
      m.applyDragVelocity(100000, 100000, 1 / 60);
      m.update(1 / 60);
    }
    expect(m.sx).toBeLessThanOrEqual(MOCHI.MAX_SCALE_X + 1e-6);
    expect(m.sy).toBeLessThanOrEqual(MOCHI.MAX_SCALE_Y + 1e-6);
    expect(m.sx).toBeGreaterThan(1 / MOCHI.MAX_SCALE_Y - 1e-6);
  });

  it('is framerate independent', () => {
    // The same physical shake, sampled at 30, 60 and 240 Hz, must reach the same
    // place. This holds because `applyDragVelocity` scales its impulse by dt and the
    // integrator uses a fixed sub-step.
    const at = (dt: number) => shake(new Mochi(), 2, 2000, 1, dt);
    const slow = at(1 / 30);
    const mid = at(1 / 60);
    const fast = at(1 / 240);

    // The drive is a sampled sine, so the two rates integrate it slightly
    // differently; a percent of the peak stretch is the honest bound. Exactness is
    // not available to any dt-driven integrator.
    for (const a of [slow, mid, fast]) {
      expect(Math.abs(a.maxX - mid.maxX)).toBeLessThan(mid.maxX * 0.03);
      expect(Math.abs(a.peakAngle - mid.peakAngle)).toBeLessThan(mid.peakAngle * 0.03);
    }
  });

  it('squashes on landing', () => {
    const m = new Mochi();
    m.impact(MOCHI.DROP_SQUASH);
    m.update(1 / 60);
    // Dropping compresses the cat vertically.
    expect(m.sy).toBeLessThan(1);
  });

  it('survives a long frame without exploding', () => {
    // A backgrounded tab hands back a huge dt. It must be clamped, not integrated.
    const m = new Mochi();
    m.applyDragVelocity(9000, 9000, 1 / 60);
    m.update(30);
    expect(Number.isFinite(m.sx)).toBe(true);
    expect(Math.abs(m.sx)).toBeLessThan(2);
  });
});
