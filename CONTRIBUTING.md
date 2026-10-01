# Contributing to LittlePET

Thanks for looking. This document covers the two things people actually want to do — add a
reaction, or draw something — and the handful of rules that keep the codebase honest.

## Setup

```bash
npm install
npm run verify      # lint · typecheck · 135 unit tests · asset audit
npm run dev
```

Node 20+. No asset pipeline and no image toolchain: the sprites are text files.

## The two invariants

Almost every surprising thing in this codebase exists to protect one of these.

**1. The renderer reads no wall clock.** All time arrives on `ctx.time` and `ctx.dt`, injected by
main. There is no `Date.now()`, `performance.now()` or `new Date` in `src/renderer/`, and both a
lint rule and a test enforce it. A stray clock read turns every failure into an unreproducible one.

**2. No key content, anywhere.** `InputSampler.countKey()` takes no parameters — there is no value
a caller could hand it. The only thing that crosses into the renderer is `keyRate`, a number
derived from counts. If you find yourself wanting to pass a key or its content somewhere, you want a
count instead.

`docs/architecture.md` explains the process split these depend on.

## Adding a behavior (a reaction)

A reaction is one file in `src/renderer/pet/behaviors/`. Implement `Behavior`:

```ts
export class HuntBehavior implements Behavior {
  readonly id = 'hunt';
  readonly priority = PRIORITY.hunt; // add to the table in behavior.ts first

  canStart(ctx: PetContext): boolean {
    /* pure predicate */ return false;
  }
  start(ctx: PetContext): void {
    /* reset state, do not act */
  }
  update(ctx: PetContext): void {
    /* ctx.dt is seconds */
  }
  done(ctx: PetContext): boolean {
    return false;
  }
  stop(ctx: PetContext, reason: StopReason): void {
    /* release everything */
  }
}
```

Register it in `src/renderer/pet/main.ts` and document it in
[`docs/behavior-specs.md`](docs/behavior-specs.md). The whole contract, and the rules that will bite
you, are at the top of that file.

Four things that go wrong every time:

- **Frame counts.** Never count frames. Everything is per second.
- **Not releasing on `stop`.** Clear `walkTarget`, `requested`, timers. A behavior that resumes
  later in a half-finished state reads as the cat remembering something, which always looks like a
  bug.
- **Allocating in `update`.** Write numbers into `ctx`. The hot path budget is tight.
- **A test fake that lies.** A fake behavior must mirror the real `done()` semantics: a running
  behavior holds its slot until it reports done. A fake whose `done()` returns `true` immediately
  is not a faster fake, it is a different machine, and the machine latches on it.

If your behavior needs new art, `atlas.has(name)` is the graceful way to check before using it.

## Drawing a frame

The sprites are generated ASCII committed to the repo. Start with
[`docs/art-pipeline.md`](docs/art-pipeline.md) — it covers the slots, the primitives, and the rules
that look wrong but are not (wide shading bands, outline last, whole-pixel landmarks, eye socket
sizing).

```bash
npm run cat                # regenerate src/sprites/cats/nunu.ts
npm run preview walk 4     # print it as text and read it
```

Commit both the generator change and the regenerated ASCII. CI fails if the tree is dirty after
`npm run cat`, so a generator change without a regeneration cannot merge.

### The eyes

**A socket that is entirely pupil has nowhere for the pupil to go.** Sockets are 5×5 with a 3×3
sclera and anchor `r = 2`; that holds a 3-cell pupil with a cell of travel in every direction. A
pose that draws smaller eyes will look subtly broken on that animation only, which is exactly the
kind of bug that survives review.

## Tests

```bash
npm test                            # unit
npm run test:watch                  # while working
```

Unit tests cover the DOM-free half of the app and need no display. The simulation takes an injected
clock, so timing assertions are deterministic — but two notes from experience:

- Give frame-boundary assertions one frame of slack (`expect(held).toBeLessThan(0.4 + dt)`). A
  value sampled exactly on a boundary is a coin flip.
- Prefer asserting a _position_ over a frame number when comparing framerates. At a boundary two
  different answers are both correct; positions are comparable.

Integration tests under `tests/integration/` run Electron via Playwright and need a display
(`xvfb-run npm test` on a headless Linux box). M1 has none yet.

## Claims

This project makes promises _about itself_ — no network, no key retention, no borrowed art, nothing
marked done that is not. Those are enforced in `tests/unit/enforcement.test.ts`.

If you change `docs/PARITY.md`, a `done` row must name a test file that exists. If you add an asset
under `src/sprites/`, add a row to `docs/ASSETS.md` with its origin and author. If you need the
network, the allowlist in the enforcement test and the lint rule both have to change — that is
intentional. Make it a commit that says so.

## Style

Prettier, 100 columns, single quotes, trailing commas. `npm run format`.

Comments explain **why**, not what. Most of this codebase's comments are short explanations of a
tuning constant or a decision that looks wrong. If you are about to write a comment that restates
the line below it, delete it instead.
