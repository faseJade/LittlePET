import { PRIORITY, type Behavior, type PetContext, type StopReason } from '../behavior';

/**
 * Self-grooming, one of the idle-life flourishes (PLAN.md 4.4).
 *
 * It is a behavior rather than an animation flag because grooming has to be
 * interruptible: if you pick the cat up mid-lick it must stop instantly and not
 * resume licking in mid-air.
 */
export class GroomBehavior implements Behavior {
  readonly id = 'groom';
  readonly priority = PRIORITY.groom;

  /** Total length. Long enough to read as a deliberate action, short enough not to nag. */
  private static readonly DURATION = 2.2;
  private elapsed = 0;

  canStart(ctx: PetContext): boolean {
    return this.requested && !ctx.dragging && !ctx.asleep;
  }

  private requested = false;

  /** Called by the idle director. */
  request(): void {
    this.requested = true;
  }

  start(ctx: PetContext): void {
    this.requested = false;
    this.elapsed = 0;
    ctx.expression = 'sleepy';
  }

  update(ctx: PetContext): void {
    this.elapsed += ctx.dt;
    // Eyes close halfway through, which reads as concentration rather than as
    // the cat falling asleep on its own paw.
    ctx.expression = this.elapsed > GroomBehavior.DURATION * 0.5 ? 'happy' : 'sleepy';
  }

  done(_ctx: PetContext): boolean {
    return this.elapsed >= GroomBehavior.DURATION;
  }

  stop(ctx: PetContext, _reason: StopReason): void {
    this.requested = false;
    ctx.expression = 'neutral';
  }
}
