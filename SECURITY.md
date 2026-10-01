# Security policy

## Reporting a vulnerability

**There is no published security contact address yet.** Until one exists, contact a maintainer
directly through their GitHub profile rather than opening a public issue for anything exploitable.
This is a tracked gap, not an oversight — it is listed in [PLAN.md §8](PLAN.md) under M8.

Include a description, steps to reproduce, and your version or commit SHA. We aim to acknowledge
within a few days. There is no bug bounty.

## What this app can and cannot see

Worth stating plainly, because it is the property most worth protecting:

|                               |                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keystrokes**                | Counted, never read. `InputSampler.countKey()` takes no parameters, so no key content can reach it. Only `keyRate` — keys per minute — ever leaves the process, and only into the renderer, which keeps it in memory. |
| **Network**                   | None. No request of any kind, at any time. Enforced by a lint rule, a test, and an intentionally empty allowlist.                                                                                                     |
| **Filesystem**                | The renderer is sandboxed with no filesystem access. Only main writes one file: `settings.json` in Electron's userData directory, written atomically.                                                                 |
| **Persistence of activity**   | None. Keystroke rate, scroll energy and cursor position exist in memory for the current session and are not written to disk. Enforced by test.                                                                        |
| **Telemetry / crash reports** | None. There is no code that could send them.                                                                                                                                                                          |
| **Auto-update**               | None. LittlePET never downloads or executes code on its own.                                                                                                                                                          |
| **Global input hook**         | `uiohook-napi`, loaded at runtime, optional. Counts keystrokes and wheel deltas only. If it cannot load — no build tools, or macOS Accessibility not granted — the app logs a warning and runs with local input only. |

## Threat model

LittlePET runs as an unprivileged desktop app with an always-on-top transparent window. Realistic
concerns:

**A malicious renderer.** The pet renderer is `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`. Its only bridge is `window.littlepet`: four methods, no `ipcRenderer`, no
`require`, no filesystem. A bug in the draw or behavior code cannot reach the filesystem or spawn a
process. Content loaded into the window is bundled, not fetched — there is no remote content path.

**Clickjacking / unwanted input capture.** The stage window is click-through at rest, over a
320×240 region. It becomes interactive only while the cursor is on the cat's opaque pixels, and it
holds that state while being dragged so a release outside the window is not lost. It is
`focusable: false`, so it cannot steal keyboard focus.

**Preload compromise.** `uiohook-napi` is a native addon loaded from `node_modules`. It is only as
trustworthy as its package. M1 treats it as optional and the app degrades without it; a supply-chain
compromise of that dependency is out of scope for this project's own mitigation.

**Local attacker.** Anything running as the same user can already read the process and its memory.
Out of scope.

## Known gaps

Honest list, tracked in [PLAN.md](PLAN.md):

- No published security contact yet (above).
- No signed releases or updater, so there is nothing to verify a download against beyond the
  checksum on the release page.
- The `verify` job in CI runs on `ubuntu-latest` with default permissions. It is not hardened against
  a hostile pull request — no `pull_request_target`, no secrets exposed to PRs, but also no
  sandboxing beyond GitHub's default runner.
- The native hook's prebuilt binaries are used as published. There is no local rebuild step in CI.

## Supported versions

LittlePET is pre-1.0 and unreleased. Fixes land on `main`; there are no long-term support branches
yet. Tag-based releases begin in M8.
