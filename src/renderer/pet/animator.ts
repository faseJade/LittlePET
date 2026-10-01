/**
 * Frame-accurate, delta-time-driven animation playback.
 *
 * Frame durations are authored per frame in milliseconds, so a walk cycle can hold
 * a contact pose twice as long as its passing pose without any easing code.
 *
 * Time is tracked as an **absolute** position in the cycle rather than by summing
 * `dt` per frame. Summing is the obvious implementation and it is subtly wrong:
 * float error accumulates, so after a second of 144 Hz updates the animation can
 * be a hair behind the same second of 60 Hz updates, and the two disagree on which
 * frame is showing at a boundary. Deriving the frame from total elapsed time makes
 * the motion identical at any framerate (PLAN.md 4.1).
 */
export class Animator {
  private anim = '';
  /** Cumulative seconds at the *start* of each frame. Length = frames + 1. */
  private marks: number[] = [0];
  private cycle = 1;
  /** Total seconds played in this cycle. Wraps at `cycle` for looping animations. */
  private elapsed = 0;
  private started = false;
  private finished = false;

  /** Set false for one-shot animations so playback stops on the last frame. */
  loop = true;

  /** Call when the active animation changes. Resets playback. */
  set(name: string, frames: readonly number[], durations: readonly number[]): boolean {
    if (name === this.anim) return false;
    this.anim = name;
    this.rebuild(frames, durations);
    return true;
  }

  /**
   * Replace the frame list without changing the animation name.
   *
   * Needed when an animation's frames are the same but its playback should restart,
   * and when the atlas is rebuilt underneath us (a palette change).
   */
  restart(frames: readonly number[], durations: readonly number[]): void {
    this.rebuild(frames, durations);
  }

  private rebuild(frames: readonly number[], durations: readonly number[]): void {
    this.frames = frames;
    // A floor on every duration: a zero-duration authoring mistake should stall,
    // not become an infinite loop or a division by zero.
    const marks: number[] = [0];
    for (let i = 0; i < frames.length; i++) {
      const seconds = Math.max((durations[i] ?? 100) / 1000, 1 / 1000);
      marks.push(marks[i]! + seconds);
    }
    this.marks = marks;
    this.cycle = marks[marks.length - 1] || 1;
    this.elapsed = 0;
    this.index = 0;
    this.started = false;
    this.finished = false;
  }

  private frames: readonly number[] = [];

  get animation(): string {
    return this.anim;
  }

  /** The flat frame number to draw. */
  get frame(): number {
    if (this.frames.length === 0) return 0;
    if (this.finished) return this.frames[this.frames.length - 1]!;
    return this.frames[this.index]!;
  }

  /** Index within the animation, for looking up per-frame metadata. */
  get frameIndex(): number {
    return this.finished ? this.frames.length - 1 : this.index;
  }

  /** 0..1 progress through the current frame. */
  get t(): number {
    if (this.finished) return 1;
    const start = this.marks[this.index]!;
    const end = this.marks[this.index + 1]!;
    return end <= start ? 1 : clamp01((this.elapsed - start) / (end - start));
  }

  /** True when a non-looping animation has played its last frame. */
  get done(): boolean {
    return this.finished;
  }

  update(dt: number): void {
    if (this.frames.length === 0) return;
    this.started = true;
    this.elapsed += dt;

    if (!this.loop && this.elapsed >= this.cycle) {
      this.finished = true;
      return;
    }

    if (this.loop && this.cycle > 0) {
      // `elapsed` can only exceed the cycle by one frame's worth of dt, but a
      // backgrounded tab can hand us a huge dt, so loop defensively.
      this.elapsed %= this.cycle;
    }
    this.index = findFrame(this.marks, this.elapsed, this.frames.length);
  }

  private index = 0;

  /** Jump to a frame, e.g. to hold a contact pose. */
  seek(index: number): void {
    const i = Math.max(0, Math.min(index, this.frames.length - 1));
    this.index = i;
    this.elapsed = this.marks[i] ?? 0;
    this.finished = false;
  }

  /** True until the first `update`. Lets a caller distinguish "not started" from frame 0. */
  get begun(): boolean {
    return this.started;
  }

  /**
   * Seconds into the current cycle.
   *
   * Exposed for tests that check framerate independence: comparing where two
   * framerates agree needs a position, not a frame number, because at a frame
   * boundary two legitimately different answers are both "correct".
   */
  get position(): number {
    return this.elapsed;
  }

  /** Total length of one cycle, in seconds. */
  get duration(): number {
    return this.cycle;
  }
}

/**
 * Which frame contains `elapsed`.
 *
 * Binary search, because a long animation would otherwise cost a linear scan every
 * frame and the per-frame budget in PLAN.md 9.2 is tight.
 */
function findFrame(marks: readonly number[], elapsed: number, count: number): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marks[mid]! <= elapsed) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
