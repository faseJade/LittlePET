import { THRESHOLDS } from '../../../shared/thresholds';
import { PRIORITY, type Behavior, type PetContext, type StopReason } from '../behavior';

/**
 * Idle life (PLAN.md 4.4).
 *
 * The fallback behavior. It is always legal, so the engine can never have "no
 * behavior running", and it is also the thing that decides what the cat does when
 * nothing more interesting is happening.
 *
 * The director is a weighted pick with cooldowns rather than a plain random draw,
 * because a uniform draw makes grooming and stretching appear twice in twenty
 * seconds and then not again for a minute. Weights below are tuned so the cat
 * mostly sits, occasionally looks around, and does something physical every so often.
 */
export class IdleBehavior implements Behavior {
  readonly id = 'idle';
  readonly priority = PRIORITY.idle;

  /** Seconds until the director may pick something new. */
  private nextAt = 0;
  /** Seconds the current flourish has been running. */
  private since = 0;
  private current = 'sit';

  canStart(_ctx: PetContext): boolean {
    return true;
  }

  start(ctx: PetContext): void {
    this.since = 0;
    // Don't immediately act on the very first frame, or the app looks twitchy.
    if (this.nextAt === 0) {
      this.nextAt = ctx.time + 2;
    }
  }

  update(ctx: PetContext): void {
    this.since += ctx.dt;

    // Waking up resets the director: the cat should not immediately yawn after
    // being asleep for three minutes.
    if (!ctx.asleep && this.current === 'sleep') {
      this.current = 'sit';
      this.since = 0;
      this.nextAt = ctx.time + 1.5;
    }

    if (ctx.time < this.nextAt) return;

    const gap =
      THRESHOLDS.IDLE_MIN_GAP + Math.random() * (THRESHOLDS.IDLE_MAX_GAP - THRESHOLDS.IDLE_MIN_GAP);
    this.nextAt = ctx.time + gap;
    this.current = pick(ctx);
    this.since = 0;
    // Flourishes that have their own behavior announce themselves here; `sit`,
    // `look` and `tail` are pose variants of the idle frame and need no dispatch.
    if (this.current === 'groom' || this.current === 'stretch') {
      this.pending = this.current;
    }
  }

  done(_ctx: PetContext): boolean {
    // Idle never finishes on its own; the engine leaves it when something better
    // starts. `sit` and `sleep` are both steady states.
    return false;
  }

  stop(_ctx: PetContext, _reason: StopReason): void {
    // No teardown: the idle state is stateless with respect to other behaviors.
  }

  /**
   * What the cat is doing while idle.
   *
   * The renderer reads this to pick a pose, and the main loop routes `groom` and
   * `stretch` to their own behaviors. Keeping the director dumb like this means a
   * new flourish is one array entry plus one behavior, not a new branch here.
   */
  get activity(): string {
    return this.current;
  }

  /** True on the frame a new flourish was chosen, so the loop can dispatch it. */
  consumeDispatch(): string | null {
    const picked = this.pending;
    this.pending = null;
    return picked;
  }

  private pending: string | null = null;
}

/**
 * Idle director.
 *
 * Asleep suppresses everything but `sleep`. Otherwise a weighted pick, biased by
 * how long the cat has been quiet: the longer it has sat there, the more likely a
 * physical flourish becomes, so the cat does not look frozen.
 */
const WEIGHTS: { name: string; weight: number; minIdle: number }[] = [
  { name: 'sit', weight: 34, minIdle: 0 },
  { name: 'look', weight: 22, minIdle: 4 },
  { name: 'tail', weight: 16, minIdle: 6 },
  { name: 'groom', weight: 12, minIdle: 20 },
  { name: 'stretch', weight: 9, minIdle: 35 },
  { name: 'yawn', weight: 7, minIdle: 45 },
];

function pick(ctx: PetContext): string {
  if (ctx.asleep) return 'sleep';
  const eligible = WEIGHTS.filter((w) => ctx.idleFor >= w.minIdle);
  const total = eligible.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of eligible) {
    r -= w.weight;
    if (r <= 0) return w.name;
  }
  return 'sit';
}
