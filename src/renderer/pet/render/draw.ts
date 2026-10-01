import {
  CAT_ANCHOR,
  CAT_H,
  CAT_SCALE,
  CAT_W,
  STAGE_H,
  STAGE_W,
  type EyeAnchor,
  type RGB,
} from '../../../shared/types';
import type { Context } from '../context';
import type { Atlas } from './atlas';
import { EyeLayer } from './eyes';

/**
 * The draw stack (PLAN.md 6.3).
 *
 * ```
 * 0  prop-behind
 * 1  body frame     <- palette-remapped
 * 2  eye layer      <- pupils or expression glyphs
 * 3  effect overlay <- steam, hearts, sweat
 * 4  stage UI       <- speech bubble, timer, pinned note
 * ```
 *
 * Everything is drawn in device pixels with no smoothing and no sub-pixel
 * positions, because one blurred pixel in an otherwise crisp pixel-art window is
 * instantly visible (PLAN.md 2).
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly eyes: EyeLayer;
  private eyeColor = { eye: [24, 20, 26] as RGB, shine: [255, 255, 255] as RGB };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly atlas: Atlas,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: true })!;
    this.ctx.imageSmoothingEnabled = false;
    this.eyes = new EyeLayer(this.ctx, this.eyeColor);
  }

  /** Called when the palette changes, so pupils follow the pattern's eye colour. */
  setEyeColor(eye: RGB, shine: RGB): void {
    this.eyeColor = { eye, shine };
  }

  /**
   * @param frame     Flat frame number to draw.
   * @param anchors   That frame's eye sockets, in grid cells.
   * @param ctx       Live context: blink, expression, mochi, position.
   * @param scale     Logical pixels per art cell.
   */
  draw(frame: number, anchors: readonly EyeAnchor[], ctx: Context, scale = CAT_SCALE): void {
    const dpr = window.devicePixelRatio || 1;
    const w = STAGE_W * dpr;
    const h = STAGE_H * dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);

    // Cat position is in logical pixels; the mochi transform is applied about the
    // cat's own centre so it squashes in place rather than toward the origin.
    const cxLogical = CAT_ANCHOR.x + ctx.position.x + CAT_W / 2;
    const cyLogical = CAT_ANCHOR.y + CAT_H / 2;

    this.ctx.save();
    this.ctx.scale(dpr, dpr);
    this.ctx.translate(cxLogical, cyLogical);
    this.ctx.rotate(ctx.mochi.angle * 0.35);
    this.ctx.scale(ctx.mochi.sx, ctx.mochi.sy);
    this.ctx.translate(-cxLogical, -cyLogical);

    // Flip around the centre for facing, which is cheaper and sharper than a
    // negative-scale transform on the whole canvas.
    if (ctx.facing < 0) {
      this.ctx.translate(cxLogical, 0);
      this.ctx.scale(-1, 1);
      this.ctx.translate(-cxLogical, 0);
    }

    const rect = this.atlas.rect(frame);
    if (rect) {
      this.ctx.drawImage(
        this.atlas.canvas,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        CAT_ANCHOR.x + ctx.position.x,
        CAT_ANCHOR.y,
        CAT_W,
        CAT_H,
      );
    }

    // Eye layer works in logical pixels, so undo the CSS-pixel scaling and the
    // flip, then place it in art coordinates.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.eyes.draw(anchors, scale, CAT_ANCHOR, ctx);

    this.ctx.restore();
  }
}
