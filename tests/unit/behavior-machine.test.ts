import { describe, expect, it } from 'vitest';
import {
  BehaviorMachine,
  PRIORITY,
  type Behavior,
  type PetContext,
  type StopReason,
} from '../../src/renderer/pet/behavior';
import { makeContext } from './helpers';

/**
 * The behavior machine (PLAN.md 4.2).
 *
 * Every feature in the project is a behavior plugged into this, so its two rules
 * carry the whole design: highest priority wins, and a behavior that has just
 * started is not allowed to yield on the very next frame. The second rule is what
 * stops animations appearing as single-frame flashes.
 */

interface Recorder {
  started: string[];
  stopped: Array<[string, StopReason]>;
  updated: string[];
}

interface FakeOptions {
  /** Is this behavior's trigger currently active? */
  available?: () => boolean;
  /** Held this many seconds before it will yield. */
  minDuration?: number;
  /**
   * Report `done` as soon as the trigger goes away. Every shipped behavior does
   * this - `walk` finishes when its target is reached, `drag` when the mouse is
   * released - and a behavior that did not would latch itself on forever, since
   * the machine keeps a running behavior until it reports done.
   */
  doneWhenTriggerEnds?: boolean;
  /** Only ever run once, so a finished behavior does not immediately restart. */
  once?: boolean;
}

/**
 * A stand-in behavior, recording everything the machine does to it.
 *
 * The defaults mirror the shipped behaviors rather than being maximally simple,
 * because a fake that behaves differently from the real thing tests the fake.
 */
class Fake implements Behavior {
  readonly minDuration?: number;
  startedCount = 0;
  private finished = false;

  private readonly opts: Required<Omit<FakeOptions, 'minDuration'>> & { minDuration?: number };

  constructor(
    readonly id: string,
    readonly priority: number,
    private readonly rec: Recorder,
    opts: FakeOptions = {},
  ) {
    this.opts = {
      available: () => true,
      doneWhenTriggerEnds: true,
      once: false,
      ...opts,
    };
    if (opts.minDuration !== undefined) this.minDuration = opts.minDuration;
  }

  canStart(_ctx: PetContext): boolean {
    if (this.opts.once && this.startedCount > 0) return false;
    return this.opts.available();
  }

  start(_ctx: PetContext): void {
    this.startedCount++;
    this.finished = false;
    this.rec.started.push(this.id);
  }

  update(_ctx: PetContext): void {
    this.rec.updated.push(this.id);
  }

  done(_ctx: PetContext): boolean {
    if (this.finished) return true;
    return this.opts.doneWhenTriggerEnds && !this.opts.available();
  }

  stop(_ctx: PetContext, reason: StopReason): void {
    this.rec.stopped.push([this.id, reason]);
  }

  /** Finish on its own terms, as a timed animation would. */
  finish(): void {
    this.finished = true;
  }
}

/** Run `frames` frames, advancing the clock so `minDuration` can elapse. */
function run(m: BehaviorMachine, ctx: PetContext, frames: number, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) {
    ctx.dt = dt;
    ctx.time += dt;
    m.update(ctx);
  }
}

describe('BehaviorMachine priority', () => {
  it('runs the highest-priority behavior that can start', () => {
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const low = new Fake('low', PRIORITY.idle, rec);
    const high = new Fake('high', PRIORITY.drag, rec);
    const m = new BehaviorMachine([low, high]); // deliberately unsorted

    run(m, makeContext(), 1);
    expect(m.active?.id).toBe('high');
    expect(rec.updated).toEqual(['high']);
  });

  it('falls through to a lower behavior when the high one cannot start', () => {
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const high = new Fake('high', PRIORITY.drag, rec, { available: () => false });
    const low = new Fake('low', PRIORITY.idle, rec);
    const m = new BehaviorMachine([high, low]);

    run(m, makeContext(), 1);
    expect(m.active?.id).toBe('low');
  });

  it('preempts the running behavior and reports why', () => {
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    let grabbed = false;
    const idle = new Fake('idle', PRIORITY.idle, rec);
    const drag = new Fake('drag', PRIORITY.drag, rec, { available: () => grabbed });
    const m = new BehaviorMachine([drag, idle]);
    const ctx = makeContext();

    run(m, ctx, 1);
    expect(m.active?.id).toBe('idle');

    grabbed = true;
    run(m, ctx, 1);
    expect(m.active?.id).toBe('drag');
    // 'preempted' is what a behavior uses to clean up a pose it was holding.
    expect(rec.stopped).toEqual([['idle', 'preempted']]);
  });

  it('re-derives selection every frame, so releasing the mouse drops straight back', () => {
    // The bug this prevents: a behavior latched by an earlier frame staying active
    // after its trigger is gone, leaving the cat stuck mid-animation or held in the
    // air. `done()` is what ends a running behavior, so a behavior whose trigger
    // vanishes must report it - the machine will not second-guess `done`.
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    let grabbed = false;
    const idle = new Fake('idle', PRIORITY.idle, rec);
    const drag = new Fake('drag', PRIORITY.drag, rec, { available: () => grabbed });
    const m = new BehaviorMachine([drag, idle]);
    const ctx = makeContext();

    grabbed = true;
    run(m, ctx, 5);
    expect(m.active?.id).toBe('drag');

    grabbed = false;
    run(m, ctx, 1);
    expect(m.active?.id).toBe('idle');
  });

  it('never restarts a behavior that is still running', () => {
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const idle = new Fake('idle', PRIORITY.idle, rec);
    const m = new BehaviorMachine([idle]);
    run(m, makeContext(), 60);
    expect(idle.startedCount).toBe(1);
  });
});

describe('BehaviorMachine minDuration', () => {
  /** A one-shot 0.4 s animation, the shape of the real `stretch` behavior. */
  const stretchOnce = (rec: Recorder, minDuration = 0.4) =>
    new Fake('stretch', PRIORITY.stretch, rec, { minDuration, once: true });

  it('holds a behavior past its minDuration even once it reports done', () => {
    // A stretch that appears for one frame and vanishes is worse than no stretch.
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const stretch = stretchOnce(rec);
    const m = new BehaviorMachine([stretch, new Fake('idle', PRIORITY.idle, rec)]);
    const ctx = makeContext();

    run(m, ctx, 1);
    expect(m.active?.id).toBe('stretch');

    stretch.finish();
    // 0.2 s in, still under the 0.4 s floor.
    run(m, ctx, 12);
    expect(m.active?.id).toBe('stretch');
    expect(rec.stopped).toEqual([]);
  });

  it('yields once both done and old enough', () => {
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const stretch = stretchOnce(rec);
    const m = new BehaviorMachine([stretch, new Fake('idle', PRIORITY.idle, rec)]);
    const ctx = makeContext();

    run(m, ctx, 1);
    stretch.finish();
    run(m, ctx, 30); // 0.5 s
    expect(m.active?.id).toBe('idle');
    expect(rec.stopped).toEqual([['stretch', 'preempted']]);
  });

  it('is enforced on time, not frame count, so framerate does not change it', () => {
    // At 30 Hz the floor must still be 0.4 s. Counting frames would make it 0.2 s on
    // a slow machine, which is the same "single-frame flash" bug at a different rate.
    // The bound is one frame of slack, since a transition can only be observed on a
    // frame boundary.
    const at = (dt: number) => {
      const rec: Recorder = { started: [], stopped: [], updated: [] };
      const stretch = stretchOnce(rec);
      const m = new BehaviorMachine([stretch, new Fake('idle', PRIORITY.idle, rec)]);
      const ctx = makeContext();
      run(m, ctx, 1, dt);
      const startedAt = ctx.time;
      stretch.finish();
      let frames = 0;
      while (m.active?.id === 'stretch' && frames < 1000) {
        run(m, ctx, 1, dt);
        frames++;
      }
      return ctx.time - startedAt;
    };
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const held = at(dt);
      expect(held, `dt=${dt}`).toBeGreaterThanOrEqual(0.4);
      expect(held, `dt=${dt}`).toBeLessThan(0.4 + dt);
    }
  });

  it('defaults to no floor, so a behavior with no minDuration yields immediately', () => {
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const blink = new Fake('blink', PRIORITY.think, rec, { once: true });
    const m = new BehaviorMachine([blink, new Fake('idle', PRIORITY.idle, rec)]);
    const ctx = makeContext();

    run(m, ctx, 1);
    blink.finish();
    run(m, ctx, 1);
    expect(m.active?.id).toBe('idle');
  });
});

describe('BehaviorMachine teardown', () => {
  it('updates only the active behavior', () => {
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const drag = new Fake('drag', PRIORITY.drag, rec);
    const idle = new Fake('idle', PRIORITY.idle, rec);
    const m = new BehaviorMachine([drag, idle]);
    run(m, makeContext(), 3);
    expect(rec.updated).toEqual(['drag', 'drag', 'drag']);
  });

  it('reports interrupted, not preempted, on quit', () => {
    // The two reasons mean different things to a behavior: 'preempted' means "someone
    // better took over", 'interrupted' means "the world is going away". A behavior
    // that cancels a timer must be able to tell.
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const idle = new Fake('idle', PRIORITY.idle, rec);
    const m = new BehaviorMachine([idle]);
    const ctx = makeContext();
    run(m, ctx, 1);
    m.dispose(ctx);
    expect(rec.stopped).toEqual([['idle', 'interrupted']]);
    expect(m.active).toBeNull();
  });

  it('is safe to dispose with nothing running', () => {
    const m = new BehaviorMachine([
      new Fake('idle', PRIORITY.idle, { started: [], stopped: [], updated: [] }),
    ]);
    expect(() => m.dispose(makeContext())).not.toThrow();
  });

  it('leaves no behavior running when none can start', () => {
    // In practice idle is always legal, so this state is unreachable - but a machine
    // that returns a null active with a stale `current` would keep updating a
    // behavior the caller believes has ended.
    const rec: Recorder = { started: [], stopped: [], updated: [] };
    const gated = new Fake('gated', PRIORITY.drag, rec, { available: () => false });
    const m = new BehaviorMachine([gated]);
    run(m, makeContext(), 3);
    expect(m.active).toBeNull();
  });
});

describe('PRIORITY', () => {
  /** Strongest first: dragging the cat outranks everything it could be doing. */
  const ORDERED = [
    'drag',
    'stretch',
    'pet',
    'hunt',
    'unroll',
    'think',
    'knead',
    'walk',
    'groom',
    'idle',
  ] as const;

  it('keeps input above output', () => {
    // The whole table is one idea: what the user is doing right now outranks what
    // the cat has decided to do. Grabbing the cat must suspend every idle flourish,
    // or a groom animation continues in mid-scratch while the cat is in the air.
    expect(Object.keys(PRIORITY).sort()).toEqual([...ORDERED].sort());
    for (let i = 1; i < ORDERED.length; i++) {
      expect(PRIORITY[ORDERED[i]!], `${ORDERED[i]} vs ${ORDERED[i - 1]}`).toBeLessThan(
        PRIORITY[ORDERED[i - 1]!],
      );
    }
  });

  it('has a distinct value per behavior', () => {
    // Equal priorities would make selection depend on array order, which is not a
    // property anyone can reason about from the table.
    const values = Object.values(PRIORITY);
    expect(new Set(values).size).toBe(values.length);
  });

  it('ranks idle last, because it is the fallback and must never outrank anything', () => {
    expect(PRIORITY.idle).toBe(Math.min(...Object.values(PRIORITY)));
  });
});
