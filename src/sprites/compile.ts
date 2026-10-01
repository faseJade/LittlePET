import { PALETTE_SLOTS, SLOT_CHARS, type Pattern, type PaletteSlot } from '../shared/types';

/**
 * Sprite compiler: authored ASCII -> indexed bytes -> RGBA.
 *
 * Deliberately DOM-free so it can be unit tested in Node and reused by the art
 * tooling. The canvas lives in the renderer (see render/atlas.ts).
 *
 * Index 0 is reserved for "transparent". Slots occupy 1..12.
 */

export interface CatSprite {
  readonly id: string;
  readonly grid: { readonly w: number; readonly h: number };
  /** Animation name -> frames of row data. */
  readonly anims: Record<string, readonly (readonly string[])[]>;
  /** Animation name -> per-frame duration in ms. */
  readonly durations: Record<string, readonly number[]>;
}

export const TRANSPARENT = 0;
const SLOT_INDEX: Record<PaletteSlot, number> = Object.fromEntries(
  PALETTE_SLOTS.map((slot, i) => [slot, i + 1]),
) as Record<PaletteSlot, number>;

const CHAR_TO_INDEX: Record<string, number> = {
  '.': TRANSPARENT,
  ...Object.fromEntries(PALETTE_SLOTS.map((slot, i) => [SLOT_CHARS[slot], i + 1] as const)),
};

/**
 * Turn row strings into one byte per pixel.
 * Throws on unknown characters, because a typo in the art should fail loudly
 * rather than render as a hole someone finds three milestones later.
 */
export function parseRows(rows: readonly string[]): Uint8Array {
  const w = rows[0]?.length ?? 0;
  const out = new Uint8Array(w * rows.length);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    if (row.length !== w) {
      throw new Error(`frame row ${y} is ${row.length}px, expected ${w}px`);
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      const idx = CHAR_TO_INDEX[ch];
      if (idx === undefined) {
        throw new Error(`unknown sprite character ${JSON.stringify(ch)} at ${x},${y}`);
      }
      out[y * w + x] = idx;
    }
  }
  return out;
}

/** Flatten every animation into one array, keeping a per-anim frame index. */
export function flatten(sprite: CatSprite): {
  indices: Uint8Array[];
  layout: Record<string, number[]>;
} {
  const indices: Uint8Array[] = [];
  const layout: Record<string, number[]> = {};
  for (const [anim, frames] of Object.entries(sprite.anims)) {
    layout[anim] = frames.map((rows) => {
      indices.push(parseRows(rows));
      return indices.length - 1;
    });
  }
  return { indices, layout };
}

export interface AtlasLayout {
  /** Frames left-to-right, top-to-bottom, 1px gutter. */
  readonly width: number;
  readonly height: number;
  readonly frames: readonly { x: number; y: number; w: number; h: number }[];
  readonly layout: Record<string, number[]>;
  /** Union of opaque pixels across every frame - the click-through mask. */
  readonly mask: Uint8Array;
  /** Tight bounds of that union, in grid cells. */
  readonly bounds: { x: number; y: number; w: number; h: number };
  readonly grid: { w: number; h: number };
}

/**
 * Compute the atlas geometry and the union mask.
 *
 * The mask is the union across *all* frames rather than per-frame, so the
 * click-through hit area does not flicker as the cat animates (PLAN.md 3.2).
 */
export function buildLayout(
  sprite: CatSprite,
  precomputed?: ReturnType<typeof flatten>,
): AtlasLayout {
  const { w, h } = sprite.grid;
  const { indices, layout } = precomputed ?? flatten(sprite);
  const perRow = Math.ceil(Math.sqrt(indices.length));
  const cols = perRow;
  const rows = Math.ceil(indices.length / cols);

  const frames = indices.map((_, i) => ({
    x: (i % cols) * (w + 1),
    y: Math.floor(i / cols) * (h + 1),
    w,
    h,
  }));

  const mask = new Uint8Array(w * h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (const idx of indices) {
    for (let p = 0; p < idx.length; p++) {
      if (idx[p] === TRANSPARENT) continue;
      mask[p] = 1;
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return {
    width: cols * (w + 1) - 1,
    height: rows * (h + 1) - 1,
    frames,
    layout,
    mask,
    bounds:
      maxX < 0
        ? { x: 0, y: 0, w: 0, h: 0 }
        : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    grid: { w, h },
  };
}

/** Resolve one palette into a flat RGBA lookup table indexed like the sprite. */
export function paletteLUT(palette: Pattern): Uint8Array {
  const lut = new Uint8Array((PALETTE_SLOTS.length + 1) * 4);
  for (const slot of PALETTE_SLOTS) {
    const i = SLOT_INDEX[slot]! * 4;
    const c = palette[slot];
    if (!c) continue;
    lut[i] = c[0];
    lut[i + 1] = c[1];
    lut[i + 2] = c[2];
    lut[i + 3] = 255;
  }
  return lut;
}

/**
 * Rasterise indices through a palette LUT into an RGBA buffer the size of the
 * atlas. The renderer uploads this once per pattern change, never per frame.
 *
 * The buffer is explicitly backed by a plain `ArrayBuffer`: `ImageData` rejects a
 * view that might be a `SharedArrayBuffer`, and `Uint8ClampedArray`'s type
 * parameter admits one.
 */
export function rasterize(
  indices: readonly Uint8Array[],
  lut: Uint8Array,
  layout: AtlasLayout,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(layout.width * layout.height * 4));
  for (let f = 0; f < indices.length; f++) {
    const idx = indices[f]!;
    const rect = layout.frames[f]!;
    for (let p = 0; p < idx.length; p++) {
      const slot = idx[p]!;
      if (slot === TRANSPARENT) continue;
      const gx = p % layout.grid.w;
      const gy = (p - gx) / layout.grid.w;
      const d = ((rect.y + gy) * layout.width + (rect.x + gx)) * 4;
      const s = slot * 4;
      out[d] = lut[s]!;
      out[d + 1] = lut[s + 1]!;
      out[d + 2] = lut[s + 2]!;
      out[d + 3] = lut[s + 3]!;
    }
  }
  return out;
}

/** Stable hash of a palette, used as an atlas cache key. */
export function paletteKey(patternId: string, palette: Pattern): string {
  const parts = PALETTE_SLOTS.map((s) => {
    const c = palette[s];
    return c ? `${s}:${c[0]},${c[1]},${c[2]}` : `${s}:-`;
  });
  return `${patternId}|${parts.join(';')}`;
}
