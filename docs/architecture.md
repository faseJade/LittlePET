# Architecture

How LittlePET is put together, and why it is split the way it is. Read this if you want to change
behaviour without accidentally changing the privacy model, the performance budget, or the
click-through feel.

The short version: **two processes, one channel, and no shared globals.**

```
┌─ main ────────────────────────────────── owns input · time · persistence ──┐
│                                                                          │
│  uiohook ─┐                                                                │
│  screen  ─┴→ InputSampler ─→ PetSnapshot ─60 Hz─→ MessagePortMain         │
│                                    │                        │             │
│  SettingsStore (JSON, atomic)        │                        │             │
│  Tray, stage-window geometry, work-area clamping                          │
└──────────────────────────────────────┼────────────────────────┼────────────┘
                                       │ structured clone       │ structured clone
┌─ preload ────────────────────────────┼────────────────────────┼────────────┐
│  exposes `window.littlepet` — no ipcRenderer, no fs, no require            │
└──────────────────────────────────────┼────────────────────────┼────────────┘
                                       │                        │
┌─ renderer (pet, sandboxed) ──────────┼────────────────────────┼────────────┐
│                                                                          │
│  Context (injected clock, blink, pupils)                                 │
│      ↓ per frame                                                          │
│  BehaviorMachine → Behavior[]  →  Context.position / expression           │
│      ↓                                                                  │
│  Mochi physics → Animator → Renderer (body atlas + eye layer + overlays)  │
│      ↓                                                                  │
│  HitTester → PetCommand { inputMode, dragStart, dragEnd }  ──────────────┘
└──────────────────────────────────────────────────────────────────────────┘
```

## Why the split is where it is

Three things the renderer _cannot_ do, so main does them:

| Concern         | Why it cannot live in the renderer                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Input**       | The global hook is a Node native addon, and `uiohook-napi` is loaded from `node_modules` at runtime. Also, `focusable: false` means the stage window does not receive keyboard focus, so it cannot reliably see key events at all. |
| **Time**        | The stage window is `backgroundThrottling: false`, but a hidden or occluded window still has unreliable timers on some platforms, and reminders (M3) must fire whether or not anyone is looking at the cat.                        |
| **Persistence** | The renderer runs with `sandbox: true` and no filesystem access. There is no path from pet code to disk.                                                                                                                           |

Everything else — simulation, drawing, hit testing — lives in the renderer, because that is what
makes it testable without Electron.

## The bridge

`window.littlepet` has exactly four methods (`src/shared/api.ts`):

| Method                | Direction             | Frequency |
| --------------------- | --------------------- | --------- |
| `connect()`           | renderer → main, once | 1         |
| `init()`              | renderer → main, once | 1         |
| `__deliver(snapshot)` | main → renderer       | **60/s**  |
| `send(command)`       | renderer → main       | on change |

The 60 Hz channel is a `MessageChannelMain` pair, not `ipcMain.invoke`. `invoke` is a request/reply
round trip with its own promise bookkeeping, and doing that 60 times a second to deliver one small
object is the wrong shape. A transferred port is one long-lived channel that main pushes into and
the renderer listens to.

`PetSnapshot` is the entire vocabulary of input. There is no way to ask the renderer anything else,
which is what makes the privacy guarantee in [PLAN.md §0.3](../PLAN.md) structural rather than a
promise in a comment.

### Why the cursor crosses in stage-local logical pixels

`CursorState.x/y` are **not** screen coordinates. They are the cursor position inside the stage
window, in logical pixels, origin top-left.

Main is the only process that knows the window's screen origin and the display scale factor. If the
renderer got screen coordinates it would have to duplicate that arithmetic, and every new consumer
(hit test, eye direction, drag grab offset) would need the same two subtractions. Converting once at
the boundary means `renderer` can compare the cursor straight against the cat's pixel mask.

`speed` is therefore logical px/second, not screen px/second, and it is comparable to
`THRESHOLDS.WALK_SPEED` directly.

`inside` is deliberately generous — main reports `inside: false` only when the cursor is more than
64 logical px outside the window — because a cursor just off the edge still needs a plausible
position for the eyes to look at, and the hit test needs to notice the crossing as motion rather
than as a teleport from stale coordinates.

## Click-through (`src/renderer/pet/hit.ts`)

The stage window covers 320×240 of the user's desktop and is **always** click-through at rest. If it
ate clicks, the app would be unusable.

To make the cat itself grabbable, each frame the renderer runs the cursor against the cat's opaque
mask and, when it is over the cat, sends `{ type: 'inputMode', mode: 'interactive' }`. Main calls
`setIgnoreMouseEvents(false, { forward: true })`.

Three decisions make this feel solid rather than twitchy:

1. **The mask is the union across every frame**, not the current frame. A per-frame mask would make
   the cat lose its hit area wherever a frame happens to be transparent — the tail swishing would
   leave a hole in it.
2. **Entry and exit use different frame counts.** `HIT_ENTER_FRAMES = 2`, `HIT_EXIT_FRAMES = 4`. A
   cursor flicking across the cat in one frame never registers; a cursor resting on the cat's edge
   does not flicker.
3. **`{ forward: true }` in both directions.** Without forwarding while ignoring, `mousemove` never
   reaches the renderer and hover detection is impossible while click-through. Without forwarding
   while interactive, a release outside the window is lost.

`HitTester.contains()` is pure and `HitTester.test()` is the stateful one. A `mousedown` can arrive
on the same frame the cursor crossed onto the cat, _before_ that frame's `test()` has run — so the
click path asks the mask directly rather than reading last frame's mode. Asking `test()` twice per
frame would also run the hysteresis twice as fast, which is why `test()` takes the `held` flag for
the drag case rather than being called a second time.

## The frame loop (`src/renderer/pet/main.ts`)

```
requestAnimationFrame
  ↓
context.beginFrame(dt, snapshot)   injected clock; advances idleFor, blink, pupil
  ↓
mochi.update(dt)                   fixed 1/240 s sub-steps
  ↓
machine.update(context)            re-derives the winner every frame
idle dispatch                      routes a flourish to its own behavior
context.lookAt(...)                eased, clamped pupil target
  ↓
animator.set(...) / update(dt)     absolute time, not accumulated dt
  ↓
hit.test(...)                      hysteresis; may send inputMode
  ↓
renderer.draw(frame, anchors, context, scale)
  ↓
requestAnimationFrame
```

**Nothing in the simulation counts frames.** Every rate is per second, every spring is stepped by
`dt`, and the animation clock derives the current frame from _total elapsed time_ rather than
summing deltas. Summing `dt` accumulates float error, so after a second of 144 Hz updates the
animation can be a hair behind the same second of 60 Hz updates and the two disagree about which
frame is showing at a boundary.

`dt` is clamped twice: to 1/20 s in the loop (a backgrounded tab hands back seconds) and to 1/10 s in
the physics integrator. Without the clamp, one long tab-away produces a visible jump.

## The behavior machine (`src/renderer/pet/behavior.ts`)

Every user-visible reaction is a `Behavior`:

```ts
interface Behavior {
  id: string;
  priority: number;
  canStart(ctx): boolean; // pure predicate
  start(ctx): void;
  update(ctx): void; // ctx.dt is seconds
  done(ctx): boolean;
  stop(ctx, reason): void;
  minDuration?: number; // held this long before it will yield
}
```

Selection is **re-derived every frame**: pick the highest-priority behavior whose `canStart` passes.
Nothing latches. Releasing the mouse drops the cat straight back to walking or idling rather than
through a stale intermediate state, and there is no `switch` to forget to update when a behavior is
added.

A started behavior keeps its slot until it reports `done` **and** has been alive for at least
`minDuration`. That is what stops transitions from being single dropped frames.

Priorities (`PRIORITY`):

| Behavior  | Priority | Notes                                                              |
| --------- | -------- | ------------------------------------------------------------------ |
| `drag`    | 100      | A held cat is not participating in anything else.                  |
| `stretch` | 50       | M3.                                                                |
| `pet`     | 40       | M2.                                                                |
| `hunt`    | 30       | M2.                                                                |
| `unroll`  | 25       | M2.                                                                |
| `think`   | 20       | M5.                                                                |
| `knead`   | 10       | M2.                                                                |
| `walk`    | 5        | Wandering, not a reaction.                                         |
| `groom`   | 4        | Idle-life flourish with its own behavior so it can be interrupted. |
| `idle`    | 0        | Always legal, so the engine can never have "no behavior running".  |

### A trap when writing a fake

A test double for a behavior must mirror the shipped `done()` semantics: **a running behavior holds
its slot until it reports done**. A fake whose `done()` returns `true` immediately is not a
faster fake, it is a different machine, and the machine latches on it.

## Input derivations (`src/shared/sampler.ts`)

All of it is in main, in memory, and only derived signals leave:

| Signal         | Derivation                                                             | Why derived and not raw                                                                                   |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `cursor.speed` | Exponentially smoothed, α = 0.3                                        | One jittery sample must not trigger `hunt`.                                                               |
| `keyRate`      | Ring of 60 one-second buckets, normalised by seconds actually observed | The normalisation is what stops the first three seconds of a session reporting a 60× rate from one burst. |
| `wheelEnergy`  | `Math.exp(-UNROLL_DECAY * dt)` per frame                               | Framerate-independent: a 144 Hz display bleeds at the same rate as a 60 Hz one.                           |

`countKey()` takes **no parameters**. There is no value a caller could hand it, so there is no path
by which key content could reach the sampler even by accident. An enforcement test asserts the
signature, because a review convention can be forgotten in a refactor and a signature cannot.

Sub-second time is carried in `bucketCarry` rather than discarded — key and wheel events do not
arrive on frame boundaries, and dropping the remainder loses a meaningful share of a fast typist's
keystrokes.

## Degraded mode

`uiohook-napi` is a native addon. It can be missing (installed without build tools) or blocked
(macOS Accessibility). Either way **the app must still run**:

| Available                                                 | Lost                    |
| --------------------------------------------------------- | ----------------------- |
| Cursor position and speed (from `screen`, no hook needed) | —                       |
| Eye follow (02)                                           | —                       |
| Local dragging, mochi physics, click-through              | —                       |
| System-wide typing and scroll reactions                   | M2 features 04/06/07/10 |

`sampler.hookActive` travels in every snapshot so the renderer can show something honest rather
than a reaction that never fires.

One deliberate exception to "the hook only supplies reactions": the global `mouseup` also _ends_
drags. The renderer cannot see a release outside its window, and flicking the cat fast is exactly the
case that would otherwise leave the cat stuck to the cursor.

## Determinism

The renderer contains no `Date.now()`, no `performance.now()` and no `new Date`. All time arrives on
`ctx.time` / `ctx.dt`, which main injects. This is enforced by a test, because a stray clock read in
a behavior turns every failure into an unreproducible one.

The renderer exposes `window.__pet` (context, animator, machine, atlas, hit tester, plus
`setSnapshot()` and `frameCount()`) purely so Playwright can drive it. It is not used by the app.

`Math.random()` _is_ used, by the blink schedule and the idle director. That is deliberate: those are
the two places where variety is the point. Both read it in one place, so seeding becomes a
two-line change if a golden-image test ever needs it.

## Performance

Per frame, the hot path does: one `context.beginFrame`, one physics integration (fixed 1/240 s
sub-steps, accumulated), one behavior selection, one `Animator.update` (binary search over at most
4 frame marks), one hit-test mask lookup, and one `drawImage` plus the eye layer's handful of
`fillRect`s.

| What                                                        | Why                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pattern remap is `putImageData` on an offscreen atlas, once | Recolouring per pixel per frame would put 19 × 48 × 48 pixels through a LUT on every frame for a value that changes when the user picks a pattern. |
| `drawImage` from the atlas, not `putImageData` per frame    | One call per frame.                                                                                                                                |
| `imageSmoothingEnabled = false`                             | One blurred pixel in a pixel-art window is instantly visible.                                                                                      |
| All geometry integer-snapped                                | Sub-pixel positions make pixel art shimmer.                                                                                                        |
| Behaviors allocate nothing per frame                        | They write numbers into `PetContext`.                                                                                                              |

## Files worth knowing

| File                                | Why you would open it                                                      |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `src/shared/types.ts`               | The whole cross-process contract, plus stage geometry constants.           |
| `src/shared/thresholds.ts`          | Every tunable number. Adjust feel here, not in logic.                      |
| `src/renderer/pet/context.ts`       | Injected clock, blink schedule, eased/clamped pupil.                       |
| `src/renderer/pet/behavior.ts`      | The `Behavior` interface, `PRIORITY`, the machine.                         |
| `src/renderer/pet/hit.ts`           | Union mask, hysteresis, click-through policy.                              |
| `src/renderer/pet/physics/mochi.ts` | Springs, coupling, wobble oscillator.                                      |
| `src/renderer/pet/render/eyes.ts`   | The procedural eye layer.                                                  |
| `src/sprites/compile.ts`            | ASCII → indices → RGBA. DOM-free, unit-testable.                           |
| `scripts/gen-cat.mjs`               | How the committed art is produced. See [art-pipeline.md](art-pipeline.md). |
