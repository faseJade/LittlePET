/**
 * Tiny indexed pixel-art canvas for the art tooling.
 *
 * The runtime (src/sprites) has its own copy of this idea in TypeScript; this
 * version exists so the authoring scripts can emit both the human-readable
 * ASCII source and the PNG previews used to review it.
 *
 * A grid is a flat array of palette *slot characters*. '.' is transparent.
 */

export function makeGrid(w, h, ch = '.') {
  return { w, h, d: new Array(w * h).fill(ch) };
}

export function cloneGrid(g) {
  return { w: g.w, h: g.h, d: g.d.slice() };
}

export function get(g, x, y) {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return '.';
  return g.d[y * g.w + x];
}

/**
 * Writes a pixel.
 * By default it only paints onto empty pixels, so shapes layer predictably.
 * Pass `over` for detail that must sit on top of an already-painted shape -
 * eyes, markings, whiskers. Getting this wrong hides detail under the body.
 */
export function set(g, x, y, ch, over = false) {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
  const i = y * g.w + x;
  if (over || g.d[i] === '.' || ch === '.') g.d[i] = ch;
}

/** Paints unconditionally - used by the shading and outline passes. */
export function put(g, x, y, ch) {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
  g.d[y * g.w + x] = ch;
}

export function ellipse(g, cx, cy, rx, ry, ch, over = false) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(g, x, y, ch, over);
    }
  }
}

/** Rounded triangle given an apex and a base segment; great for ears. */
export function triangle(g, ax, ay, bx, by, cx, cy, ch, over = false) {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;
  const sign = area > 0 ? 1 : -1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d1 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * sign;
      const d2 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) * sign;
      const d3 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) * sign;
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) set(g, x, y, ch, over);
    }
  }
}

/**
 * Thick polyline with a per-point radius, sampled from a Catmull-Rom spline.
 * Used for tails and whiskers.
 */
export function curve(g, points, radiusAt, ch, over = false) {
  const pts = sampleSpline(points, 8);
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const r = radiusAt(t);
    ellipse(g, pts[i][0], pts[i][1], r, r, ch, over);
  }
}

export function sampleSpline(control, perSeg) {
  const out = [];
  const p = [control[0], ...control, control[control.length - 1]];
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(control[control.length - 1]);
  return out;
}

/**
 * Bresenham line. Endpoints are snapped to integers first: with fractional
 * coordinates the error term overshoots x1 without ever matching it, and the
 * loop spins forever. The step budget is a second belt-and-braces guard.
 */
export function line(g, x0, y0, x1, y1, ch, over = false) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  const maxSteps = dx + dy + 2;
  for (let i = 0; i <= maxSteps; i++) {
    set(g, x, y, ch, over);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Derive a 1px outline: every empty 4-neighbour of a painted pixel becomes 'K'.
 * Doing this from a silhouette keeps the line weight identical on every shape,
 * which is most of what makes pixel art read as a single hand.
 */
export function outline(g, ch = 'K') {
  const out = cloneGrid(g);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (get(g, x, y) !== '.') continue;
      const n =
        get(g, x, y - 1) !== '.' ||
        get(g, x, y + 1) !== '.' ||
        get(g, x - 1, y) !== '.' ||
        get(g, x + 1, y) !== '.';
      if (n) put(out, x, y, ch);
    }
  }
  return out;
}

/** Repaint existing body pixels to `ch` where the predicate passes. */
export function shadeWhere(g, test, ch) {
  const out = cloneGrid(g);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const cur = get(g, x, y);
      if (cur === '.' || cur === 'K' || cur === 'E' || cur === 'e') continue;
      if (test(x, y, cur)) put(out, x, y, ch);
    }
  }
  return out;
}

/** Shift the whole silhouette, used for head bob and squash. */
export function offset(g, dx, dy, fill = '.') {
  const out = makeGrid(g.w, g.h, fill);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const c = get(g, x, y);
      if (c !== '.') put(out, x + dx, y + dy, c);
    }
  }
  return out;
}

export function toRows(g) {
  const rows = [];
  for (let y = 0; y < g.h; y++) rows.push(g.d.slice(y * g.w, (y + 1) * g.w).join(''));
  return rows;
}

export function fromRows(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const g = makeGrid(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g.d[y * g.w + x] = rows[y][x] ?? '.';
  }
  return g;
}

/**
 * Paint a grid into an RGBA buffer at `scale`, compositing over a checkerboard
 * so transparency is visible in review sheets.
 */
export function paint(rgba, W, H, g, ox, oy, scale, palette, checker = true) {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const c = g.d[y * g.w + x];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = ox + x * scale + sx;
          const py = oy + y * scale + sy;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const i = (py * W + px) * 4;
          if (c === '.') {
            if (checker) {
              const v = ((px >> 3) + (py >> 3)) & 1 ? 60 : 40;
              rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
              rgba[i + 3] = 255;
            }
            continue;
          }
          const col = palette[c];
          if (!col) continue;
          rgba[i] = col[0];
          rgba[i + 1] = col[1];
          rgba[i + 2] = col[2];
          rgba[i + 3] = 255;
        }
      }
    }
  }
}
