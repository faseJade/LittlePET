# LittlePET

A pixel cat that lives on your desktop. It follows your cursor with its eyes, you can pick it up
and shake it like mochi, and it reacts to how you work — overtyping gets it hot, scrolling too much
unrolls it into a scroll of paper, sitting still too long makes it stretch.

Open source, MIT licensed, free, and it never talks to the network.

```
   ░░░░░░░░░
  ░██████████░
  ░█◆██████◆█░      ← the socket rim is 5×5, the sclera 3×3,
  ░██████████░         and the pupil is drawn at runtime, which is
   ░█◆██████◆█░         why blinking and eye follow cost nothing
    ░████████░
      ░████░
```

**Status: M1, the core engine.** A cat sits on your desktop, watches your cursor, and can be
picked up and shaken. Everything else is on the roadmap and honestly labelled — see
[docs/PARITY.md](docs/PARITY.md) for exactly what works, and [PLAN.md](PLAN.md) for the whole plan.

---

## Why this project is built the way it is

Three decisions run through everything, and they explain most of the odd-looking code:

**The art is indexed ASCII, not PNG.** A sprite frame here is a grid of _palette slots_, not
colours:

```
KKKKKKKKKKKK............
KBBBBBBBBBBK............
KBPPBBBBBBBK............
KBBBBBBBBBBK............
```

A pattern is then a dozen colour values. Recolouring the entire cat is a data operation, which is
what makes "make it look like my cat" a real feature instead of asking users to draw sprite sheets.
It also means a pull request that changes the art is a character-grid diff anyone can review in a
terminal, and that no binary of unknown provenance is ever committed.

**Eyes are procedural, not sprites.** The frames declare where the sockets are; pupils, lids and
expression glyphs are drawn at runtime. So blinking, eye follow, `happy`, `surprised`, `thinking`,
`sleepy` and the whole overheat colour shift cost nothing and work identically over every animation.

**The privacy claim is structural.** LittlePET knows how fast you type. It cannot know _what_ you
type — `InputSampler.countKey()` takes no parameters, so there is no value a caller could hand it.
There is no telemetry, no update check, no account, no license key. Enforced by tests that read the
source rather than trusting a comment; see [docs/architecture.md](docs/architecture.md).

## Install

Requires Node 20+. From a clone:

```bash
npm install
npm run dev
```

That builds and launches a transparent window with a cat in it. No asset pipeline, no image
toolchain, nothing to configure.

Other commands:

| Command                | Does                                                     |
| ---------------------- | -------------------------------------------------------- |
| `npm run dev`          | Build and run.                                           |
| `npm run watch`        | Rebuild on change.                                       |
| `npm test`             | 135 unit tests, no display needed.                       |
| `npm run verify`       | Lint · typecheck · test · asset audit. What CI runs.     |
| `npm run cat`          | Regenerate the sprite source from `scripts/gen-cat.mjs`. |
| `npm run preview idle` | Print any animation as text. See below.                  |
| `npm run icons`        | Generate app icons into `build/icon/` (never committed). |
| `npm run assets:audit` | Check every asset has a stated origin.                   |
| `npm run dist`         | Package with electron-builder.                           |

### Reviewing the art without an image viewer

The art tooling prints to the terminal, which is how the sprites in this repo were drawn:

```bash
npm run cat
npm run preview walk 4
```

```
WALK  48x48 per frame, 4 shown
legend: # outline  ░ body  ▒ shadow  . light  * white  @ patch1  ~ pink
```

## How it works

Two processes, one channel, no shared globals.

```
main        uiohook + screen → InputSampler → PetSnapshot ──60 Hz, MessagePort──▶
renderer    Context → BehaviorMachine → Mochi → Animator → Renderer ──commands──▶ main
```

Main owns the three things the renderer cannot do: read global input (it is a native addon, and a
`focusable: false` window never sees keyboard focus), keep time (reminders must fire whether or not
anyone is looking), and touch the disk (the renderer is sandboxed with no filesystem access).

The renderer owns simulation and drawing, which is what makes 135 tests run in about a second with
no Electron and no display. Every rate is per second, every spring is stepped by `dt`, and there is
no `Date.now()` anywhere in the renderer — a test enforces that too.

Full detail, including why the cursor crosses the process boundary in stage-local logical pixels
and why the click-through mask is a union across all frames:
[docs/architecture.md](docs/architecture.md).

## Documents

|                                                  |                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PLAN.md](PLAN.md)                               | The authoritative plan: parity matrix, stack, architecture decisions, milestones, quality gates. Anything not in here gets added to here before it is built. |
| [docs/BUILD-LOG.md](docs/BUILD-LOG.md)           | Handover document: what was built, why each decision was made, what is verified, what is not.                                                                |
| [docs/PARITY.md](docs/PARITY.md)                 | What works, what doesn't, and the acceptance test for each. Every `done` row is checked against a real test file.                                            |
| [docs/architecture.md](docs/architecture.md)     | Process split, bridge, click-through, the frame loop, the behavior machine.                                                                                  |
| [docs/behavior-specs.md](docs/behavior-specs.md) | One entry per reaction: triggers, mechanics, how it ends, what it must not do.                                                                               |
| [docs/art-pipeline.md](docs/art-pipeline.md)     | Slots, the generator, and the rules that are not obvious.                                                                                                    |
| [docs/ASSETS.md](docs/ASSETS.md)                 | Provenance of every asset.                                                                                                                                   |
| [LICENSE-NOTICE.md](LICENSE-NOTICE.md)           | Third-party position and dependency licenses.                                                                                                                |
| [CONTRIBUTING.md](CONTRIBUTING.md)               | How to add a behavior or draw a frame.                                                                                                                       |
| [SECURITY.md](SECURITY.md)                       | Reporting a vulnerability.                                                                                                                                   |

## What LittlePET deliberately does not have

These are permanent decisions, not gaps:

- **No license key, no payment, no device limit.** The app is MIT and free. Anyone can fork it.
- **No account, no sign-in, no telemetry, no crash reporting.** Nothing leaves the machine.
- **No auto-updater.** Downloading and running code for you is not something a pet app should do.
- **No network access at all.** Not for anything. If a future version needs it, that is a commit
  someone has to make out loud, not a line someone deletes.

What is in the plan but not built yet: mouse hunting, purring, keyboard kneading, overheat mode,
reminders, Pomodoro, agent integration, peek mode, the settings window and the pattern editor.
Honest statuses in [docs/PARITY.md](docs/PARITY.md).

## Graceful degradation

`uiohook-napi` is a native addon and can be missing or blocked (macOS Accessibility). The app runs
either way: without it you keep cursor tracking, eye follow, dragging and click-through, and lose
only the system-wide typing and scroll reactions. `hookActive` travels in every snapshot so the app
can be honest about what it can see instead of showing a reaction that never fires.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). If you want to draw
something, start with [docs/art-pipeline.md](docs/art-pipeline.md): the generator draws the cat from
parametric primitives, and `npm run preview` shows your work as text.

## License

MIT. See [LICENSE](LICENSE).

LittlePET is an independent reimplementation. It matches the feature set and feel of a
commercially available desktop pet and nothing else — every sprite, logo, name and line of copy here
is original. See [PLAN.md §0.1](PLAN.md).
