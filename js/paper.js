// Finds a sheet of paper in a photo, to use as a ruler when the whole body isn't in frame.
// The sheet is folded in half (so it sits well inside the waist and doesn't merge with a
// white wall behind) and tucked into the waistband. It may curve around the body sideways;
// its vertical edge stays straight, so that is the dimension used for scale.

/** Folded-in-half sizes, in cm. */
export const PAPER_SIZES = {
  A4: { long: 21.0, short: 14.85 },
  Letter: { long: 21.59, short: 13.97 },
};

/**
 * @param {Uint8ClampedArray} rgba  RGBA pixels (ImageData.data)
 * @param {number} width            image width
 * @param {{x0: number, y0: number, x1: number, y1: number}} region  where to look, image px
 * @param {'A4'|'Letter'} kind
 * @returns {null | {cmPerPx: number, verticalPx: number, horizontalPx: number,
 *                   centerY: number, box: {x0: number, y0: number, x1: number, y1: number}}}
 */
export function findPaper(rgba, width, region, kind = 'A4') {
  const size = PAPER_SIZES[kind];
  const x0 = Math.max(0, Math.floor(region.x0));
  const y0 = Math.max(0, Math.floor(region.y0));
  const x1 = Math.min(width, Math.ceil(region.x1));
  const y1 = Math.min(rgba.length / 4 / width, Math.ceil(region.y1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  // Paper is the brightest neutral thing near the waist. "Whiteness" is the darkest channel,
  // which stays high only for bright, unsaturated pixels.
  const whiteness = new Uint8Array(w * h);
  const neutral = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * width + x + x0) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const lo = Math.min(r, g, b);
      whiteness[y * w + x] = lo;
      neutral[y * w + x] = Math.max(r, g, b) - lo <= 45 ? 1 : 0;
    }
  }
  const sorted = Float64Array.from(whiteness).sort();
  const threshold = Math.max(110, 0.8 * sorted[Math.floor(0.995 * (sorted.length - 1))]);
  const candidate = new Uint8Array(w * h);
  for (let i = 0; i < candidate.length; i++) candidate[i] = neutral[i] && whiteness[i] >= threshold ? 1 : 0;

  let best = null;
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let start = 0; start < candidate.length; start++) {
    if (!candidate[start] || label[start]) continue;
    // Flood fill one connected patch.
    const pixels = [];
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    while (top) {
      const i = stack[--top];
      pixels.push(i);
      const px = i % w;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= candidate.length) continue;
        if ((j === i - 1 && px === 0) || (j === i + 1 && px === w - 1)) continue;
        if (candidate[j] && !label[j]) {
          label[j] = next;
          stack[top++] = j;
        }
      }
    }
    next++;
    if (pixels.length < 300) continue;

    const rect = minAreaRect(pixels.map((i) => [i % w, Math.floor(i / w)]));
    // The patch must fill its bounding rectangle, like a sheet of paper does.
    if (pixels.length / (rect.vertical * rect.horizontal) < 0.85) continue;
    const portrait = rect.vertical > rect.horizontal;
    const expectedVertical = portrait ? size.long : size.short;
    const expectedHorizontal = portrait ? size.short : size.long;
    // Sideways the sheet may curve around the body and look narrower, never wider.
    const ratio = rect.horizontal / rect.vertical / (expectedHorizontal / expectedVertical);
    if (ratio < 0.82 || ratio > 1.05) continue;
    if (!best || pixels.length > best.area) {
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, sy = 0;
      for (const i of pixels) {
        const px = i % w, py = Math.floor(i / w);
        bx0 = Math.min(bx0, px); bx1 = Math.max(bx1, px);
        by0 = Math.min(by0, py); by1 = Math.max(by1, py);
        sy += py;
      }
      best = {
        area: pixels.length,
        cmPerPx: expectedVertical / rect.vertical,
        verticalPx: rect.vertical,
        horizontalPx: rect.horizontal,
        centerY: y0 + sy / pixels.length + 0.5,
        box: { x0: x0 + bx0, y0: y0 + by0, x1: x0 + bx1 + 1, y1: y0 + by1 + 1 },
      };
    }
  }
  if (!best) return null;
  const { area, ...paper } = best;
  return paper;
}

/**
 * Smallest rectangle around pixel centres, by trying each convex hull edge direction.
 * Returns its sides in pixel units, labelled by which is nearer vertical.
 */
function minAreaRect(points) {
  const hull = convexHull(points);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [px, py] of hull) {
      const u = px * ux + py * uy;
      const v = -px * uy + py * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    // +1: pixel centres sit half a pixel inside the true edges.
    const along = maxU - minU + 1;
    const across = maxV - minV + 1;
    if (!best || along * across < best.area) {
      const edgeIsVertical = Math.abs(uy) > Math.abs(ux);
      best = { area: along * across, vertical: edgeIsVertical ? along : across, horizontal: edgeIsVertical ? across : along };
    }
  }
  return best;
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
