# Asset provenance

Every visual and audio asset in LittlePET, and where it came from.

The rule this file exists to enforce: **nothing here was copied from another project.** The
artwork in the original app this is modelled on is copyrightable expression, and reusing it
would get this repository taken down. What is matched is the _feature set_ and the _feel_ — the
sprites, name, logo and copy here are all original. See [PLAN.md §0.1](../PLAN.md).

An enforcement test ([`tests/unit/enforcement.test.ts`](../tests/unit/enforcement.test.ts))
fails the build if a file in `src/sprites/` is missing from the table below, if any origin
is not one of the accepted values, or if a binary image or font is committed under `src/`.

## Accepted origins

| Value                | Meaning                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `authored`           | Drawn for this project. The person or generator that made it is named. |
| `generated`          | Produced by a script in `scripts/` that is itself in this repo.        |
| `CC0`                | Public domain dedication.                                              |
| `OFL`                | SIL Open Font License.                                                 |
| `MIT` / `Apache-2.0` | Permissive, with the license text in `LICENSE-NOTICE.md`.              |

Anything not on this list needs a review before it lands. "Found on the internet" is not an
origin.

## `src/sprites/`

| File                       | Kind   | Origin    | Authored by            | Notes                                                                                                                          |
| -------------------------- | ------ | --------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/sprites/compile.ts`   | code   | authored  | LittlePET contributors | ASCII → indexed bytes → RGBA. Not an asset, listed for completeness.                                                           |
| `src/sprites/palette.ts`   | data   | authored  | LittlePET contributors | Pattern presets. Pure colour values, no borrowed images.                                                                       |
| `src/sprites/cats/nunu.ts` | sprite | generated | `scripts/gen-cat.mjs`  | The base cat. 48×48, 19 frames, 6 animations. Emitted as readable ASCII and committed; see [art-pipeline.md](art-pipeline.md). |

## Other visuals

| Asset             | Kind  | Origin               | Authored by             | Notes                                                                                                                                                                                     |
| ----------------- | ----- | -------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application icons | image | generated            | `scripts/gen-icons.mjs` | Drawn from the same eye-anchor and outline primitives as the cat, so the icon and the app cannot drift apart. Written to `build/` at package time, never committed.                       |
| Sounds            | audio | **not yet authored** | —                       | Sound is opt-in and off by default (PLAN.md §11). When added, every file will be synthesised from oscillator envelopes in `scripts/` rather than sampled, for the same provenance reason. |

## Fonts

The UI uses the platform's system UI font stack. No font file is bundled. A pixel font will be
added later, under `OFL`, and listed here when it is.

## Adding an asset

1. Draw it or generate it from a script in `scripts/`.
2. Add a row to the table above with its origin.
3. Run `npm test`. The provenance test fails if you skipped step 2.
