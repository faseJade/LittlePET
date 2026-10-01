import type { Pattern } from '../../../shared/types';
import {
  buildLayout,
  flatten,
  paletteKey,
  paletteLUT,
  rasterize,
  type AtlasLayout,
  type CatSprite,
} from '../../../sprites/compile';

/**
 * Canvas atlas: indexed sprite data + a palette -> one offscreen image.
 *
 * Remapping the pattern rebuilds a single canvas with `putImageData` rather than
 * recolouring per-pixel at draw time. A palette change therefore costs one
 * rasterise and then nothing, and the hot path stays one `drawImage` per frame
 * (PLAN.md 6.4).
 */
export class Atlas {
  readonly layout: AtlasLayout;
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  /** Per-frame index buffers, indexed by the atlas' flat frame number. */
  private readonly indices: readonly Uint8Array[];
  /** Animation name -> per-frame durations in ms. */
  private readonly durations: Record<string, readonly number[]>;
  private key = '';

  constructor(sprite: CatSprite, canvas?: HTMLCanvasElement) {
    // Parse the ASCII once, then derive both the geometry and the index buffers
    // from the same pass.
    const flat = flatten(sprite);
    this.layout = buildLayout(sprite, flat);
    this.indices = flat.indices;
    this.durations = sprite.durations;

    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.width = this.layout.width;
    this.canvas.height = this.layout.height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * Rebuild the atlas if the palette changed. Returns true when it re-rendered,
   * so callers can avoid a pointless redraw.
   */
  applyPalette(patternId: string, palette: Pattern): boolean {
    const key = paletteKey(patternId, palette);
    if (key === this.key) return false;
    this.key = key;
    const rgba = rasterize(this.indices, paletteLUT(palette), this.layout);
    this.ctx.putImageData(new ImageData(rgba, this.layout.width, this.layout.height), 0, 0);
    return true;
  }

  /** Flat frame numbers for an animation, or an empty list if the name is unknown. */
  frames(anim: string): readonly number[] {
    return this.layout.layout[anim] ?? [];
  }

  /** Per-frame durations in ms, matched to `frames(anim)`. */
  durationsFor(anim: string): readonly number[] {
    const frames = this.layout.layout[anim];
    const table = this.durations[anim];
    if (!frames) return [];
    return frames.map((_, i) => table?.[i] ?? 100);
  }

  /** True when the sprite has this animation, so behaviors can degrade politely. */
  has(anim: string): boolean {
    return (this.layout.layout[anim]?.length ?? 0) > 0;
  }

  /** Top-left corner of a flat frame, in atlas pixels. */
  rect(frame: number): { x: number; y: number; w: number; h: number } | null {
    return this.layout.frames[frame] ?? null;
  }

  /** An animation's first frame, used as a still fallback. */
  firstFrameOf(...anims: readonly string[]): number {
    for (const anim of anims) {
      const f = this.layout.layout[anim]?.[0];
      if (f !== undefined) return f;
    }
    return 0;
  }
}
