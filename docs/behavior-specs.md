# Behavior specifications

One entry per reaction: what triggers it, what it looks like, how it ends, and what it must not do.
[PLAN.md §10](../PLAN.md) requires a feature to be documented here to be called done, so this file
and `docs/PARITY.md` are updated in the same commit.

Feature numbers refer to the [parity matrix](../PLAN.md#1-feature-parity-matrix). Status refers to
`docs/PARITY.md`, which is the authority — nothing here claims more than that table does.

---

## Shared contract

Every reaction is a `Behavior` (`src/renderer/pet/behavior.ts`):

| Method              | Contract                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `canStart(ctx)`     | **Pure predicate.** Reads context, mutates nothing. Called every frame for every behavior.          |
| `start(ctx)`        | Reset internal state. Do not act — `update` runs immediately after.                                 |
| `update(ctx)`       | `ctx.dt` is **seconds**, never a frame count.                                                       |
| `done(ctx)`         | True when it has finished **on its own terms**, not when it has been interrupted.                   |
| `stop(ctx, reason)` | Release everything. Must leave the world in a clean state.                                          |
| `minDuration`       | Optional. Held at least this long before it will yield, so a transition is never one dropped frame. |

Selection is re-derived every frame. Nothing latches.

### Rules every behavior must obey

1. **Delta time only.** No frame counting, no `Date.now()`, no `setTimeout`. The renderer contains
   no wall-clock reads at all, and a test enforces it.
2. **No allocation in `update`.** Write numbers into `ctx`. The performance budget is tight and this
   is the hot path.
3. **All positions are stage-local logical pixels.** `ctx.position` is the cat's _offset_ inside the
   stage; the renderer clamps it before drawing. Behaviors never compute display scale factors.
4. **Release on `stop`.** Set `walkTarget = null`, clear `requested`, reset timers. A behavior that
   resumes later in a half-finished state reads as the cat remembering something, which is the one
   effect that always looks like a bug.
5. **Expressions via `ctx.expression`,** not by drawing. `suppressBlink()` is available so a dramatic
   moment is not blinked through.
6. **Degrade politely.** If the required art or signal is absent (`atlas.has(name)`, `hookActive`),
   do nothing rather than throw. The app must run with the native hook disabled.

---

## drag — priority 100

**Feature:** the core interaction. Physical rather than reactive. No parity row; it is the engine.

**Trigger.** The user presses the primary button while the cursor is on the cat's opaque pixels.
Detection is in `src/renderer/pet/hit.ts`; the renderer sends `dragStart`, and main takes over the
window position.

**What it does.** The cat hangs from the cursor (`dangle` pose) and its body **lags** the pointer.
The window follows the cursor exactly — so the cat is not parented to the mouse, it is a mass with
velocity, and fast movement visibly stretches it.

**Mochanics.** `src/renderer/pet/physics/mochi.ts`:

- Two orthogonal springs sharing one mass, negatively coupled **on their deviation**, so volume is
  roughly preserved — stretching wide bulks tall and vice versa.
- Integrated with semi-implicit Euler at a fixed 1/240 s sub-step. Feel is identical at 60, 120 and
  144 Hz.
- Drag velocity is injected as **spring velocity**, scaled by `dt`, so it behaves as a force
  proportional to drag speed rather than an impulse applied once per rendered frame. Adding directly
  to the scale would teleport the cat past its clamps and bypass the springs entirely.
- Lateral wobble is a real damped torsional oscillator, not an exponential decay. Without the
  restoring term the angle just tilts and stops instead of jiggling. Opposite sign from the drag, so
  the cat lags the hand.
- When an axis hits a clamp, its **velocity** is set to the inward component rather than left alone.
  Clamping position while keeping velocity lets the spring keep pushing outward every sub-step, and
  the cat stays pinned at the limit even after the drag stops.

**Ends** when the springs return within 0.02 of neutral and the button is up. `done()` is
`!ctx.dragging && !ctx.mochi.deformed` — the settling is part of the behavior, so the cat does not
snap back to neutral the instant it is released.

**Also.** `impact()` fires on a downward release (`drag.vy > 120`), so a gentle placement does not
bounce. A global `mouseup` in main ends the drag, because the renderer cannot see a release outside
its window and a fast flick is exactly the case that would leave the cat stuck.

**Must not.** Take the click when the cursor is not on the cat. Consume the drag mode transition more
than once per frame.

---

## walk — priority 5

**Feature:** none. Idle-life infrastructure.

**Trigger.** The idle director sets `ctx.walkTarget` and clears `ctx.walkUntil`.

**What it does.** Walks to the target at `WALK_SPEED` (34 px/s) with the correct `facing`, then
yields: on arrival it clears the target and holds `walkUntil = time + 1.5` so it cannot immediately
re-claim.

**Ends** at the target, or when preempted.

**Must not.** Freeze mid-stride when preempted. `stop()` clears the target — resuming a half-finished
walk later is one of the clearest "this is a bug" tells.

---

## groom — priority 4

**Feature:** none. Idle-life flourish.

**Trigger.** `request()` from the idle director. Legal only when not dragging and not asleep.

**What it does.** 2.2 s of self-grooming, muzzle down. Expression goes `sleepy` for the first half,
then `happy` — reading as concentration, not as falling asleep on its own paw.

**Why a behavior and not an animation flag.** It has to be interruptible. Picking the cat up
mid-lick must stop it instantly and must not resume licking in mid-air.

**Ends** after 2.2 s.

---

## idle — priority 0

**Feature:** none. The fallback, and the director that decides what the cat does when nothing
interesting is happening.

**Trigger.** Always legal. The engine can therefore never have "no behavior running", and there is no
state to recover from.

**What it does.** A weighted pick with cooldowns, biased by how long the cat has been quiet, so a
uniform draw does not make grooming appear twice in twenty seconds and then not again for a minute:

| Activity  | Weight | Requires `idleFor` ≥ |
| --------- | ------ | -------------------- |
| `sit`     | 34     | 0 s                  |
| `look`    | 22     | 4 s                  |
| `tail`    | 16     | 6 s                  |
| `groom`   | 12     | 20 s                 |
| `stretch` | 9      | 35 s                 |
| `yawn`    | 7      | 45 s                 |

`sit`, `look`, `tail` and `yawn` are pose variants of the idle frame and need no dispatch. `groom` and
`stretch` announce themselves through `consumeDispatch()` so the loop can route them to the behavior
that owns them — the director stays free of a branch per behavior.

**Never finishes.** `done()` is always false; the engine leaves idle when something better starts.

**Details.** First run waits 2 s, so the app does not look twitchy on launch. Waking from sleep resets
the director with a 1.5 s cooldown, so the cat does not immediately yawn after a three-minute nap.
`sleep` is the only activity allowed while `ctx.asleep`.

---

# M2 — input reactions

Not implemented. Recorded here so the spec exists before the code does.

## hunt — priority 30 · feature 04

**Trigger.** Smoothed cursor speed above `HUNT_SPEED` (55 px/s) sustained briefly, cursor within the
stage. **Requires the global hook** for the system-wide part; without it the cat can still notice the
cursor inside its own window.

**What it does.** Chases the cursor at a chase speed, deliberately _slower_ than a human hand, so it
never actually catches up. Should give up after a fixed number of seconds and return to idle with
visible disappointment — the failure is what makes it funny.

**Ends** on arrival, on timeout, or when the cursor leaves the stage.

**Must not.** Keep winning. A pet that always succeeds is less interesting than one that tries.

## pet — priority 40 · feature 05

**Trigger.** Cursor resting on the cat's head/shoulder region for a sustained period. Use
`HitTester.locate()` to ask _where_ on the cat the cursor is, not just that it is on the cat.

**What it does.** Eyes half-close, a purr rumble, a slow squash loop. Purring accumulates while the
hand stays put and decays over ~2 s after it leaves, so the cat notices the difference.

**Ends** when the hand leaves, after a minimum duration so it does not flicker.

## knead — priority 10 · feature 06

**Trigger.** `keyRate` above `TYPING_ACTIVE` (40 keys/min). Counts only — see the note below.

**What it does.** Alternates its front paws, one per burst of keys, so it looks like it is kneading
_your typing_ rather than to a metronome.

**Ends** when the rate drops below the threshold and a short tail of animation plays out.

**Privacy.** This behavior is derived entirely from `snapshot.keyRate` — a number. It never sees,
stores, or logs what was typed, and it cannot: `InputSampler.countKey()` takes no parameters and the
snapshot has no field that could hold key content.

## overheat — priority 0 (mode, not behavior) · feature 07

**Trigger.** `keyRate` above `OVERHEAT_ENTER_RATE` (240) sustained for `OVERHEAT_ENTER_SEC` (3).
**Sustained is the whole point** — without the dwell time, every typing burst overheats the cat.

**What it does.** A colour shift toward hot (the `effect` slot), sweat, faster breathing, drooping
ears. A mode rather than a behavior: it persists while the condition holds and is expressed through
overlays, not through a new pose.

**Ends** below `OVERHEAT_EXIT_RATE` (120) for `OVERHEAT_EXIT_SEC` (5). The asymmetric hysteresis
stops the mode flickering when typing hovers near the threshold.

## unroll — priority 25 · feature 10

**Trigger.** Accumulated `wheelEnergy` above `UNROLL_ENERGY` (90). Energy is the sum of absolute
wheel deltas, bled at `UNROLL_DECAY`/s, so it is framerate-independent.

**What it does.** The cat unrolls into a scroll of paper and plays with it — the cat as the physical
consequence of your scrolling. Should run out of paper and reset, which is the joke's payload.

**Ends** when the paper runs out, or when energy has bled below zero.

---

# M3 — reminders

## stretch — priority 50 · feature 08

Fires on a scheduler interval (default 45 min). Raises the cat and stretches, scaling up to
`MAX_STRETCH_SCALE` (1.4). Priority 50 so it is interrupted by a grab but preempts walking.

## water — reminder · feature 09

Default 60 min. A bubble with a glass; no new pose needed, so it is a speech bubble plus an
expression.

## message / fixed note — features 14, 15

`messageReminders` fire at a minute-of-day, `fixedNote` shows a pinned string. Both are stage UI
layer (draw order 4), not sprites.

## tell your name — feature 16

The pet name in a bubble on first launch and on request. Uses `settings.petName`, which is empty by
default.

---

# M4 — pomodoro · feature 13

A focus/break cycle with a floating pixel timer beside the cat. The timer is drawn in stage UI using
the `prop` slot, not as a sprite animation, so it needs no art and cannot desync.

---

# M5 — agent integration

## think — priority 20 · feature 11

Opt-in status-file watching (no network, no process scraping by default). Detection must degrade
silently when the agent is not running.

## agent done jump — feature 12

On a completion signal: eyes wide, then a small hop with a landing squash. The `Mochi.impact()` path
already does the squash correctly, so this is a behavior plus a frame of art.

---

# M6 — peek · feature 18

The cat wanders to the window edge and peeks around it. Optional, off by default: a pet that
climbs into your windows is a pet you turn off.
