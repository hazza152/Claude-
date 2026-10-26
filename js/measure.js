// Bust and underbust circumferences from a front and a side photo.
//
// Each photo gives a silhouette (a person-probability mask). The front silhouette gives the
// torso's width at every height, the side silhouette its depth and the shape of the bust in
// profile. The person's real height turns pixels into centimetres. At the bust apex and at
// the fold below it, width and depth are combined into a circumference.
//
// Everything here is plain maths on arrays so it can be tested without a browser.

/**
 * @typedef {{data: Float32Array, width: number, height: number,
 *            toImage: {x0: number, y0: number, sx: number, sy: number}}} Mask
 * A person-probability map (0..1). Mask pixel (mx, my) covers image x0 + mx*sx, y0 + my*sy.
 */

const THRESHOLD = 0.5;

/** Spans where a mask row is "person", with sub-pixel edges, in mask pixel units. */
export function rowRuns(data, width, row) {
  const runs = [];
  const offset = row * width;
  // Sample i sits at position i + 0.5.
  let start = data[offset] >= THRESHOLD ? 0 : null;
  for (let i = 1; i < width; i++) {
    const a = data[offset + i - 1];
    const b = data[offset + i];
    if (a < THRESHOLD && b >= THRESHOLD) {
      start = i - 0.5 + (THRESHOLD - a) / (b - a);
    } else if (a >= THRESHOLD && b < THRESHOLD) {
      runs.push([start, i - 0.5 + (a - THRESHOLD) / (a - b)]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, width]);
  return runs;
}

/** Top of the head and soles of the feet, in image pixels. */
export function figureExtent(mask) {
  const { data, width, height, toImage } = mask;
  const rowMax = new Float32Array(height);
  for (let r = 0; r < height; r++) {
    let m = 0;
    for (let i = r * width, end = i + width; i < end; i++) if (data[i] > m) m = data[i];
    rowMax[r] = m;
  }
  const first = rowMax.findIndex((m) => m >= THRESHOLD);
  if (first < 0) return null;
  let last = height - 1;
  while (rowMax[last] < THRESHOLD) last--;
  // Interpolate where the row maximum crosses the threshold, as for horizontal edges.
  const top = first === 0 ? 0 : first - 0.5 + (THRESHOLD - rowMax[first - 1]) / (rowMax[first] - rowMax[first - 1]);
  const bottom = last === height - 1 ? height : last + 0.5 + (rowMax[last] - THRESHOLD) / (rowMax[last] - rowMax[last + 1]);
  return { headTopY: toImage.y0 + top * toImage.sy, floorY: toImage.y0 + bottom * toImage.sy };
}

/**
 * The torso's left and right edges in every mask row, in image pixels. Where the arms are
 * separate from the body, the span containing the body's centre line is the torso.
 */
export function torsoRows(mask, centerX) {
  const { data, width, height, toImage: { x0, y0, sx, sy } } = mask;
  const cx = (centerX - x0) / sx;
  const rows = [];
  for (let r = 0; r < height; r++) {
    const runs = rowRuns(data, width, r);
    let best = null;
    let bestDistance = Infinity;
    for (const run of runs) {
      const d = cx < run[0] ? run[0] - cx : cx > run[1] ? cx - run[1] : 0;
      if (d < bestDistance) {
        bestDistance = d;
        best = run;
      }
    }
    if (best) rows.push({ y: y0 + (r + 0.5) * sy, left: x0 + best[0] * sx, right: x0 + best[1] * sx });
  }
  return rows;
}

/** Converts image-pixel rows to centimetres: h above the floor, left/right from the centre line. */
export function toCentimetres(rows, { figure, centerX, statureCm }) {
  const cmPerPx = statureCm / (figure.floorY - figure.headTopY);
  return rows.map((r) => ({
    h: (figure.floorY - r.y) * cmPerPx,
    left: (r.left - centerX) * cmPerPx,
    right: (r.right - centerX) * cmPerPx,
    armTouching: Boolean(r.armTouching),
  }));
}

/** Image row to height above the floor in cm. */
export function heightAt(y, { figure, statureCm }) {
  return ((figure.floorY - y) * statureCm) / (figure.floorY - figure.headTopY);
}

/** Ramanujan's approximation. */
export function ellipsePerimeter(a, b) {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

export const DEFAULT_OPTIONS = {
  stepCm: 0.5,
  // Where the bust apex can be, as fractions of the way down from shoulders to hips.
  bustWindow: [0.15, 0.6],
  // Furthest the fold can sit below the apex.
  maxFoldDropCm: 16,
  // Below the fold the front of the body is near vertical; on the underside of the breast
  // it recedes fast. This is the change-in-depth-per-height boundary between the two.
  foldSlope: 0.3,
  circumference: null, // defaults to CIRCUMFERENCE_MODEL
};

/**
 * Tape circumference from silhouette width and depth: an ellipse through them, scaled by
 * a factor because real torso cross-sections are boxier than ellipses.
 *
 * Fitted to the 1,986 women of the ANSUR II survey (US Army, 2012), who were measured with
 * a tape and with calipers at the same level. Refit with calibration/fit_ansur.py.
 */
export const CIRCUMFERENCE_MODEL = {
  // Bust: tape over the bust points vs chest breadth and depth there. The deeper the chest
  // is relative to its width, the further the tape departs from an ellipse.
  // Typical error 1.7 cm (mean absolute, cross-validated).
  bust: { base: 1.0096, perDepthRatio: 0.1695 },
  // ANSUR II has no underbust measurement. The waist, also soft tissue over the trunk, is
  // the nearest section measured both ways (typical error 1.4 cm). Refit this one first
  // when real underbust data is available.
  underbust: { base: 1.061, perDepthRatio: 0 },
};

/**
 * Chest width predicted from bust depth and height, for when the arms hide the sides of the
 * chest. Fitted to ANSUR II women: typically within 1.1 cm, which makes the bust
 * circumference typically within 2.1 cm instead of 1.7 cm. Also used for the underbust,
 * where ribcage width is close to chest width at the bust.
 */
export function predictedChestWidth(bustDepthCm, statureCm) {
  return 6.95 + 0.4172 * bustDepthCm + 0.0593 * statureCm;
}

export function tapeCircumference(width, depth, factor) {
  return (factor.base + (factor.perDepthRatio * depth) / width) * ellipsePerimeter(width / 2, depth / 2);
}

/**
 * @param {object} input
 * @param {{h: number, left: number, right: number}[]} input.front  front-view rows (cm)
 * @param {{h: number, left: number, right: number}[]} input.side   side-view rows (cm)
 * @param {1|-1} input.facing  +1 if the person faces right in the side photo, -1 if left
 * @param {number} input.shoulderH  shoulder height above the floor (cm)
 * @param {number} input.hipH       hip height above the floor (cm)
 * @param {number} [input.statureCm] standing height, to estimate chest width if arms hide it
 */
export function measureTorso(input, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const model = o.circumference ?? CIRCUMFERENCE_MODEL;
  const { front, side, facing, shoulderH, hipH } = input;
  const torso = shoulderH - hipH;
  if (!(torso > 20)) throw new MeasureError('pose', 'Could not find shoulders and hips.');

  const widthAt = interpolator(front, (r) => r.right - r.left);
  // "Forward" position of the front and back of the body in the side view.
  const frontAt = interpolator(side, (r) => (facing > 0 ? r.right : -r.left));
  const backAt = interpolator(side, (r) => (facing > 0 ? r.left : -r.right));

  const heights = [];
  for (let h = hipH; h <= shoulderH; h += o.stepCm) heights.push(h);
  const width = smooth(heights.map(widthAt));
  const anterior = smooth(heights.map(frontAt));
  const posterior = smooth(heights.map(backAt));
  if ([...width, ...anterior, ...posterior].some((v) => !Number.isFinite(v))) {
    throw new MeasureError('coverage', 'The torso is not fully visible in both photos.');
  }
  const depth = anterior.map((a, i) => a - posterior[i]);
  const perimeter = width.map((w, i) => ellipsePerimeter(w / 2, depth[i] / 2));

  // Apex: the furthest-forward point of the chest in profile.
  const lo = shoulderH - o.bustWindow[1] * torso;
  const hi = shoulderH - o.bustWindow[0] * torso;
  let bust = -1;
  heights.forEach((h, i) => {
    if (h >= lo && h <= hi && (bust < 0 || anterior[i] > anterior[bust])) bust = i;
  });
  if (bust < 0) throw new MeasureError('bust', 'Could not find the bust line.');

  let underbust = foldIndex(bust, heights, anterior, o);
  const method = underbust === null ? 'minimum' : 'fold';
  if (underbust === null) {
    // No clear fold (e.g. a small bust): use the narrowest point 4-14 cm below the apex.
    heights.forEach((h, i) => {
      const drop = heights[bust] - h;
      if (drop >= 4 && drop <= 14 && (underbust === null || perimeter[i] < perimeter[underbust])) underbust = i;
    });
  }
  if (underbust === null) throw new MeasureError('bust', 'Could not find the underbust line.');

  // The front photo's width is only trustworthy where the arms are clear of the body. Where
  // they aren't, use a clear row close by, or failing that predict the width.
  const armAt = (h) => front.some((r) => r.armTouching && Math.abs(r.h - h) <= 1.5);
  const widthFor = (i, searchCm) => {
    if (!armAt(heights[i])) return { width: width[i], source: 'measured' };
    let best = null;
    heights.forEach((h, j) => {
      const gap = Math.abs(h - heights[i]);
      if (gap <= searchCm && !armAt(h) && (best === null || gap < Math.abs(heights[best] - heights[i]))) best = j;
    });
    if (best !== null) return { width: width[best], source: 'nearby' };
    if (!input.statureCm) {
      throw new MeasureError('arms', 'Your arms were covering the sides of your chest in the front photo.');
    }
    return { width: predictedChestWidth(depth[bust], input.statureCm), source: 'estimated' };
  };
  const bustWidth = widthFor(bust, 3);
  const underbustWidth = widthFor(underbust, 5);

  return {
    underbustCm: tapeCircumference(underbustWidth.width, depth[underbust], model.underbust),
    bustCm: tapeCircumference(bustWidth.width, depth[bust], model.bust),
    projectionCm: anterior[bust] - anterior[underbust],
    underbustH: heights[underbust],
    bustH: heights[bust],
    underbust: { width: underbustWidth.width, widthSource: underbustWidth.source, depth: depth[underbust] },
    bust: { width: bustWidth.width, widthSource: bustWidth.source, depth: depth[bust] },
    method,
  };
}

export class MeasureError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * The fold under the bust. Walking down from the apex, it's where the front of the body
 * stops receding and stays that way for at least 2 cm. As a check against blur or a bumpy
 * outline faking a stop halfway down the breast, the fold must also be close to the most
 * receded point below the bust; if it isn't, that point is used instead.
 */
function foldIndex(bust, heights, anterior, o) {
  const below = (i) => heights[bust] - heights[i];
  let deepest = null;
  for (let i = bust; i >= 0 && below(i) <= o.maxFoldDropCm; i--) {
    if (deepest === null || anterior[i] < anterior[deepest]) deepest = i;
  }
  const drop = deepest === null ? 0 : anterior[bust] - anterior[deepest];
  // Less than 1 cm of bust in front of the ribs: no clear fold to find.
  if (drop < 1) return null;
  const nearDeepest = (i) => anterior[i] <= anterior[deepest] + Math.max(0.5, 0.25 * drop);

  const span = Math.round(2 / o.stepCm);
  let leftBreast = false;
  for (let i = bust; i - span >= 0 && below(i - span) <= o.maxFoldDropCm; i--) {
    const slope = (anterior[i] - anterior[i - 1]) / (heights[i] - heights[i - 1]);
    if (slope > o.foldSlope) {
      leftBreast = true;
      continue;
    }
    const staysFlat = (anterior[i] - anterior[i - span]) / (heights[i] - heights[i - span]) <= o.foldSlope;
    if (leftBreast && staysFlat && nearDeepest(i)) return i;
  }
  for (let i = bust; i >= deepest; i--) if (nearDeepest(i)) return i;
  return deepest;
}

/** Linear interpolation of value(row) over rows' heights. NaN outside the covered range. */
function interpolator(rows, value) {
  const pts = rows.map((r) => [r.h, value(r)]).sort((a, b) => a[0] - b[0]);
  return (h) => {
    if (!pts.length || h < pts[0][0] || h > pts[pts.length - 1][0]) return NaN;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][0] <= h) lo = mid;
      else hi = mid;
    }
    const [h0, v0] = pts[lo];
    const [h1, v1] = pts[hi];
    return h1 === h0 ? v0 : v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  };
}

function smooth(values) {
  return values.map((_, i) => {
    const lo = Math.max(0, i - 2);
    const hi = Math.min(values.length - 1, i + 2);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    return sum / (hi - lo + 1);
  });
}
