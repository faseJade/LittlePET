# LittlePET — build log

A complete record of what was built for LittlePET, why each decision was made, what is verified,
and what is not. Written as a handover document: someone reading this cold should be able to pick
the project up without reading the code first.

- **Repository:** https://github.com/faseJade/LittlePET
- **Release:** https://github.com/faseJade/LittlePET/releases/tag/v0.1.0
- **License:** MIT
- **Branch:** `main`, four commits, no local changes outstanding
- **Test suite:** 135 unit tests across 8 files, all passing, no display required

---

## 1. What this is

A pixel cat that lives on your desktop in a transparent always-on-top window. It follows your
cursor with its eyes, and you can pick it up and shake it like mochi. It is an independent
reimplementation of the feature set and feel of a commercially available desktop pet — no sprites,
logo, name or copy were taken from any other project.

The scope at hand was **milestone M1, the core engine**, defined in
[PLAN.md](../PLAN.md) as:

> a cat sits on the desktop, follows your eyes, and you can be pick it up and shake it like mochi.
> Runs with the native hook disabled.

**The honest caveat, stated once and repeated because it matters:** the engine is unit-tested and
the packaging is verified, but **the application has never been launched by anyone.** The
development environment has no display and no `xvfb`, so Electron cannot be started locally. Every
"it works" claim below means "the code that does this is tested", not "a person watched it happen".
This is the single most valuable thing for whoever picks this up to do next: run the `.exe`.

---

## 2. Where the project stands

| Milestone | Scope                                                                                                                                                        | Status                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| M0        | Scaffolding, Electron bootstrap, tray, settings store, CI                                                                                                    | complete                           |
| **M1**    | **Core engine: stage window, click-through, sprite pipeline, animator, priority machine, eye follow, mochi drag, idle life, multi-display, MessagePort bus** | **code and tests complete, unrun** |
| M2        | Input reactions: hunt, pet/purr, knead, overheat, unroll                                                                                                     | planned                            |
| M3        | Reminders: stretch, water, message, fixed note, name, bubbles                                                                                                | planned                            |
| M4        | Pomodoro                                                                                                                                                     | planned                            |
| M5        | Agent integration: think, agent-done                                                                                                                         | planned                            |
| M6        | Settings shell, tray menu, autostart, config import/export, peek                                                                                             | planned                            |
| M7        | Pattern editor, user patterns, more art                                                                                                                      | planned                            |
| M8        | Packaging polish, icons, downloads                                                                                                                           | substantially done                 |
| M9        | Sound, locales, polish                                                                                                                                       | planned                            |

Per-feature status is tracked in [PARITY.md](PARITY.md). Of 18 features: **2 done** (02 eye follow,
03 mochi drag), **1 partial** (01 custom pattern — the palette system works, the editor UI does not
exist), **1 n/a** (17 multi-device, replaced by config export/import because in the original app it
is a licensing feature rather than a capability), **14 planned**.

Nothing in `docs/PARITY.md` is claimed `done` without naming an acceptance test file that exists, and
a test enforces that. This is the mechanism that makes the table trustworthy.

### Codebase size

| Area           | Lines | Notes                                |
| -------------- | ----- | ------------------------------------ |
| `src/renderer` | 1,834 | simulation, drawing, behaviors       |
| `src/sprites`  | 1,398 | 1,163 of that is generated ASCII art |
| `src/main`     | 478   | input, windows, persistence          |
| `src/shared`   | 476   | contracts, thresholds, sampler       |
| `src/preload`  | 51    | the bridge, deliberately tiny        |
| `scripts`      | 1,477 | art tooling, build, asset audit      |
| `tests`        | 1,947 | 135 tests                            |
| documentation  | 2,011 | 12 markdown files                    |

Roughly 6,300 lines of source and scripts against 1,947 lines of test.

---

## 3. The three decisions that shaped everything

Most of the code exists to serve these. If you disagree with one of them, understanding _why_ it was
chosen matters more than the code that implements it.

### 3.1 Art is indexed ASCII, not PNG

A sprite frame is a grid of **palette slots**, not colours:

```
KKKKKKKKKKKK............
KBBBBBBBBBBK............
KBPPBBBBBBBK............
KBBBBBBBBBBK............
```

`K` is `outline`, `B` is `body`, `P` is `patch1`, `.` is transparent. A _pattern_ is then nothing
but a colour per slot — [palette.ts](../src/sprites/palette.ts) ships 8 presets (tuxedo, tabby,
ginger, tortoiseshell, siamese, calico, black, grey) as pure data.

What this buys:

- **"Make it look like my cat" becomes a data operation.** With PNGs, customisation would mean
  asking users to draw sprite sheets. With slots, it is a dozen hex values. This is the reason
  feature 01 is even a plausible feature.
- **Art changes review as text.** A pull request that changes the cat is a character-grid diff,
  readable in any terminal, in any GitHub viewer, with no tools.
- **The repository is self-contained.** `npm install && npm run build` works with no image
  pipeline and no image toolchain.
- **No binary of unknown provenance is ever committed.** Enforced by test.

The cat is generated by `scripts/gen-cat.mjs` — 19 frames at 48×48 across `idle`, `walk`, `dangle`,
`stretch`, `groom`, `cheer` — and the generated ASCII is **committed** as
[src/sprites/cats/nunu.ts](../src/sprites/cats/nunu.ts). Committing generated output is
unusual and worth defending: the generator exists so the 19 frames stay _consistent with each other_
(a hand-drawn 20th frame drifts immediately), but the committed ASCII is what the app loads, and CI
fails if the tree is dirty after `npm run cat`. A generator change cannot merge without its
regeneration.

### 3.2 Eyes are procedural, not sprites

The frames contain **no pupils**. Each frame declares where its eye sockets are
(`EyeAnchor {x, y, r}` in grid cells), and [eyes.ts](../src/renderer/pet/render/eyes.ts) draws the
sclera, pupil, catchlight, blink lids and expression glyphs at runtime.

Consequences:

- Blinking, eye follow, `happy`, `surprised`, `angry`, `thinking`, `sleepy` and the entire overheat
  colour shift **cost nothing** — they are runtime state, not separate hand-drawn frames.
- They work identically over every animation, including poses drawn months from now.
- The socket sizing rule that follows from this: **a socket that is entirely pupil has nowhere for
  the pupil to go.** Current sockets are 5×5 (`K` rim) with a 3×3 `W` sclera and anchor `r = 2`,
  which holds a 3-cell pupil with a cell of travel in every direction. `PUPIL_RADIUS = 0.55` is the
  ratio that leaves the rest as travel budget. A pose drawn with smaller eyes will look subtly
  broken on that animation only — precisely the kind of bug that survives review.

### 3.3 The privacy claim is structural, not aspirational

LittlePET knows how fast you type. It **cannot** know what you type.

`InputSampler.countKey()` takes **no parameters**. There is no value a caller could hand it, so
there is no path by which key content reaches the sampler even by accident — not a convention
someone has to remember, an API that cannot be misused. The only thing that crosses the process
boundary is `keyRate`, a number derived from counts.

Beyond that, deliberately absent and permanent: no license key, no payment, no device limit, no
account, no sign-in, no telemetry, no crash reporting, no auto-updater, and **no network access of
any kind**. There is no code that could send any of them.

Five enforcement tests keep these claims true rather than aspirational, each reading the source as
text because the properties being checked are about the _code_, not its runtime behaviour:

1. **No network in `src/`** — fails on `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
   `sendBeacon`, `node:http(s)`, `electron.net`, or an HTTP client library. Comments and string
   literals are stripped first, so the test's own documentation does not fail it. The allowlist is
   **empty on purpose**: needing the network should be a decision someone makes out loud in a
   commit, not a line someone deletes from a config.
2. **No key content retained** — asserts the `countKey()` signature, that no `PetSnapshot` field
   could hold a key, that nothing persists input, and that no source line logs one.
3. **Asset provenance** — every file under `src/sprites/` is in `docs/ASSETS.md` with an origin of
   `authored`, `generated`, or an accepted licence, and every accepted third-party licence must have
   its text in `LICENSE-NOTICE.md`. No binary image, audio or font under `src/`.
4. **Parity table** — all 18 features present, no unchecked boxes, and every `done` row names a
   test file that exists.
5. **No wall clock in the renderer** — no `Date.now()`, `performance.now()` or `new Date` under
   `src/renderer/`.

Each claim that _can_ be a lint rule is also one in [eslint.config.mjs](../eslint.config.mjs),
deliberately duplicated so a violation fails in seconds rather than at the end of a test run. A
guard rail that exists in only one place is a guard rail that can be edited away.

---

## 4. Architecture

Two processes, one channel, no shared globals. Full detail in
[architecture.md](architecture.md); the summary:

```
main        uiohook + screen → InputSampler → PetSnapshot ──60 Hz, MessagePort──▶
renderer    Context → BehaviorMachine → Mochi → Animator → Renderer ──commands──▶ main
```

### Why main owns input, time and persistence

Three things the renderer cannot do:

| Concern     | Why not the renderer                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input       | `uiohook-napi` is a Node native addon loaded from `node_modules`. Also the stage window is `focusable: false` — it never receives keyboard focus, so it cannot reliably see key events at all. |
| Time        | The window is `backgroundThrottling: false`, but timers in hidden or occluded windows are unreliable on some platforms, and reminders (M3) must fire whether or not anyone is looking.         |
| Persistence | The renderer is `sandbox: true` with no filesystem access. There is no path from pet code to disk.                                                                                             |

Everything else lives in the renderer, which is what makes 135 tests run in ~2 seconds with no
Electron and no display.

### The bridge

`window.littlepet` has exactly four methods: `connect()`, `init()`, `__deliver(snapshot)`,
`send(command)`. No `ipcRenderer`, no `require`, no filesystem. The 60 Hz channel is a transferred
`MessagePort`, not `invoke` round trips — one long-lived channel beats 60 promise round trips a
second to deliver one small object.

`PetSnapshot` is the entire vocabulary of input: cursor position, speed, `inside`, `keyRate`,
`wheelEnergy`, `inputMode`, `drag`, `hookActive`.

### One decision worth explaining: cursor coordinates cross in stage-local logical pixels

`CursorState.x/y` are **not** screen coordinates. They are the cursor's position inside the stage
window, in logical pixels, origin top-left. Main is the only process that knows the window origin
and the display scale factor; converting at the boundary means the renderer can compare the cursor
directly against the cat's pixel mask with no arithmetic of its own. If the renderer got screen
coordinates, every consumer — hit test, eye direction, drag grab offset — would need the same two
subtractions, and a fourth would be needed the moment someone added one.

`speed` is therefore logical px/second and is directly comparable to `WALK_SPEED`. `inside` is
generous (false only beyond 64 logical px outside the window) because a cursor just off the edge
still needs a plausible position for the eyes to look at, and the hit test needs to register the
crossing as motion rather than as a teleport from stale coordinates.

### Click-through

The window covers 320×240 of the desktop and is **always** click-through at rest — otherwise it
eats clicks meant for whatever is underneath. To make the cat grabbable, each frame the renderer
tests the cursor against the cat's opaque pixels and asks main to flip `setIgnoreMouseEvents`.

Three details make this feel solid rather than twitchy:

1. **The mask is the union across every frame**, not the current frame. A per-frame mask would make
   the cat lose its hit area wherever a frame is transparent — the tail swishing would leave a
   hole in it.
2. **Asymmetric hysteresis.** `HIT_ENTER_FRAMES = 2`, `HIT_EXIT_FRAMES = 4`. A cursor flicking
   across the cat in one frame never registers; one resting on the edge does not flicker.
3. **`{ forward: true }` both ways.** Without forwarding while ignoring, `mousemove` never arrives
   and hover detection is impossible while click-through. Without it while interactive, a release
   outside the window is lost.

`HitTester.contains()` is pure; `test()` is the stateful one. The click path asks `contains()`
directly, because a `mousedown` can arrive on the same frame the cursor crossed onto the cat,
_before_ that frame's `test()` has run — asking `test()` twice would also run the hysteresis twice
as fast.

### The behavior machine

Every user-visible reaction implements one `Behavior` interface: `canStart` (pure predicate),
`start`, `update` (seconds, never frames), `done`, `stop`, optional `minDuration`.

Selection is **re-derived every frame** — highest priority whose `canStart` passes. Nothing latches.
Releasing the mouse drops the cat straight back to walking or idling rather than through a stale
intermediate state, and there is no `switch` to forget when a behavior is added. `minDuration` stops
transitions from being a single dropped frame.

| Behavior  | Priority | Status      |
| --------- | -------- | ----------- |
| `drag`    | 100      | implemented |
| `stretch` | 50       | M3          |
| `pet`     | 40       | M2          |
| `hunt`    | 30       | M2          |
| `unroll`  | 25       | M2          |
| `think`   | 20       | M5          |
| `knead`   | 10       | M2          |
| `walk`    | 5        | implemented |
| `groom`   | 4        | implemented |
| `idle`    | 0        | implemented |

### Determinism

The renderer contains no wall-clock reads. All time arrives on `ctx.time` / `ctx.dt`, injected by
main. This is enforced by lint _and_ test, because a stray clock read turns every failure into an
unreproducible one — which is the specific cost the injection seam exists to avoid.

`Math.random()` **is** used, by the blink schedule and the idle director. That is deliberate: those
are the two places where variety is the point, and each reads it in exactly one place, so seeding
becomes a two-line change if a golden-image test ever needs it.

### Graceful degradation

`uiohook-napi` can be missing (no build tools) or blocked (macOS Accessibility). The app runs either
way. Cursor tracking, eye follow, dragging and click-through all come from Electron's own `screen`
module and need no hook. Lost without it: the _system-wide_ reactions (typing, scroll) — M2
features. `hookActive` travels in every snapshot so the renderer can be honest rather than showing a
reaction that never fires.

One deliberate exception to "the hook only supplies reactions": the global `mouseup` also _ends_
drags. The renderer cannot see a release outside its window, and flicking the cat fast is exactly
the case that would otherwise leave it stuck to the cursor.

---

## 5. What was built, file by file

### `src/shared/` — the cross-process contract

| File            | What it does                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`      | `PetSnapshot`, `PetCommand`, `Settings`, palette slot definitions, `EyeAnchor`, stage geometry constants. The whole vocabulary of what crosses the process boundary.      |
| `api.ts`        | The `window.littlepet` contract, shared by preload and renderer so `tsc` catches any mismatch.                                                                            |
| `thresholds.ts` | Every tunable number in the project — 37 constants plus the `MochiConstants` interface. Adjust feel here, never in logic.                                                 |
| `sampler.ts`    | Input derivations: smoothed cursor speed, key rate over a 60-bucket ring, framerate-independent energy decay. DOM-free and clock-free so thresholds are tunable in tests. |

### `src/sprites/` — art as data

| File           | What it does                                                                                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compile.ts`   | ASCII → indexed bytes → RGBA. Deliberately DOM-free so it is unit-testable in Node and reusable by the art tooling. Throws on unknown characters — a typo in the art should fail loudly, not render as a hole someone finds three milestones later. |
| `palette.ts`   | 8 pattern presets as data, plus `FIXED_SLOTS` so a user pattern cannot accidentally recolour the catchlight into something invisible.                                                                                                               |
| `cats/nunu.ts` | Generated, committed. 19 frames of ASCII.                                                                                                                                                                                                           |

### `src/main/` — input, time, persistence

| File          | What it does                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`    | Window lifecycle, 60 Hz sampling loop, IPC, tray, hook loading, drag window-following, position restore.                                       |
| `stage.ts`    | Stage window geometry, click-through policy, work-area clamping.                                                                               |
| `settings.ts` | Atomic JSON persistence. A corrupt or hand-edited file starts from defaults rather than refusing to launch; export/import for config hand-off. |

### `src/renderer/pet/` — simulation and drawing

| File               | What it does                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `main.ts`          | The frame loop, pointer handling, and the bridge wiring.                                                              |
| `context.ts`       | Injected clock, idle tracking, blink schedule, eased and clamped pupil. The only place the clock enters the renderer. |
| `behavior.ts`      | `Behavior` interface, `PRIORITY` table, the priority-stack machine.                                                   |
| `animator.ts`      | Delta-time playback. Absolute elapsed time, **not** accumulated deltas.                                               |
| `hit.ts`           | Union mask, hysteresis, `contains()`, `locate()`.                                                                     |
| `physics/mochi.ts` | Two volume-coupled springs plus a damped torsional wobble, fixed 1/240 s sub-step.                                    |
| `render/atlas.ts`  | Indexed sprite + palette → one offscreen canvas.                                                                      |
| `render/draw.ts`   | The five-layer draw stack.                                                                                            |
| `render/eyes.ts`   | The procedural eye layer.                                                                                             |
| `behaviors/`       | `drag.ts`, `walk.ts`, `groom.ts`, `idle.ts`.                                                                          |

### `scripts/` — art tooling, build, audit

| File               | What it does                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `build.mjs`        | esbuild: main → `dist/main`, preload → `dist/preload`, two renderer bundles. Native deps external.               |
| `gen-cat.mjs`      | Parametric cat generator → committed ASCII + a contact sheet.                                                    |
| `preview.mjs`      | Prints any animation to the terminal as an ASCII shading ramp.                                                   |
| `gen-icons.mjs`    | Draws the app icon from the same primitives as the cat → `.png`/`.icns`/`.ico`. `--preview` for terminal review. |
| `check-assets.mjs` | The asset provenance audit, standalone so it runs in `verify` without a test runner.                             |
| `lib/pixel.mjs`    | Drawing primitives over a `char[][]` grid: ellipse, triangle, curve, outline, shade.                             |
| `lib/png.mjs`      | Minimal dependency-free PNG encoder.                                                                             |

### `tests/unit/` — 135 tests

| File                       | Tests | Covers                                                                                                                                    |
| -------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `compile.test.ts`          | 32    | Bad art fails loudly, palette remap, shipped art compiles, slot mapping                                                                   |
| `context.test.ts`          | 24    | **Feature 02**: pupils ease toward the cursor, clamp inside the socket, work over every animation; blink schedule; framerate independence |
| `enforcement.test.ts`      | 17    | The five guard rails above                                                                                                                |
| `behavior-machine.test.ts` | 16    | Preemption, `minDuration`, framerate independence, no latching                                                                            |
| `hit.test.ts`              | 16    | Union mask, 2-in/4-out hysteresis, drag hold, `locate()`                                                                                  |
| `sampler.test.ts`          | 11    | Key rate, wheel decay, no key content retained                                                                                            |
| `mochi.test.ts`            | 10    | **Feature 03**: volume coupling, damped wobble, framerate independence, clamp velocity handling                                           |
| `animator.test.ts`         | 9     | No drift, per-frame durations, absolute-time playback                                                                                     |

---

## 6. Non-obvious engineering decisions

These are the things that look wrong until you understand them. Most carry a comment explaining the
same thing at the point of decision.

**The animator tracks absolute elapsed time, not accumulated `dt`.** Summing `dt` is the obvious
implementation and it is subtly wrong: float error accumulates, so after a second of 144 Hz updates
the animation can be a hair behind the same second of 60 Hz updates, and the two disagree about
which frame is showing at a boundary.

**Mochi drag velocity is injected as spring _velocity_, scaled by `dt`.** Adding directly to the
scale teleports the cat past its clamps and bypasses the springs entirely. Scaling by `dt` makes it
a force proportional to drag speed, so the same physical drag stretches the cat equally on a 30 Hz
and a 120 Hz display.

**When a mochi axis hits a clamp, its velocity is set to the inward component.** Clamping position
while leaving velocity alone lets the spring keep pushing outward every sub-step, velocity grows
without bound, and the cat stays pinned at the limit even after the drag stops.

**The mochi wobble is a real damped oscillator with a restoring term.** Without the restoring term
the angle decays monotonically and the cat tilts instead of jiggling.

**The pupil _target_ is clamped, not the eased value.** A target that moved further away is simply
further away; clamping the eased value fights the easing and makes the pupils stutter at the edge
of their travel.

**`suppressBlink()` only ever pushes a blink later** (`Math.max(nextBlinkAt, time + BLINK_MIN_GAP)`).
A behavior calling it on the frame the blink was already due must not accidentally bring it forward.

**Pattern remap is `putImageData` on an offscreen atlas, once.** Recolouring per pixel per frame
would push 19 × 48 × 48 pixels through a LUT every frame for a value that changes when the user picks
a pattern. The hot path stays one `drawImage`.

**The generator's shading pass skips eye sockets** (`lastEyeCells` in `gen-cat.mjs`). `shade2()`
considers `W` body — right for a bib, wrong for an eyeball — and without the exclusion the shading
paints over the sockets and the cat ends up with lit, flat eyes.

**Outline runs after shading, never before.** Shading after outlining would darken the outline
itself and the cat would lose its silhouette.

**Shading bands are wider than instinct suggests** (`LIT_R = 0.27`, `SHADOW_R = 0.44`). With tighter
bands the falloff eats whole features — the bib marking vanished entirely at 0.185/0.225.

**`package.json` has no `"type"` field.** It is deliberate, which is why the scripts are `.mjs` and
the Vitest config is `vitest.config.mts` rather than `.ts`.

**`window.__pet` is exposed for Playwright.** Context, animator, machine, atlas, hit tester, plus
`setSnapshot()` and `frameCount()`. Not used by the app.

---

## 7. Bugs found and fixed during the build

Recorded because each was invisible until something forced it into the open.

| Bug                                                                                                                                                        | How it surfaced                                                              | Fix                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Eye sockets were entirely pupil, so the pupil had nowhere to travel                                                                                        | Eye follow was subtly flat; the cat could only stare straight ahead          | Sockets enlarged to 5×5 rim + 3×3 sclera, anchor `r = 2`                |
| Shading pass flattened eyeballs to lit `W`                                                                                                                 | ASCII review of a generated frame                                            | `lastEyeCells` excludes socket footprints from shading                  |
| Calling `HitTester.test()` twice per frame ran hysteresis 2× as fast                                                                                       | A click arriving on the frame the cursor entered counted as two hover frames | Split into pure `contains()` for the click path and stateful `test()`   |
| `HitTester.modeAt()` was dead code                                                                                                                         | Reading the file for this document                                           | Deleted                                                                 |
| `@electron/rebuild` compiled `uiohook-napi` from source and failed on missing X11 headers                                                                  | First `electron-builder` run, packaging for Windows on Linux                 | `npmRebuild: false` — prebuilds ship for every target platform          |
| `linux.icon` pointed at a _directory_; electron-builder silently fell back to the default Electron icon                                                    | Building the AppImage, comparing the icon                                    | Point at a specific file, `icon-512.png`                                |
| No `desktopName`, so the running window had no `WM_CLASS` association and desktops could not link it to its `.desktop` entry                               | Build warning; the cat appeared as a nameless process                        | Added `desktopName` to `package.json`                                   |
| electron-builder inferred a `github` publisher from `package.json`'s `repository` field and tried to create the Release itself, failing on a missing token | First Release workflow run                                                   | `--publish never`; the `publish` job owns Release creation deliberately |
| `artifactName` default includes the author name                                                                                                            | Would have leaked into a public download URL                                 | Pinned explicitly                                                       |
| Two truncated stub `.exe` files were produced locally (26 MB and 144 KB) and deleted                                                                       | Comparing against the real installer                                         | Deleted; the real one came from a Windows runner                        |

---

## 8. Packaging and release

### What is published

**https://github.com/faseJade/LittlePET/releases/tag/v0.1.0**

| File                                    | Size   | Notes          |
| --------------------------------------- | ------ | -------------- |
| `LittlePET-0.1.0-win-x64.exe`           | 106 MB | NSIS installer |
| `LittlePET-0.1.0-win-x64.zip`           | 146 MB | Portable       |
| `LittlePET-0.1.0-mac-arm64.dmg`         | 122 MB |                |
| `LittlePET-0.1.0-mac-arm64.zip`         | 122 MB |                |
| `LittlePET-0.1.0-linux-x86_64.AppImage` | 119 MB |                |

Plus `.blockmap` files and `latest*.yml` update manifests. Verified as
`Nullsoft Installer self-extracting archive`, sha256
`5111d1c6d07ee76b8f835d05446146cb71780ab1f403b05f09cf61852f581843`.

### Why a release workflow exists

NSIS and DMG need their **native** toolchains — electron-builder requires `wine` to stamp an icon
into a Windows executable, and there is no sensible way to install that on a build machine. So each
installer is built on the platform it targets, using GitHub's `windows-latest`, `macos-latest` and
`ubuntu-latest` runners.

[`.github/workflows/release.yml`](../.github/workflows/release.yml) has three matrix build jobs that
only package (`--publish never`), and one `publish` job that owns the Release object. Single
ownership is deliberate: four parallel builds racing to create the same Release is a real failure
mode. Icons are generated per build, never committed, so packaging cannot depend on a checked-in
binary.

Trigger it with a tag (`git push origin v0.1.1`) or manually via `workflow_dispatch`.

### Installers are unsigned

Nothing here is signed with a code signing certificate — that costs money per year, which does not
fit a free MIT project. Windows SmartScreen and macOS Gatekeeper will warn on first run. The release
notes say so explicitly, because an unexplained security warning reads as a compromised download.

---

## 9. Verification status — read this before trusting anything above

| Claim                                               | How it was verified                            | Confidence  |
| --------------------------------------------------- | ---------------------------------------------- | ----------- |
| 135 unit tests pass                                 | `npm test`, run repeatedly                     | High        |
| Lint and typecheck clean                            | `npm run verify`                               | High        |
| Asset provenance clean                              | `npm run assets:audit`                         | High        |
| Build produces correct bundles                      | `npm run build`, inspected output              | High        |
| Windows zip and Linux AppImage package cleanly      | Built locally, contents inspected              | High        |
| Windows installer builds                            | Built on a Windows runner in CI                | High        |
| macOS dmg builds                                    | Built on a macOS runner in CI                  | High        |
| CI green on push                                    | Both CI runs succeeded                         | High        |
| **The app launches and draws a cat**                | **Nothing. No display in the dev environment** | **Unknown** |
| **The cat is clickable where it looks clickable**   | **Nothing**                                    | **Unknown** |
| **Eye follow, mochi drag and idle life feel right** | **Nothing**                                    | **Unknown** |
| **Click-through does not eat clicks**               | **Nothing**                                    | **Unknown** |

Every "high" row is a statement about code and tooling. Every "unknown" row is a statement about
the experience. The gap between them is the entire remaining risk in this project, and it is closed
by running the binary — not by more tests.

---

## 10. Known gaps

Deliberate and permanent (see §3.3): no license key, no payment, no account, no telemetry, no
crash reporting, no auto-updater, no network.

Outstanding and real:

1. **Nobody has run the app.** See §9.
2. **`SECURITY.md` has no contact address.** It says "contact a maintainer through their GitHub
   profile" and records the gap as an M8 item. Needs a real address.
3. **CI emits deprecation warnings** — `actions/checkout@v4` and `actions/setup-node@v4` target
   Node 20 and are being forced onto Node 24. Harmless now, will break eventually. Bumping the
   action versions is a one-line change.
4. **No integration tests.** The Playwright `_electron` slot exists in CI and is empty. M1's exit
   criteria are covered only by unit tests.
5. **No golden-image tests.** Called for in PLAN.md §9.1 as "the single highest-value test in an
   art-heavy app". Unwritten. This is the most significant testing omission given that art changes
   are currently reviewed by eye.
6. **The settings window is a stub** that prints its own name. It exists so the two-renderer split
   and the packaging could be exercised from M1.
7. **macOS x64 dmg is not built** — the matrix only covers arm64 for macOS.
8. **`uiohook-napi` prebuilds are used as published.** There is no local rebuild step in CI and no
   supply-chain verification of that dependency's binaries.

---

## 11. Where to start next

In priority order:

1. **Run `~/Downloads/LittlePET-0.1.0-win-x64.exe` on Windows.** Does the cat appear? Is it
   clickable? Do the eyes follow? Does shaking feel like mochi? Every subsequent decision is
   cheaper once this is answered.
2. **Write the golden-image tests.** Every rendered frame compared to a committed PNG. This is the
   single change that most improves confidence per hour, because art is the part of this project
   with no automated verification.
3. **Write the Playwright integration tests.** Window geometry, click-through toggling, tray. The
   CI slot is already there.
4. **M2: input reactions.** Specs are already written in [behavior-specs.md](behavior-specs.md) —
   `hunt`, `pet`/purr, `knead`, `overheat`, `unroll`. The design is done; only the code is missing.
5. **Add a security contact address**, and bump the GitHub Actions versions.

For adding a behavior or drawing a frame, [CONTRIBUTING.md](../CONTRIBUTING.md) has the
concrete steps and the four mistakes that happen every time.

---

## 12. Verifying this document

```bash
git clone https://github.com/faseJade/LittlePET.git
cd LittlePET
npm install
npm run verify          # lint · typecheck · 135 tests · asset audit
npm run build           # esbuild bundles → dist/
npm run dev             # needs a display
```

| Command                  | Purpose                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `npm test`               | 135 unit tests, no display needed                                                |
| `npm run verify`         | What CI runs                                                                     |
| `npm run cat`            | Regenerate committed sprite source                                               |
| `npm run preview <anim>` | Print any animation as text — the only way to review art without an image viewer |
| `npm run icons`          | Generate app icons into `build/icon/` (gitignored)                               |
| `npm run icons:preview`  | Print the icon as text                                                           |
| `npm run assets:audit`   | Asset provenance                                                                 |
| `npm run dist`           | Package (needs the target platform's toolchain, or use the release workflow)     |
