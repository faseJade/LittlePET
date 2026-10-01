# LittlePET — Master Plan

> A pixel desktop cat that lives on your screen, reacts to what you do, and reminds you to
> take care of yourself. Free, open source (MIT), no telemetry, no accounts.

LittlePET is an independent, clean-room reimplementation of the _feature set_ of
[Comnyang](https://comnyang.com/en) (the pixel desktop cat by comnyang). This document is the
authoritative plan. **Every implementation decision must trace back to a section here.** If we
hit something not covered, we update this file first, then write the code.

---

## 0. Ground rules

### 0.1 What we match, what we don't

| Area                                 | Decision                                                           |
| ------------------------------------ | ------------------------------------------------------------------ |
| Feature set (all 18)                 | **Match.** Same behaviors, same trigger conditions, same spirit.   |
| Feel & motion curves                 | **Match closely.** Same physics feel, similar timings.             |
| Tech stack & packaging               | **Match.** Electron + TypeScript, `.dmg` (arm64 + x64) and `.exe`. |
| Pixel art, logo, name, copy          | **Do NOT copy.** All art and branding is original work.            |
| Licensing, auth, payments, telemetry | **Deliberately omitted.** See §0.2.                                |

Why: the sprites and branding are the copyrightable expression. Copying them would get the
repository DMCA'd and destroy the project's usefulness as an open-source project. Everything that
makes it _feel_ like the original — the timing, the physics, the reactions, the architecture — is
not protected, and that is where we put the effort.

**One hard rule for contributors:** no asset may be copied from the original product, traced from
screenshots, or derived from it. Art is authored from scratch in this repo (see §6). CI enforces
this (§9.4).

### 0.2 Deliberate divergences

These are removals, not omissions to fix later. They are permanent.

- **No license key, no Lemon Squeezy, no Google sign-in, no device limits.** MIT covers it.
- **No telemetry, no analytics, no crash upload.** Enforced by a test (§9.4).
- **No auto-updater.** GitHub Releases only. Keeps the zero-network promise honest and removes a
  supply-chain surface.
- **No paid gating.** Every feature ships free, including ones the original lists as upcoming.

### 0.3 Privacy stance

The app watches how you use your computer. That is only acceptable under strict rules:

- Keystroke **content is never read, stored, logged, or transmitted.** The hook counts events and
  discards them. Only a derived rate (keys/min) is kept, in memory, never persisted.
- Mouse position is used for reaction only; no path history is retained.
- **The app makes no network requests at all** (except the optional Linux-portal integration, and
  that is metadata-free). `net.request`/`fetch` are banned in `src/` by test.

---

## 1. Feature parity matrix

Every row is a spec we must satisfy. "Done" = in the parity table in `docs/PARITY.md` with a
passing acceptance test.

| #   | Feature           | Trigger                           | Required behavior                                                                                | Milestone       |
| --- | ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ | --------------- |
| 01  | Custom pattern    | user setting                      | Fur + marking colors mapped from the user's cat onto sprite palette slots                        | M7 (base in M1) |
| 02  | Eye follow        | global mouse move                 | Pupils track cursor within eye bounds, clamped + eased, works over every animation               | M1              |
| 03  | Mochi drag        | drag the cat                      | Lifts, body stretches under gravity (mochi), shakes → side-to-side wobble, drops → squash-settle | M1              |
| 04  | Mouse hunt        | fast mouse (> threshold px/frame) | Cat breaks into a chase toward the cursor, catches it, celebrates                                | M2              |
| 05  | Purring pets      | mouse rests on head region        | Sustained stroke on head → purr anim, hearts/blush, purr loop, sound optional                    | M2              |
| 06  | Keyboard kneading | keydown rate > 0                  | Tiny paw knead cycle synced to keystroke rate                                                    | M2              |
| 07  | Overheat mode     | fast typing sustained             | Body turns red (palette swap), steam puffs from head, cools down after idle                      | M2              |
| 08  | Stretch reminder  | interval timer                    | Cat grows big and stretches on a loop; fires even if the window is hidden                        | M3              |
| 09  | Water reminder    | interval timer                    | Cat pops up with a cup, reminder bubble                                                          | M3              |
| 10  | Paper unroll      | scroll wheel                      | Cat unspools a roll of paper with its paws while you scroll                                      | M2              |
| 11  | Thinking along    | AI agent thinking                 | Thinking face while a supported agent is busy                                                    | M5              |
| 12  | Agent done jump   | AI agent finishes                 | Happy hop + meow                                                                                 | M5              |
| 13  | Pomodoro timer    | user sets cycles                  | Focus/break loop + pixel timer floating beside the cat                                           | M4              |
| 14  | Message reminder  | time + text                       | Meows the message at the time; respects the pet's name                                           | M3              |
| 15  | Fixed message     | user setting                      | Note pinned above the cat's head, always visible                                                 | M3              |
| 16  | Tell your name    | user setting                      | Pet uses the user's name in speech bubbles + optional TTS                                        | M3              |
| 17  | Multi-device      | —                                 | **N/A — see §0.2.** Replaced by: config export/import so settings sync by hand                   | M6              |
| 18  | Peek mode         | fullscreen video detected         | Cat retreats to the screen edge, mostly hidden; reminders still pop                              | M6              |

---

## 2. Stack

| Layer        | Choice                                                                                  | Why                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell        | **Electron 3x**                                                                         | Transparent always-on-top windows, tray, multi-display, and mature packaging are all free here. Same class of tool the original uses, so feature parity is achievable. |
| Language     | **TypeScript 5**, strict                                                                | 18 behaviors + a state machine wants types.                                                                                                                            |
| Renderer     | Canvas 2D, `imageSmoothingEnabled = false`                                              | Integer-scaled pixel art. WebGL is overkill and risks blurry/non-deterministic output.                                                                                 |
| Global input | **uiohook-napi** (optional native dep)                                                  | Mouse move/buttons, keyboard, and **wheel** from one hook. This is what unlocks 02/04/05/06/07/10.                                                                     |
| Fallback     | **no native deps**                                                                      | If the hook fails to load, the app runs with local-only input. Degrades features, never crashes.                                                                       |
| State        | Plain modules + typed event bus                                                         | No Redux. Behaviors are stateful objects; a store would fight them.                                                                                                    |
| Persist      | JSON in `userData`, atomic writes                                                       | Human-readable, diffable, no DB.                                                                                                                                       |
| Build        | **electron-builder**                                                                    | `.dmg` arm64+x64, `.exe` NSIS, `AppImage`                                                                                                                              |
| Tests        | **Vitest** (logic) + **Playwright `_electron`** (integration) + **golden images** (art) |                                                                                                                                                                        |
| Lint         | ESLint + Prettier                                                                       |                                                                                                                                                                        |

### 2.1 Why Electron and not Tauri

Global keyboard and scroll hooks on Tauri need a hand-written Rust plugin plus per-platform native
toolchains. The original's whole appeal rests on those hooks (6 of 18 features). Paying ~150 MB of
binary size to get them reliably, in a project that must be maintainable by one person, is the
right trade.

---

## 3. Process architecture

Three processes, one job each. The split exists so that **reminders still fire when the pet is
hidden**, and so the renderer stays a pure view.

```
┌─ MAIN ────────────────────────────────────────────────────────┐
│  uiohook (mouse/key/wheel)  ·  cursor cache 60 Hz             │
│  Scheduler (stretch/water/pomodoro/message)  ·  power events  │
│  Settings store  ·  Tray  ·  Window placement / click-through │
│  Agent watcher (process scan + status file)  ·  HitTest       │
└───────────────┬──────────────────────────────┬────────────────┘
   MessagePort  │ (60 Hz compact snapshot)     │ MessagePort
┌───────────────┴──────────┐        ┌──────────┴────────────────┐
│ RENDERER: pet window     │        │ RENDERER: settings window │
│  Animator + Behavior     │        │  (normal window, M6)     │
│  state machine + physics │        └───────────────────────────┘
│  Draw stack (§6.3)       │
└──────────────────────────┘
```

- **Main owns input and time.** Input is sampled here because the hook is a Node addon and the
  cursor point comes from `screen.getCursorScreenPoint()`. Time lives here because
  `setTimeout` in a hidden/throttled renderer is unreliable.
- **Renderer owns simulation and drawing.** Behaviors, physics, and animation are pure-ish and
  benefit from the rAF loop.
- **The IPC bus is a `MessagePortMain` pair**, not `ipcRenderer.invoke`. One 60 Hz channel with a
  small object beats 60 invocations/sec.

### 3.1 Window design

One **stage window**, sized `320×240` logical, containing the cat plus room for bubbles, the
timer, and the pinned note. One window avoids multi-window z-fighting and lets bubbles be drawn in
the same pass as the cat.

| Property           | Value                        | Reason                                |
| ------------------ | ---------------------------- | ------------------------------------- |
| `transparent`      | `true`                       | See the cat only                      |
| `frame`            | `false`                      |                                       |
| `resizable`        | `false`                      |                                       |
| `alwaysOnTop`      | `true`, level `screen-saver` | Floats over fullscreen apps           |
| `skipTaskbar`      | `true`                       |                                       |
| `focusable`        | `false`                      | Never steal focus while typing        |
| `hasShadow`        | `false`                      | Windows shadow box ruins transparency |
| `acceptFirstMouse` | `true`                       | macOS first-click-to-focus trap       |
| `backgroundColor`  | `#00000000`                  |                                       |

### 3.2 Click-through (the trickiest part)

A transparent window must not eat clicks meant for the app underneath. `setIgnoreMouseEvents(true,
{forward: true})` passes clicks through _and_ still delivers `mousemove`, so we can implement our own
hit test:

1. Main polls `screen.getCursorScreenPoint()` each frame and keeps it in the snapshot.
2. Renderer tests the cursor against the cat's **opaque pixel mask** (§6.2) in physical pixels.
3. Interactive state has **hysteresis** — 2 consecutive frames inside → interactive, 4 outside →
   pass-through, 2 px pad. Fast mouse movement must not make it flicker.
4. Renderer sends `setInputMode(interactive | passthrough)` to main, which flips
   `setIgnoreMouseEvents` with `forward: true` in both directions.

`forward: true` is mandatory in both directions or the cat cannot detect hover while passing clicks
through, nor pass clicks through while interactive.

### 3.3 Positioning, DPI, multi-display

- Position is stored in **physical pixels** relative to the display origin.
- The stage is snapped to integer physical pixels so the pixel grid never lands on a half-pixel and
  the art never blurs. Scale factor is applied once, at draw time.
- Cat size is fixed in logical pixels (144 px wide, from the 48-cell grid at `CAT_SCALE` 3) so it
  looks the same on every display.
- On cursor entry to a different display, the cat **teleports** with a squash-and-stretch beat
  rather than sliding across a gap it cannot cross.

### 3.4 Known platform risks

| Risk                                          | Mitigation                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| macOS Accessibility permission not granted    | Detect via `systemPreferences.isTrustedAccessibilityClient`; show a guided prompt screen; run degraded |
| Wayland blocks global input                   | Document as unsupported on Wayland; suggest XWayland or X11. X11 works.                                |
| Linux `focusable: false` windows behave oddly | Platform-specific placement fallback; test on X11                                                      |
| `rAF` pauses when the window is hidden        | Main-driven reminders still fire; cat resumes on show                                                  |
| `uiohook` fails to load                       | Feature flag → local-input mode, never a crash                                                         |

---

## 4. Behavior engine

### 4.1 Interface

Every one of the 18 features is a `Behavior` — a self-contained, testable object.

```ts
interface Behavior<C = PetContext> {
  readonly id: string;
  readonly priority: number; // higher wins
  canStart(ctx: C): boolean; // pure predicate over context
  start(ctx: C): void | Promise<void>;
  update(dt: number, ctx: C): void; // dt in seconds, frame-rate independent
  stop(reason: StopReason): void;
  readonly interruptible: boolean; // can a higher-priority behavior cut in?
}
```

`update` receives **delta time, never a frame count.** The whole animation and physics layer is
framerate-independent so the cat behaves identically at 60, 120, or 144 Hz.

### 4.2 State machine

A **priority stack**, not a switch. The current behavior runs until it ends or a higher-priority
behavior interrupts.

| Behavior                            | Priority | Notes                                  |
| ----------------------------------- | -------- | -------------------------------------- |
| `drag`                              | 100      | Preempts everything, never interrupted |
| `overheat`                          | 60       | Preempts `knead`                       |
| `stretch` / `reminder` / `pomodoro` | 50       | User-initiated beats ambient           |
| `pet` (purr)                        | 40       | Only while the cursor is on the head   |
| `hunt`                              | 30       |                                        |
| `unroll`                            | 25       |                                        |
| `think` / `agentDone`               | 20       |                                        |
| `knead`                             | 10       |                                        |
| `walk`                              | 5        |                                        |
| `idle`                              | 0        | Fallback; always legal                 |

Interruption is explicit: a preempting behavior calls `stop('preempted')` on the old one, and the
engine resumes the highest-priority behavior whose `canStart` still returns true — so the cat
returns to `walk`, not to a stale state.

### 4.3 Context

`PetContext` is the single source of truth passed to every `update`: position and velocity,
cursor position and speed, key-rate (derived, never raw), scroll energy, agent state, scheduler
state, current time, and settings. Behaviors read it; they never reach out to globals.

### 4.4 Idle life

The cat must be interesting while untouched. A weighted random director picks from `walk`, `look`,
`stretch`, `groom`, `sit`, `sleep`, `yawn` with cooldowns so repeats are rare. Sleep begins after a
long inactivity period and wakes on input.

---

## 5. Input layer (main process)

### 5.1 Hook

`uiohook-napi`, one listener set, events: `mousemove`, `mousedown`, `mouseup`, `wheel`,
`keydown`, `keyup`.

Derivations, all in main, all in-memory:

| Signal        | Derivation                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `cursor`      | `screen.getCursorScreenPoint()`, polled 60 Hz (independent of hook availability)                       |
| `cursorSpeed` | px/frame, exponentially smoothed (α 0.3)                                                               |
| `wheelEnergy` | Accumulated \|deltaY\|, decays at 6/s — drives paper unroll                                            |
| `keyRate`     | Sliding 60 s window of keydown **counts** → keys/min. Reset on window blur. Never the keys themselves. |

### 5.2 Rate detection thresholds

Tuned in `src/shared/thresholds.ts` so they can be adjusted without touching logic:

| Constant         | Value                                     | Rationale                                           |
| ---------------- | ----------------------------------------- | --------------------------------------------------- |
| `HUNT_SPEED`     | 55 px/frame                               | Above normal pointing, below a flick                |
| `TYPING_ACTIVE`  | 40 keys/min                               | Casual typing                                       |
| `TYPING_FAST`    | 180 keys/min                              | Sustained fast typing                               |
| `OVERHEAT_ENTER` | 240 keys/min for 3 s                      | Must be sustained, or every burst overheats the cat |
| `OVERHEAT_EXIT`  | 120 keys/min for 5 s                      | Hysteresis stops flicker                            |
| `PET_STROKE`     | 3 crossings over the head region / 600 ms | Stroking, not resting                               |
| `IDLE_SLEEP`     | 180 s                                     |                                                     |

---

## 6. Art pipeline

The most important design decision in the project.

### 6.1 Sprites are ASCII, not PNG

Frames are authored as **color-indexed character maps** in TypeScript, compiled to an atlas at
runtime.

```ts
// one 8x8 frame, '.' is transparent
const F1 = `
..BBBB..
.BBBBBBB.
`;
```

Why:

- **Feature 01 is a data operation.** "Give the cat your cat's markings" only works if markings are
  addressable. With indexed art, remapping is `palette[i] = newColor`. With PNGs it is impossible
  without an inpainting model.
- Diff-able and reviewable in a pull request, no image editor required.
- License-clean by construction — the art is source code in the repo.
- Lossless, tiny, and we can generate variants programmatically.

### 6.2 Palette slots

One fixed slot vocabulary; patterns are just color assignments to these slots.

| Idx | Char | Slot         | Purpose                                    |
| --- | ---- | ------------ | ------------------------------------------ |
| 0   | `.`  | transparent  |                                            |
| 1   | `K`  | `outline`    | Derived from body, never pure black        |
| 2   | `B`  | `body`       | Main fur                                   |
| 3   | `b`  | `bodyShadow` | Shading                                    |
| 4   | `L`  | `light`      | Belly, chest, muzzle                       |
| 5   | `W`  | `white`      | Bib, socks, paws                           |
| 6   | `P`  | `patch1`     | Primary marking (tuxedo bib, tabby mask)   |
| 7   | `p`  | `patch2`     | Secondary marking (stripes, spots, points) |
| 8   | `E`  | `eye`        | Pupil                                      |
| 9   | `e`  | `eyeShine`   | Specular dot                               |
| 10  | `N`  | `pink`       | Nose, inner ear, tongue                    |
| 11  | `S`  | `effect`     | Steam, blush, hearts, sweat                |
| 12  | `T`  | `prop`       | Paper roll, cup, note, timer               |

13 slots. Patterns ship as JSON: `tuxedo`, `tabby`, `ginger`, `tortoiseshell`, `siamese`,
`calico`, `black`, `grey`. Users can save their own (§M7).

### 6.3 Draw stack

Layers compose every frame. This is what makes features cheap: eye follow (02) and expressions work
over _every_ animation because eyes are not baked into the body.

```
0  prop-behind
1  body frame          ← palette-remapped
2  eye layer           ← pupils (clamped, eased) OR expression glyphs
3  effect overlay      ← steam, hearts, sweat, zzz
4  stage UI            ← speech bubble, pomodoro timer, pinned note
```

Eyes are procedural: each frame declares `eyeAnchors: [{x, y, r}]`, where `r` is the socket radius in
grid cells. The layer draws a sclera, then a pupil at 0.55·r whose travel is capped at the remaining
radius — so the pupil can never leave its socket, whatever the cursor does, and a future sprite with
bigger eyes gets proportionally more movement without a new threshold. Frames with no anchor (closed
eyes, happy squint) simply render no pupils, so eye follow degrades gracefully instead of breaking.

**The socket has to be bigger than the pupil.** A socket that is entirely pupil has nowhere for the
pupil to go, and the cat can only stare straight ahead. The base cat's sockets are 5×5 with a 3×3
sclera, which is the smallest that still reads as movement at 3× scale.

The eased, clamped pupil offset lives on `Context`, not in the draw pass, so the render loop advances
it exactly once per frame and drawing stays a pure function of the context.

Expressions are a separate glyph set layered on the eye anchor: `neutral`, `happy ^^`, `angry ><`,
`dead -_-`, `thinking ?_?`, `surprised O_O`, `sleepy -.-`.

### 6.4 Compile & cache

`src/sprites/compile.ts` turns ASCII into typed arrays at startup (~ms). The remapped RGBA atlas is
cached in an offscreen canvas keyed by `catId:patternId:paletteHash`; a palette change re-renders
once. **Per frame the cost is ~4 `drawImage` calls plus a transform.** Target: under 2 ms CPU per
frame.

The opaque mask for click-through (§3.2) comes from the same indexed data.

### 6.5 Base cat

One cat shape to start: a chunky sitting/standing tuxedo-ish cat, because it reads well at small
sizes and its markings are the most flexible. Base grid **48×48**, scaled 2–3× by display DPI
(`CAT_SCALE` 3 → 144×144 logical).

**Authored (M1):** `idle` (4), `walk` (4), `dangle` (3), `stretch` (2), `groom` (4), `cheer` (2).
19 frames. Generated by `scripts/gen-cat.mjs` from a parametric description, then committed as
readable ASCII — see §6.6.

**Still owed:** `hunt` (4), `unroll` (3), `pet` (2), `knead` (2), `overheat` (2), `think`,
`surprised`, `peek` (2), plus `sleep`/`yawn` poses. ~30 more frames, by M2/M6.

Note that several of these do **not** need frames at all, because the eye and effect layers are
procedural (§6.3): `blink`, `sleepy`, `happy`, `surprised`, `angry`, `thinking` and the whole
overheat _colour_ shift are runtime overlays over an existing body frame. Only genuinely new
_poses_ — `hunt`, `unroll`, `pet`, `knead`, `overheat`, `peek` — need authored pixels.

### 6.6 Art is generated, then committed

Frames come from `scripts/gen-cat.mjs`, a parametric description of the cat (silhouette, ear
placement, muzzle, bib patch, tail path, per-animation pose offsets). Running it writes
`src/sprites/cats/nunu.ts`. The generated ASCII is committed rather than built at install time so
that:

- the art is reviewable in a pull request as a character-grid diff, no image viewer required;
- the repository is self-contained and buildable with no asset pipeline;
- `.art/review/nunu.png` gives reviewers a rendered contact sheet, generated on demand.

`scripts/preview.mjs` prints any animation to the terminal as an ASCII ramp, which is how the art
gets iterated on without an image viewer in the loop.

---

## 7. Module map

The map below is the **shape at the end of M1**, not the target. Modules appear in a milestone the
first time they are needed, and this section is updated when that happens.

```
littlepet/
├─ PLAN.md  README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  CHANGELOG.md
├─ LICENSE  LICENSE-NOTICE.md
├─ docs/     architecture.md  behavior-specs.md  art-pipeline.md  PARITY.md  ASSETS.md
├─ package.json  electron-builder.yml  tsconfig.json  vitest.config.mts  eslint.config.mjs
├─ .prettierrc  .prettierignore  .gitattributes  .github/workflows/ci.yml
├─ scripts/
│   build.mjs               esbuild: main → dist/main, preload → dist/preload,
│                           renderer bundles → dist/renderer; copies static files
│   gen-cat.mjs             parametric cat → src/sprites/cats/nunu.ts (ASCII, §6.6)
│   preview.mjs             print any animation to the terminal as an ASCII ramp
│   gen-icons.mjs           draw the icon from the cat's primitives → build/icon/ (.icns/.ico)
│   check-assets.mjs        §9.4 asset provenance + license audit
│   lib/pixel.mjs  lib/png.mjs    shared helpers for the scripts above
├─ src/
│   shared/     types.ts  api.ts  thresholds.ts  sampler.ts
│   sprites/    compile.ts  palette.ts  cats/nunu.ts  patterns/
│   main/       index.ts  stage.ts  settings.ts
│   preload/    index.ts
│   renderer/pet/   index.html  main.ts  animator.ts  behavior.ts  context.ts  hit.ts
│                   behaviors/   drag.ts groom.ts idle.ts walk.ts
│                   physics/     mochi.ts
│                   render/      atlas.ts  draw.ts  eyes.ts
│   renderer/settings/  index.html  main.ts
└─ tests/      unit/   (integration/ and golden/ arrive in M2+)
```

Deliberate deviations from the original sketch, and why:

- **No `assets/` directory.** The icon is _drawn_ by `scripts/gen-icons.mjs` from the same primitives
  as the cat — an SVG in the repo would be a committed binary, which §9.4 forbids. Output goes to
  `build/icon/`, which is gitignored, and `electron-builder.yml` points there.
- **No `loop.ts`, `machine.ts`, `draw/` or `ui/` yet.** The frame loop, the behaviour priority
  machine and the canvas draw pass are currently one function each in `renderer/pet/main.ts` and
  are split out as soon as a second caller exists (`animator.ts`, `behavior.ts`, `render/`).
- **No `atlas.ts`/`mask.ts`/`remap.ts` in `src/sprites/`.** Those are the M7 pattern/colour
  features. M1 ships `compile.ts` (ASCII → indices → RGBA) and `palette.ts` only.
- **`vitest.config.mts`, not `.ts`.** `package.json` deliberately has no `"type": "module"`, so the
  ESM config needs the explicit extension; the same reason the scripts are `.mjs`.
- **`patterns/` is committed but empty** (`.gitkeep` only) until M7, so the copy step in
  `build.mjs` and the provenance audit have a stable target.

---

## 8. Milestones

Each ends with something runnable. **M1 ships without native dependencies.**

### M0 — Scaffolding _(complete)_

Repo, TS config, Electron bootstrap, tray, settings store, lint/CI, `docs/PARITY.md` seeded.
**Exit:** `npm run dev` opens a transparent window with a drawn cat.

### M1 — Core engine _(current)_

Stage window + click-through hit test, sprite pipeline, animator, priority state machine,
`idle`/`walk`/`blink`, eye follow (02), drag with mochi physics (03), idle director, multi-display,
preload + MessagePort bus.
**Exit:** a cat sits on the desktop, follows your eyes, and you can pick it up and shake it like
mochi. Runs with the native hook disabled.

### M2 — Input reactions

Global hooks, `hunt` (04), `pet`/purr (05), `knead` (06), `overheat` (07), `unroll` (10).
**Exit:** every continuous input reaction works system-wide.

### M3 — Reminders

Scheduler with persistence and suspend/resume, `stretch` (08), water (09), message reminder (14),
fixed note (15), name (16), speech bubbles.
**Exit:** reminders fire reliably, including after a laptop suspend.

### M4 — Pomodoro

Focus/break cycles, the floating pixel timer, settings.
**Exit:** a working Pomodoro with the timer beside the cat.

### M5 — Agent integration

Process detection + opt-in status-file hooks, `think` (11), `agentDone` (12).
**Exit:** supported agents put on a thinking face and the cat celebrates completion.

### M6 — Shell & settings

Settings window, tray menu, onboarding + Accessibility permission guide, onboarding for pattern,
autostart, config export/import, peek mode (18).
**Exit:** a shippable product surface.

### M7 — Art & customization

Pattern editor, palette mapping UI, saved user patterns, more cat shapes, more animation polish.
**Exit:** feature 01 is fully user-driven.

### M8 — Packaging & release

electron-builder for mac arm64/x64, Windows x64, Linux AppImage, CI matrix, icons, GitHub
Releases, docs.
**Exit:** installable everywhere; a download page users can trust.

### M9 — Polish

Sound, more locales, idle micro-animations, community cat submissions.

---

## 9. Quality gates

### 9.1 Testing

- **Unit** — behaviors, state machine priority/preemption, physics determinism, palette remap,
  scheduler timing, thresholds.
- **Integration** — Playwright `_electron`: window geometry, click-through toggling, tray, settings.
- **Golden images** — every rendered frame compared to a committed PNG. Catches art regressions
  pixel-for-pixel; the single highest-value test in an art-heavy app.
- **Determinism** — the simulation takes an injected clock. No `Date.now()` inside behaviors.

### 9.2 Performance budget

60 fps steady. Per frame: < 2 ms CPU, < 8 draw calls, zero allocation in the hot path (pool
particles, reuse vectors). Idle memory < 150 MB. Verified by a benchmark test.

### 9.3 CI

One gating job on `ubuntu-latest`: `lint` · `typecheck` · `unit` · `assets` audit, plus a check that
`src/sprites/` is reproducible (`npm run cat` leaves the tree clean, so a generator change cannot
merge without its regeneration). Then a build matrix (ubuntu / macos / windows) and an
`integration` slot under `xvfb` for the Playwright tests as they land. `golden` joins when golden
images exist.

### 9.4 Enforcement tests (guard rails)

These are unusual and intentional — they keep the project honest. Each is duplicated as an ESLint
rule where a rule can express it, because a guard rail in one place is a guard rail that can be
edited away:

1. **No network in `src/`** — fails if `fetch`, `net.request`, `XMLHttpRequest`, `WebSocket`,
   `EventSource`, `sendBeacon` or an HTTP client library appear outside an allowlist that is
   **empty on purpose**. Enforces §0.3.
2. **No key content retained** — asserts `countKey()` takes no parameters, that no `PetSnapshot`
   field could hold a key, that nothing persists input, and that no source line logs one.
3. **Asset provenance** — every file in `src/sprites/` must be in `docs/ASSETS.md` with an origin of
   "authored", "generated" or an accepted license, and every accepted third-party license must have
   its text in `LICENSE-NOTICE.md`. No binary image, audio or font committed anywhere under `src/`.
   Enforces §0.1.
4. **Parity table** — every feature in §1 appears in `docs/PARITY.md`, no unchecked boxes, and every
   row marked `done` names an acceptance test file that exists.
5. **No wall clock in the renderer** — fails if `Date.now()`, `performance.now()` or `new Date`
   appear under `src/renderer/`. Enforces §9.1's determinism.

---

## 10. Definition of done

A feature is done when it is in the parity table, has an acceptance test, passes the golden-image
check if it has art, degrades gracefully without the native hook, and is documented in
`docs/behavior-specs.md`.

---

## 11. Open questions

- Sound: default on or off? (Decided: **off by default**, opt-in.)
- Should the cat be a single instance only? (Yes — multi-instance is a config option in M9.)
- Linux: ship AppImage in M8 or hold until after? (AppImage — there is demand.)
