import { THRESHOLDS } from '../../../shared/thresholds';
import { PRIORITY, type Behavior, type PetContext, type StopReason } from '../behavior';

/**
 * Wander (PLAN.md 4.4).
 *
 * The cat walks because it felt like it, not because it was told to. This
 * behavior claims the walk slot when the idle director asks for one, walks to a
 * target at a constant speed, then yields so something else can happen.
 *
 * It sits at priority 5, above idle, so it wins the slot as soon as it can start -
 * but because selection is re-derived every frame, dropping a walk target mid-step
 * releases it cleanly instead of leaving the cat frozen mid-stride.
 */
export class WalkBehavior implements Behavior {
  readonly id = 'walk';
  readonly priority = PRIORITY.walk;

  /** Set by the idle director to request a walk in a direction. */
  requested: number | null = null;

  canStart(ctx: PetContext): boolean {
    if (ctx.dragging) return false;
    return ctx.time >= ctx.walkUntil && ctx.walkTarget !== null;
  }

  start(ctx: PetContext): void {
    // A walk with no target is a mistake in the caller; fall back to idle rather
    // than standing still while claiming the walk slot.
    if (!ctx.walkTarget) {
      ctx.walkUntil = 0;
      return;
    }
    ctx.facing = ctx.walkTarget.x >= ctx.position.x ? 1 : -1;
  }

  update(ctx: PetContext): void {
    const target = ctx.walkTarget;
    if (!target) return;

    const dx = target.x - ctx.position.x;
    const step = THRESHOLDS.WALK_SPEED * ctx.dt;

    if (Math.abs(dx) <= step) {
      ctx.position.x = target.x;
      ctx.walkTarget = null;
      ctx.walkUntil = ctx.time + 1.5;
      return;
    }
    ctx.position.x += Math.sign(dx) * step;
    ctx.facing = dx > 0 ? 1 : -1;
  }

  done(ctx: PetContext): boolean {
    return ctx.walkTarget === null;
  }

  stop(ctx: PetContext, _reason: StopReason): void {
    // Release the target. If we were preempted the higher-priority behavior owns
    // the cat's attention, and resuming a half-finished walk later reads as the
    // cat remembering where it was going.
    ctx.walkTarget = null;
    ctx.walkUntil = ctx.time + 1;
  }
}
