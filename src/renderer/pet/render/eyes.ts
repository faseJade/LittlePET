import type { EyeAnchor, RGB } from '../../../shared/types';
import type { ExpressionName } from '../behavior';
import type { Context } from '../context';

/**
 * The eye layer (PLAN.md 6.3).
 *
 * Nothing here is a sprite. Pupils, lids and expression glyphs are drawn
 * procedurally at the anchors each frame declares, which is why blinking and eye
 * follow cost the same whether the cat is sitting, walking or hanging from your
 * cursor.
 *
 * All coordinates are in art-grid cells. The caller scales, so a socket is always
 * an integer number of device pixels wide and the eyes stay as crisp as the body.
 */

/**
 * Pupil radius as a fraction of the socket.
 *
 * Below about 0.5 there is no visible white left on the far side of the pupil, and
 * the eye stops reading as a pupil in a socket; above 0.7 it stops reading as
 * moving. The rest of the radius is the travel budget.
 */
const PUPIL_RADIUS = 0.55;

function clampAbs(v: number, max: number): number {
  return v < -max ? -max : v > max ? max : v;
}

export class EyeLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly color: { eye: string; shine: string; sclera: string };

  constructor(ctx: CanvasRenderingContext2D, color: { eye: RGB; shine: RGB; sclera?: RGB }) {
    this.ctx = ctx;
    this.color = {
      eye: rgb(color.eye),
      shine: rgb(color.shine),
      sclera: rgb(color.sclera ?? [255, 255, 255]),
    };
  }

  /**
   * @param anchors  Sockets for the frame being drawn, in grid cells.
   * @param scale    Device pixels per grid cell.
   * @param origin   Frame's top-left in device pixels.
   * @param ctx      Live context, for the eased pupil offset, blink and expression.
   */
  draw(
    anchors: readonly EyeAnchor[],
    scale: number,
    origin: { x: number; y: number },
    ctx: Context,
  ): void {
    if (anchors.length === 0) return;

    // Asleep eyes are always shut, and expressions replace the pupils entirely.
    if (ctx.asleep) {
      this.drawClosed(anchors, scale, origin);
      return;
    }

    const expression = ctx.expression;
    if (expression !== 'neutral') {
      this.drawExpression(anchors, scale, origin, expression);
      return;
    }

    // Blink closes the lid from the top, so the pupil shrinks in height only.
    const lid = ctx.blink;

    for (const a of anchors) {
      const r = a.r * scale;
      const cx = origin.x + a.x * scale;
      const cy = origin.y + a.y * scale;

      // The socket is the frame the pupil lives in, so the travel is capped by the
      // socket itself rather than by a global constant: a bigger eye in a future
      // sprite gets proportionally more movement without a new threshold.
      const travel = r - PUPIL_RADIUS * r;
      const dx = clampAbs(ctx.pupil.x, 1) * travel;
      const dy = clampAbs(ctx.pupil.y, 1) * travel;

      // Sclera. Drawn every frame because the pupil is not a sprite: there is no
      // cheaper way to get a moving pupil out of a static atlas.
      this.ctx.fillStyle = this.color.sclera;
      this.pixelEllipse(cx, cy, r, r * (1 - lid));

      const openH = PUPIL_RADIUS * r * 2 * (1 - lid);
      if (openH < 1) continue;
      const px = cx + dx;
      const py = cy + dy;
      this.ctx.fillStyle = this.color.eye;
      this.pixelEllipse(px, py, PUPIL_RADIUS * r, openH / 2);

      // The shine sits opposite the travel direction, so it reads as a wet highlight
      // catching the light rather than as a sticker on the iris.
      if (lid < 0.5) {
        this.ctx.fillStyle = this.color.shine;
        const s = Math.max(1, Math.round(r * 0.45));
        this.ctx.fillRect(
          Math.round(px - dx * 0.8 - s / 2),
          Math.round(py - openH / 2 + openH * 0.25 - s / 2),
          s,
          s,
        );
      }
    }

    // Fully closed lids read better as a line than as two vanished pupils.
    if (lid > 0.92) this.drawClosed(anchors, scale, origin);
  }

  /** A single horizontal lid line per eye. */
  private drawClosed(
    anchors: readonly EyeAnchor[],
    scale: number,
    origin: { x: number; y: number },
  ): void {
    this.ctx.fillStyle = this.color.eye;
    for (const a of anchors) {
      const cx = origin.x + a.x * scale;
      const cy = origin.y + a.y * scale;
      const w = Math.max(1, Math.round(a.r * scale * 2));
      this.ctx.fillRect(Math.round(cx - w / 2), Math.round(cy), w, Math.max(1, Math.round(scale)));
    }
  }

  /**
   * Expressions replace the pupils with glyphs. Deliberately blocky and 2-3px
   * thick: at 3x scale anything thinner turns to noise.
   */
  private drawExpression(
    anchors: readonly EyeAnchor[],
    scale: number,
    origin: { x: number; y: number },
    expression: ExpressionName,
  ): void {
    const px = (n: number) => Math.max(1, Math.round(n * scale));
    this.ctx.fillStyle = this.color.eye;

    for (const a of anchors) {
      const cx = Math.round(origin.x + a.x * scale);
      const cy = Math.round(origin.y + a.y * scale);
      const r = a.r * scale;
      const t = px(1);
      const d = Math.round(r * 1.6);

      switch (expression) {
        case 'happy':
          // Inverted V: two diagonal strokes meeting at the bottom.
          for (let i = 0; i <= d; i++) {
            this.ctx.fillRect(cx - d + i, cy - r + i * 0.5, t, t);
            this.ctx.fillRect(cx + d - i, cy - r + i * 0.5, t, t);
          }
          break;
        case 'sad':
          // Sloped, with the outer end high.
          for (let i = 0; i <= d; i++) {
            this.ctx.fillRect(cx - d + i, cy + r - i * 0.4, t, t);
            this.ctx.fillRect(cx + d - i, cy + r - i * 0.4, t, t);
          }
          break;
        case 'surprised':
          this.pixelEllipse(cx, cy, r * 0.8, r * 0.8);
          break;
        case 'thinking':
          this.ctx.fillRect(cx - d, cy, px(2 * d + 1), t);
          break;
        case 'dead':
          this.ctx.fillRect(cx - d, cy, px(2 * d + 1), t);
          this.ctx.fillRect(cx - d, cy - r, t, px(2 * r + 1));
          this.ctx.fillRect(cx + d, cy - r, t, px(2 * r + 1));
          break;
        case 'sleepy':
          this.drawClosed([a], scale, origin);
          break;
        case 'neutral':
          this.pixelEllipse(cx, cy, r, r);
          break;
      }
    }
  }

  /**
   * Ellipse made of whole pixels. A smooth arc at this size would land on
   * half-pixels and blur, which the rest of the art never does.
   */
  private pixelEllipse(cx: number, cy: number, rx: number, ry: number): void {
    const r = Math.round(rx);
    const h = Math.round(ry);
    if (r <= 0 || h <= 0) return;
    const x0 = Math.round(cx) - r;
    const y0 = Math.round(cy) - h;
    for (let y = -h; y <= h; y++) {
      const nx = 1 - (y * y) / (h * h);
      if (nx <= 0) continue;
      const half = Math.round(r * Math.sqrt(nx));
      if (half <= 0) continue;
      this.ctx.fillRect(x0 - half, y0 + y + h, half * 2 + 1, 1);
    }
  }
}

function rgb(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
