# Parity

What works, what doesn't, and what proves it. One row per feature in the
[plan matrix](../PLAN.md#1-feature-parity-matrix).

**"done" is a claim about the codebase, not an intention.** Every done row names an acceptance
test that exists and passes; the enforcement test in
[`tests/unit/enforcement.test.ts`](../tests/unit/enforcement.test.ts) fails the build if a row
says `done` without one, or if a file it names is missing. Anything not yet shipped reads
`planned` or `partial` — that is the honest state, and it is what the numbers below mean.

Status values: `partial` (some of it works) · `planned` (not started) · `done` · `n/a`.

| #   | Feature           | Status  | Milestone      | Acceptance                                                                                                                           |
| --- | ----------------- | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | Custom pattern    | partial | M1 base, M7 UI | `tests/unit/compile.test.ts` — indexed art remaps by slot. The pattern editor and saved user patterns are M7.                        |
| 02  | Eye follow        | done    | M1             | `tests/unit/context.test.ts` — pupils ease toward the cursor and clamp inside the socket, over every animation.                      |
| 03  | Mochi drag        | done    | M1             | `tests/unit/mochi.test.ts` — volume-coupled springs, damped wobble, framerate independent.                                           |
| 04  | Mouse hunt        | planned | M2             | —                                                                                                                                    |
| 05  | Purring pets      | planned | M2             | —                                                                                                                                    |
| 06  | Keyboard kneading | planned | M2             | —                                                                                                                                    |
| 07  | Overheat mode     | planned | M2             | —                                                                                                                                    |
| 08  | Stretch reminder  | planned | M3             | —                                                                                                                                    |
| 09  | Water reminder    | planned | M3             | —                                                                                                                                    |
| 10  | Paper unroll      | planned | M2             | —                                                                                                                                    |
| 11  | Thinking along    | planned | M5             | —                                                                                                                                    |
| 12  | Agent done jump   | planned | M5             | —                                                                                                                                    |
| 13  | Pomodoro timer    | planned | M4             | —                                                                                                                                    |
| 14  | Message reminder  | planned | M3             | —                                                                                                                                    |
| 15  | Fixed message     | planned | M3             | —                                                                                                                                    |
| 16  | Tell your name    | planned | M3             | —                                                                                                                                    |
| 17  | Multi-device      | n/a     | M6             | Replaced by config export/import, per [PLAN.md §0.2](../PLAN.md). This is a licensing feature in the original app, not a capability. |
| 18  | Peek mode         | planned | M6             | —                                                                                                                                    |

## Also shipped in M1, outside the feature matrix

These are the engine pieces the features above are built on. They are not user-visible on their
own, so they have no row above, but they are covered:

| Piece                                      | Acceptance                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Stage window, click-through, multi-display | `tests/unit/hit.test.ts` — union mask, 2-in/4-out hysteresis, drag hold                         |
| Behavior priority machine                  | `tests/unit/behavior-machine.test.ts` — preemption, `minDuration`, framerate independence       |
| Animation clock                            | `tests/unit/animator.test.ts` — no drift, per-frame durations                                   |
| Input derivations                          | `tests/unit/sampler.test.ts` — key rate, wheel energy, no key content retained                  |
| Project honesty                            | `tests/unit/enforcement.test.ts` — no network, no key retention, asset provenance, these claims |
| Sprite compiler                            | `tests/unit/compile.test.ts` — bad art fails loudly, palette remap, shipped art compiles        |
