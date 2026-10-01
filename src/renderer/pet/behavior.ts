import type { PetSnapshot } from '../../shared/types';
import type { Mochi } from './physics/mochi';

/**
 * The single source of truth handed to every behavior each frame.
 *
 * Behaviors read this and never reach for globals, which is what makes them
 * testable with a fake snapshot and no Electron.
 */
export interface PetContext {
  /** Seconds since the last frame. Everything is delta-time driven. */
  dt: number;
  /** Seconds since start. Injected, never read from the clock directly. */
  time: number;
  snapshot: PetSnapshot;

  /** Mochi squash/stretch, updated by the physics step. */
  mochi: Mochi;
  /** 1 = facing right, -1 = facing left. */
  facing: 1 | -1;

  /**
   * The cat's offset inside the stage, in logical pixels. Behaviors that move the
   * cat write here; the renderer clamps it to the stage bounds before drawing.
   */
  position: { x: number; y: number };

  /** Set by the idle director: when walking should stop. */
  walkUntil: number;
  /** Where the cat is heading, in stage pixels. Null when not walking. */
  walkTarget: { x: number } | null;
  /** Set while the user has grabbed the cat. */
  dragging: boolean;
  /** Set by behaviors that want an effect overlay on the eye layer. */
  expression: ExpressionName;

  /** Seconds since any input was seen. Drives the idle director's weighting. */
  idleFor: number;
  /** True once the cat has been quiet long enough to fall asleep. */
  asleep: boolean;
  /** Postpone the next blink, so a dramatic expression is not blinked through. */
  suppressBlink(): void;
}

export type ExpressionName =
  'neutral' | 'happy' | 'sad' | 'surprised' | 'thinking' | 'dead' | 'sleepy';

export type StopReason = 'preempted' | 'finished' | 'interrupted';

/**
 * One user-visible reaction. Every one of the project's features is one of
 * these (PLAN.md 4.1).
 */
export interface Behavior {
  readonly id: string;
  /** Higher wins. See the priority table in PLAN.md 4.2. */
  readonly priority: number;
  /** Pure predicate over context. */
  canStart(ctx: PetContext): boolean;
  start(ctx: PetContext): void;
  /** `ctx.dt` is seconds, never a frame count. */
  update(ctx: PetContext): void;
  /** True when the behavior has finished on its own terms. */
  done(ctx: PetContext): boolean;
  stop(ctx: PetContext, reason: StopReason): void;
  /** Held this many seconds before it will yield, to avoid single-frame flashes. */
  readonly minDuration?: number;
}

export const PRIORITY = {
  drag: 100,
  stretch: 50,
  pet: 40,
  hunt: 30,
  unroll: 25,
  think: 20,
  knead: 10,
  walk: 5,
  groom: 4,
  idle: 0,
} as const;

/**
 * Priority-stack state machine.
 *
 * Each frame it picks the highest-priority behavior whose `canStart` passes.
 * A started behavior keeps running until it reports `done` *and* has been alive
 * for at least `minDuration`, so transitions are never a single dropped frame.
 *
 * Because selection is re-derived every frame, releasing the mouse drops the cat
 * straight back to walking or idling - never to a stale state.
 */
export class BehaviorMachine {
  private readonly behaviors: Behavior[] = [];
  private current: Behavior | null = null;
  private currentSince = 0;

  constructor(behaviors: Behavior[]) {
    this.behaviors = [...behaviors].sort((a, b) => b.priority - a.priority);
  }

  get active(): Behavior | null {
    return this.current;
  }

  private pick(ctx: PetContext): Behavior | null {
    for (const b of this.behaviors) {
      if (this.current === b) {
        // Already-running behaviors keep their slot unless they have finished.
        if (!b.done(ctx) || ctx.time - this.currentSince < (b.minDuration ?? 0)) return b;
        continue;
      }
      if (b.canStart(ctx)) return b;
    }
    return null;
  }

  update(ctx: PetContext): void {
    const next = this.pick(ctx);

    if (next !== this.current) {
      if (this.current) this.current.stop(ctx, 'preempted');
      if (next) {
        next.start(ctx);
        this.currentSince = ctx.time;
      }
      this.current = next;
    }

    this.current?.update(ctx);
  }

  /** Tear everything down, e.g. on quit. */
  dispose(ctx: PetContext): void {
    this.current?.stop(ctx, 'interrupted');
    this.current = null;
  }
}
