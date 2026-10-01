# Art pipeline

LittlePET's artwork is **indexed ASCII committed to the repository**. No PNG sprite sheet, no
texture atlas binary, no image viewer needed to review a change.

That is a deliberate choice, and it is what makes feature 01 ("custom pattern") possible at all.
Read this before drawing anything.

## The idea

A sprite frame is not a picture. It is a **grid of palette slots**:

```
KKKKKKKKKKKK............
KBBBBBBBBBBK............
KBPPBBBBBBBK............
KBBBBBBBBBBK............
KKKKKKKKKKKK............
```

Each character names a _slot_ — `outline`, `body`, `bodyShadow`, `patch1`, `pink` — and never a
colour. A pattern is then nothing more than a colour per slot:

```ts
{
  outline:   [32, 26, 30],
  body:      [224, 155, 78],   // ginger
  patch1:    [201, 124, 51],
  eye:       [110, 150, 88],
}
```

Recolouring the entire cat is therefore a data operation over ~10 numbers, applied at runtime to
one offscreen atlas. If the art were PNGs, "make it look like my cat" would mean asking the user to
supply a new sprite sheet — which is a different, much worse feature.

The slot list is fixed in `src/shared/types.ts`:

| Char | Slot          | Used for                                            |
| ---- | ------------- | --------------------------------------------------- |
| `.`  | _transparent_ | Background, and the space around the cat. Index 0.  |
| `K`  | `outline`     | The one-pixel silhouette outline.                   |
| `B`  | `body`        | Main coat.                                          |
| `b`  | `bodyShadow`  | Lower-right shading.                                |
| `L`  | `light`       | Upper-left highlight, paws, chest.                  |
| `W`  | `white`       | Bib, sclera.                                        |
| `P`  | `patch1`      | Marking 1 — tuxedo bib, tabby saddle, calico patch. |
| `p`  | `patch2`      | Marking 2.                                          |
| `E`  | `eye`         | Pupil.                                              |
| `e`  | `eyeShine`    | Catchlight.                                         |
| `N`  | `pink`        | Inner ear, nose.                                    |
| `S`  | `effect`      | Steam, hearts, sweat.                               |
| `T`  | `prop`        | Timer, note, paper.                                 |

`eyeShine`, `effect` and `prop` are listed in `FIXED_SLOTS` and are not part of the coat, so a user
pattern cannot accidentally recolour the catchlight into something invisible.

## The generator, and why the output is committed

```
scripts/gen-cat.mjs  ──writes──▶  src/sprites/cats/nunu.ts     (COMMITTED)
                              └▶  .art/review/nunu.png         (gitignored)
                              └▶  .art/review/nunu.json        (gitignored)
```

```bash
npm run cat                  # regenerate the committed ASCII
npm run preview idle         # print frames to the terminal as text
npm run preview walk 4
```

**Why commit generated output?**

- A pull request that changes the art is a character-grid diff. A reviewer sees exactly which pixels
  moved, in any GitHub viewer, in any terminal, with no tools.
- The repository is self-contained. `npm install && npm run build` works with no asset pipeline, no
  image toolchain, and nothing checked in that could have a broken encoding.
- A generated file that is _not_ committed forces every contributor to run the generator, and makes
  the committed truth ambiguous.

**Why have a generator at all**, if the output is committed? Because 19 frames drawn by hand drift.
By the fifth frame the ears are two pixels wider and by the twelfth the tail has a different curve.
The generator exists so the frames stay _consistent with each other_; the committed ASCII is what the
app actually loads.

If you change `gen-cat.mjs`, run `npm run cat` and commit both files. The diff in `nunu.ts` is the
review artifact.

## Authoring primitives

`scripts/lib/pixel.mjs` is a tiny drawing library over a `char[][]` grid:

| Function                                | Notes                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `set(g,x,y,ch,over)`                    | Single pixel. `over` is false by default, so shapes _cannot_ erase what is already drawn unless they say so. |
| `ellipse(g,cx,cy,rx,ry,ch,over)`        | Rasterised, not a font glyph.                                                                                |
| `triangle(g,…)`                         | Three filled scanline bands.                                                                                 |
| `line`, `curve`, `sampleSpline`         | Stroked paths, for tails and whiskers.                                                                       |
| `outline(g,'K')`                        | Traces every transparent-adjacent opaque pixel. Run **last**.                                                |
| `shadeWhere(g,test,ch)`                 | Recolour pixels matching a predicate. The shading pass is two calls to this.                                 |
| `toRows`, `fromRows`                    | Grid ⇄ string array, the actual on-disk format.                                                              |
| `paint(rgba,W,H,g,ox,oy,scale,palette)` | Blits a grid into an RGBA buffer. Used for contact sheets.                                                   |

Poses are built rear-to-front, so each shape overlaps the one behind it: torso → chest → bib → legs →
tail → ears → skull → ear inners → face. Drawing the skull _after_ the ears is what hides their bases;
drawing the bib _after_ the torso but _before_ the skull is what stops the chin painting over it.

## Rules that are not obvious

These are all things that were got wrong first and now have a comment in the generator explaining
why. Read them before "fixing" the generator.

**Every landmark is snapped to whole pixels.** `Math.round` on every offset. Pixel art with
sub-pixel landmarks shimmers between frames.

**Outline after shading.** `outline()` wraps `shade2()`, never the other way round. Shading after
outlining would darken the outline itself and the cat would lose its silhouette.

**The shading bands need to be wider than instinct suggests.** `LIT_R = 0.27`, `SHADOW_R = 0.44`.
With tighter bands the falloff eats whole features — the bib marking vanished entirely at
0.185/0.225. When in doubt, widen them.

**Shading skips eye sockets.** `lastEyeCells` records the socket footprint per frame and
`getIsBody()` refuses those cells. `shade2()` considers `W` body — right for a bib, wrong for an
eyeball — and without the exclusion the shading pass paints over the sockets and the cat ends up
with lit, flat eyes that the runtime then draws a pupil on top of.

**No one-pixel detail.** At a 48px grid scaled 3×, whiskers and a drawn mouth turn into speckle.
The face is muzzle, sockets, nose. That is all. The eyes are the one feature that _has_ to be big —
see below.

**Draw order is load-bearing.** `drawFace` always uses `over: true`, because every facial feature
sits on top of an already-painted skull.

## The eyes are not in the art

**The frames contain no pupils.** Each frame declares where its sockets are:

```ts
export interface EyeAnchor {
  x: number; // socket centre, grid cells from the frame's top-left
  y: number;
  r: number; // socket radius in cells; also the clamp on pupil travel
}
```

and `src/renderer/pet/render/eyes.ts` draws the sclera, pupil and catchlight procedurally at those
anchors, plus blink lids and expression glyphs.

This is what makes blinking, eye follow, `happy`, `surprised`, `angry`, `thinking`, `sleepy` and the
entire overheat colour shift **free** — they are runtime state, not separate hand-drawn frames, and
they work identically over every animation.

### Socket sizing rule

> A socket that is entirely pupil has nowhere for the pupil to go.

Current sockets are **5×5** (`K` rim) with a **3×3** `W` sclera and anchor `r = 2`, and
`PUPIL_RADIUS = 0.55`. That holds a 3-cell pupil with a cell of travel in every direction — the
smallest size that still reads as _movement_ rather than as a stare.

The travel budget is derived from the socket (`r - PUPIL_RADIUS * r`), not from a global constant,
so a bigger eye in a future sprite gets proportionally more movement with no new threshold.

If you draw a new pose, size its sockets by this rule or eye follow will look broken on that
animation only — which is exactly the kind of bug that survives review.

## Reviewing art without an image viewer

`scripts/preview.mjs` prints any animation as text using a shading ramp:

```
IDLE  48x48 per frame, 4 shown
legend: # outline  ░ body  ▒ shadow  . light  * white  @ patch1  ~ pink
```

| Printed | Slot                                                                 |
| ------- | -------------------------------------------------------------------- |
| (space) | transparent                                                          |
| `#`     | outline                                                              |
| `░`     | body                                                                 |
| `▒`     | bodyShadow                                                           |
| `.`     | light                                                                |
| `*`     | white                                                                |
| `@`     | patch1                                                               |
| `%`     | patch2                                                               |
| `O`     | eye                                                                  |
| `o`     | eyeShine                                                             |
| `~`     | pink                                                                 |
| `s`     | effect                                                               |
| `?`     | unknown character — this is a **bug**, the compiler will throw on it |

Frames are printed side by side so the walk cycle's contact and passing poses can be compared in one
glance.

`.art/review/nunu.png` is a labelled contact sheet for the same frames, written on demand by
`npm run cat`. It is gitignored and is a convenience for anyone who _can_ view images — it is not
part of the review process, and nothing in CI depends on it.

## Provenance

Every file under `src/sprites/` must have a row in [ASSETS.md](ASSETS.md) naming its origin, and no
binary image or font may be committed under `src/`. `npm run assets:audit` and
`tests/unit/enforcement.test.ts` both fail otherwise.

Nothing in this repository is copied from another project. The app this is modelled on has its own
copyrightable artwork; what is matched here is the feature set and the feel, and every pixel is ours.
See [PLAN.md §0.1](../PLAN.md).

## Adding art

1. **New animation?** Add a `pose*` function in `gen-cat.mjs`, register it in `ANIMS` with
   per-frame durations, then `npm run cat`. Declare eye anchors in the face pass — a pose that
   forgets will render with no eyes and no error.
2. **New cat shape?** Copy the file as `cats/<id>.ts`, change the id and the grid, and add a row to
   `ASSETS.md` and a key to `patternId`'s accepted values in the settings panel (M7).
3. **New pattern preset?** It is twelve lines in `src/sprites/palette.ts`. No art changes needed at
   all. That is the payoff of the whole design.
4. **Then:** `npm run cat`, `npm run preview <anim>`, `npm test`.
