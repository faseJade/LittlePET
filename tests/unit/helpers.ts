import { Mochi } from '../../src/renderer/pet/physics/mochi';
import type { PetContext } from '../../src/renderer/pet/behavior';
import { blankSnapshot } from '../../src/renderer/pet/context';
import type { PetSnapshot } from '../../src/shared/types';

/**
 * Test doubles for the renderer's per-frame state.
 *
 * The engine's only injection seam is the clock, so a fake `PetContext` is all it
 * takes to drive behaviors and the machine that runs them with no Electron, no
 * display and no `requestAnimationFrame` (PLAN.md 9.1).
 */
export function makeContext(overrides: Partial<PetContext> = {}): PetContext {
  return {
    dt: 1 / 60,
    time: 0,
    snapshot: blankSnapshot(),
    mochi: new Mochi(),
    facing: 1,
    position: { x: 0, y: 0 },
    walkUntil: 0,
    walkTarget: null,
    dragging: false,
    expression: 'neutral',
    idleFor: 0,
    asleep: false,
    suppressBlink() {},
    ...overrides,
  };
}

/** Advance a context's clock and a physics step, the way the real loop does. */
export function tick(ctx: PetContext, seconds: number, dt = 1 / 60): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    ctx.dt = dt;
    ctx.time += dt;
    ctx.mochi.update(dt);
  }
}

export function snapshot(overrides: Partial<PetSnapshot> = {}): PetSnapshot {
  return { ...blankSnapshot(), ...overrides };
}
