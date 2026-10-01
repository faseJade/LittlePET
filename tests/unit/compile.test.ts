import { describe, expect, it } from 'vitest';
import {
  buildLayout,
  flatten,
  paletteKey,
  paletteLUT,
  parseRows,
  rasterize,
  TRANSPARENT,
  type CatSprite,
} from '../../src/sprites/compile';
import { CHAR_TO_SLOT, PALETTE_SLOTS, SLOT_CHARS, type Pattern } from '../../src/shared/types';
import { NUNU } from '../../src/sprites/cats/nunu';
import { PATTERNS } from '../../src/sprites/palette';

/**
 * Sprite compiler (PLAN.md 6.2).
 *
 * The reason the art is authored as indexed ASCII rather than PNG is this file: a
 * pattern is a per-slot colour assignment, so "make it look like my cat" is a data
 * operation over a lookup table rather than a re-draw. These tests pin the two
 * things that operation depends on - the char-to-slot mapping being total, and the
 * compiler refusing bad art rather than rendering holes.
 */

describe('parseRows', () => {
  it('maps each slot char to a distinct non-zero index', () => {
    const chars = PALETTE_SLOTS.map((slot) => SLOT_CHARS[slot]);
    const out = parseRows([chars.join('')]);
    const seen = Array.from(out);
    // Contiguous 1..N, so paletteLUT can index by slot without a lookup table.
    expect(seen).toEqual(PALETTE_SLOTS.map((_, i) => i + 1));
    expect(seen.includes(TRANSPARENT)).toBe(false);
  });

  it('keeps the char-to-slot and slot-to-index tables in step', () => {
    // Two tables describe the same mapping, and nothing forces them to agree. If a
    // slot is added to one and not the other, `palette[i] = colour` silently starts
    // recolouring the wrong part of the cat.
    for (const slot of PALETTE_SLOTS) {
      const ch = SLOT_CHARS[slot];
      expect(CHAR_TO_SLOT[ch], slot).toBe(slot);
    }
    expect(Object.keys(CHAR_TO_SLOT).sort()).toEqual(
      ['.', ...PALETTE_SLOTS.map((s) => SLOT_CHARS[s])].sort(),
    );
  });

  it('treats "." as transparent', () => {
    expect(parseRows(['....'])).toEqual(new Uint8Array(4));
  });

  it('throws on an unknown character', () => {
    // A typo should fail the build, not render as a hole someone finds in a
    // release three milestones later.
    expect(() => parseRows(['.X.'])).toThrow(/unknown sprite character "X"/);
  });

  it('reports where the bad character is', () => {
    expect(() => parseRows(['..', '.Q'])).toThrow(/at 1,1/);
  });

  it('throws on a ragged row', () => {
    // A row one pixel short would otherwise silently shift every row below it.
    expect(() => parseRows(['...', '..'])).toThrow(/row 1 is 2px, expected 3px/);
  });

  it('accepts an empty frame without throwing', () => {
    expect(parseRows([])).toEqual(new Uint8Array(0));
  });
});

describe('paletteLUT', () => {
  it('indexes by slot so a remap is a data operation', () => {
    const pattern: Pattern = { body: [10, 20, 30] };
    const lut = paletteLUT(pattern);
    // Slot `body` is the second entry, so its RGBA starts at byte 8. Index 1 is
    // `outline`, which the pattern does not define and which is left at zero -
    // defaulting it to opaque black would draw the cat's outline as a solid blob.
    expect(Array.from(lut.slice(8, 12))).toEqual([10, 20, 30, 255]);
    expect(Array.from(lut.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });

  it('leaves index 0 fully transparent', () => {
    // Index 0 is the sentinel every '.' compiles to, and it must never resolve to a
    // colour: a transparent pixel with alpha 255 would paint a black box.
    expect(Array.from(paletteLUT({ body: [1, 2, 3] }).slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('is sized for every slot plus the sentinel', () => {
    expect(paletteLUT({}).length).toBe((PALETTE_SLOTS.length + 1) * 4);
  });
});

describe('paletteKey', () => {
  it('changes when any slot colour changes', () => {
    const a = paletteKey('tuxedo', { body: [1, 2, 3] });
    const b = paletteKey('tuxedo', { body: [1, 2, 4] });
    expect(a).not.toBe(b);
  });

  it('changes when the pattern id changes', () => {
    // Two patterns can share every colour they both define and differ in a slot only
    // one of them sets; the id keeps the atlas cache from confusing them.
    expect(paletteKey('a', {})).not.toBe(paletteKey('b', {}));
  });

  it('is independent of the order slots were set in', () => {
    // The key is built from PALETTE_SLOTS, not from Object.keys, so two palettes
    // with the same colours must not produce two atlas entries.
    expect(paletteKey('p', { body: [1, 2, 3], outline: [4, 5, 6] })).toBe(
      paletteKey('p', { outline: [4, 5, 6], body: [1, 2, 3] }),
    );
  });

  it('is stable for equal input', () => {
    expect(paletteKey('p', { body: [1, 2, 3] })).toBe(paletteKey('p', { body: [1, 2, 3] }));
  });
});

describe('buildLayout', () => {
  const sprite: CatSprite = {
    id: 'test',
    grid: { w: 3, h: 2 },
    anims: {
      sit: [['B..', '..B']],
      wave: [
        ['BBB', '...'],
        ['..B', 'BBB'],
      ],
    },
    durations: { sit: [100], wave: [100, 100] },
  };

  it('records frames left to right, top to bottom, with a 1px gutter', () => {
    const layout = buildLayout(sprite);
    // 3 frames, so a 2-wide grid: 2 columns, 2 rows.
    expect(layout.frames).toEqual([
      { x: 0, y: 0, w: 3, h: 2 },
      { x: 4, y: 0, w: 3, h: 2 },
      { x: 0, y: 3, w: 3, h: 2 },
    ]);
    // The gutter is excluded from the size, so the atlas has no wasted edge column.
    expect(layout.width).toBe(4 + 3);
    expect(layout.height).toBe(3 + 2);
  });

  it('keeps a per-anim frame index alongside the flat frame list', () => {
    expect(buildLayout(sprite).layout).toEqual({ sit: [0], wave: [1, 2] });
  });

  it('unions the mask across frames', () => {
    const { mask, grid } = buildLayout(sprite);
    const at = (x: number, y: number) => mask[y * grid.w + x];
    // sit covers (0,0) and (2,1); wave frame 0 covers the whole top row; wave
    // frame 1 covers the whole bottom row. A per-frame mask would leave the corners
    // unpainted in some frames, punching holes in the cat as it waved.
    expect([at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1)]).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it('leaves a cell empty in the mask when no frame covers it', () => {
    // The complement of the test above: a union that claimed everything would make
    // the whole art box grabbable, including the empty corners around the cat.
    const gapped = buildLayout({
      ...sprite,
      anims: { sit: [['B..', '...']] },
      durations: { sit: [100] },
    });
    expect(gapped.mask[0]).toBe(1);
    expect(gapped.mask[2]).toBe(0);
    expect(gapped.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('reports the tight bounds of the union', () => {
    // Used to crop the drawn region: a 48x48 grid with a cat in the lower half would
    // otherwise allocate and blit 48 rows of nothing every frame.
    expect(buildLayout(sprite).bounds).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it('returns empty bounds for a fully transparent sprite', () => {
    const blank = buildLayout({
      ...sprite,
      anims: { sit: [['...', '...']] },
      durations: { sit: [100] },
    });
    expect(blank.bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('rasterize', () => {
  const sprite: CatSprite = {
    id: 'test',
    grid: { w: 2, h: 2 },
    anims: { sit: [['B.', '.W']] },
    durations: { sit: [100] },
  };
  const layout = buildLayout(sprite);
  const { indices } = flatten(sprite);

  it('writes each slot through the LUT at the frame position', () => {
    const lut = paletteLUT({ body: [1, 2, 3], white: [4, 5, 6] });
    const out = rasterize(indices, lut, layout);
    const px = (x: number, y: number) =>
      Array.from(out.slice((y * layout.width + x) * 4, (y * layout.width + x) * 4 + 4));
    expect(px(0, 0)).toEqual([1, 2, 3, 255]);
    expect(px(1, 1)).toEqual([4, 5, 6, 255]);
  });

  it('leaves transparent cells at zero, including inside a frame', () => {
    const out = rasterize(indices, paletteLUT({ body: [1, 2, 3] }), layout);
    const px = (x: number, y: number) =>
      Array.from(out.slice((y * layout.width + x) * 4, (y * layout.width + x) * 4 + 4));
    expect(px(1, 0)).toEqual([0, 0, 0, 0]);
    expect(px(0, 1)).toEqual([0, 0, 0, 0]);
  });

  it('produces a buffer ImageData will accept', () => {
    // ImageData rejects a view that might be SharedArrayBuffer-backed, and
    // Uint8ClampedArray's type parameter admits one. The buffer is explicitly
    // allocated as a plain ArrayBuffer so the upload cannot fail at runtime - a
    // failure here would be a blank window and nothing else.
    const out = rasterize(indices, paletteLUT({ body: [1, 2, 3] }), layout);
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
    expect(out.length).toBe(layout.width * layout.height * 4);
  });

  it('is deterministic, so a palette change is the only thing that re-uploads', () => {
    const lut = paletteLUT({ body: [1, 2, 3] });
    expect(Array.from(rasterize(indices, lut, layout))).toEqual(
      Array.from(rasterize(indices, lut, layout)),
    );
  });
});

describe('shipped art', () => {
  it('compiles', () => {
    // The real art goes through exactly the same path as the fixtures above, so a
    // bad character in a generated frame is caught by the unit suite rather than by
    // a blank cat on someone's screen.
    expect(() => buildLayout(NUNU)).not.toThrow();
  });

  it('is rectangular and fully known', () => {
    for (const [anim, frames] of Object.entries(NUNU.anims)) {
      const w = NUNU.grid.w;
      for (const [i, frame] of frames.entries()) {
        for (const [y, row] of frame.entries()) {
          expect(row.length, `${anim}[${i}] row ${y}`).toBe(w);
          for (const ch of row) {
            expect(
              ch === '.' || Object.values(SLOT_CHARS).includes(ch as never),
              `${anim}[${i}] ${JSON.stringify(ch)}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('declares a duration for every frame', () => {
    for (const [anim, frames] of Object.entries(NUNU.anims)) {
      expect(NUNU.durations[anim]?.length, anim).toBe(frames.length);
      for (const d of NUNU.durations[anim]!) expect(d).toBeGreaterThan(0);
    }
  });

  it('has a clickable mask', () => {
    const { mask, bounds } = buildLayout(NUNU);
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);
    expect(mask.some((v) => v === 1)).toBe(true);
  });

  it('fits its declared grid', () => {
    expect(NUNU.grid.w * 3).toBeLessThanOrEqual(144);
    expect(NUNU.grid.h * 3).toBeLessThanOrEqual(144);
  });
});

describe('PATTERNS', () => {
  it('defines at least the one the default settings select', () => {
    expect(PATTERNS.tuxedo).toBeDefined();
  });

  it('only assigns real slots', () => {
    for (const [id, pattern] of Object.entries(PATTERNS)) {
      for (const slot of Object.keys(pattern)) {
        expect(PALETTE_SLOTS, `${id}.${slot}`).toContain(slot);
      }
    }
  });

  it('uses opaque RGB triples', () => {
    for (const [id, pattern] of Object.entries(PATTERNS)) {
      for (const [slot, rgb] of Object.entries(pattern)) {
        expect(rgb, `${id}.${slot}`).toHaveLength(3);
        for (const v of rgb!) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});
