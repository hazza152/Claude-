// A simple 3D standing body, its true tape-measure circumferences, and rendered front and
// side silhouette masks (with soft edges, like a segmentation model's output).

export function makeBody({
  stature = 1.65,
  ribHalfWidth = 0.135,
  ribHalfDepth = 0.095,
  bustProjection = 0.06,
  breastRadius = 0.075,
  breastSpacing = 0.085,
} = {}) {
  const bustHeight = 0.715 * stature;
  const torsoBottom = 0.5 * stature;
  const shoulderHeight = 0.82 * stature;

  /** Horizontal cross-section of the torso at height y, as (x, z) points; +z is forward. */
  function section(y) {
    const pts = [];
    for (let step = 0; step < 1440; step++) {
      const t = (step / 4) * (Math.PI / 180);
      const x = ribHalfWidth * Math.cos(t);
      let z = ribHalfDepth * Math.sin(t);
      if (z > 0) {
        for (const cx of [-breastSpacing, breastSpacing]) {
          const d2 = ((x - cx) ** 2 + (y - bustHeight) ** 2) / breastRadius ** 2;
          // Breast offset fades out towards the sides so the surface stays continuous.
          if (d2 < 1) z = Math.max(z, (ribHalfDepth + bustProjection * Math.sqrt(1 - d2)) * Math.sin(t));
        }
      }
      pts.push([x, z]);
    }
    return pts;
  }

  return {
    stature,
    bustHeight,
    torsoBottom,
    shoulderHeight,
    hipHeight: 0.53 * stature,
    section,
    /** What a tape measure reads at height y: the convex hull perimeter of the section. */
    tapeAt: (y) => hullPerimeter(section(y)),
    ribPerimeter: ellipse(ribHalfWidth, ribHalfDepth),
    /** Spans of body (in metres, horizontal) at height y, for a front or side view. */
    spans(y, view) {
      const out = [];
      if (y >= torsoBottom && y <= shoulderHeight) {
        const s = section(y);
        const k = view === 'front' ? 0 : 1;
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of s) {
          lo = Math.min(lo, p[k]);
          hi = Math.max(hi, p[k]);
        }
        out.push([lo, hi]);
        // Arms: held out at 45° in the front photo, hanging at the sides in the side photo.
        if (view === 'front') {
          const drop = shoulderHeight - y;
          const offset = ribHalfWidth + 0.01 + drop * 0.7;
          out.push([-offset - 0.08, -offset], [offset, offset + 0.08]);
        } else {
          out.push([-0.04, 0.04]);
        }
      } else if (y < torsoBottom) {
        out.push(view === 'front' ? [-0.15, -0.02] : [-0.07, 0.07]);
        if (view === 'front') out.push([0.02, 0.15]);
      } else {
        // Neck and head.
        const top = stature - y;
        const half = top < 0.12 ? Math.sqrt(Math.max(0, 1 - ((0.12 - top) / 0.12) ** 2)) * 0.08 : 0.06;
        if (half > 0) out.push([-half, half]);
      }
      return out;
    },
  };
}

/**
 * Renders the body as a person-probability mask. Edges are anti-aliased by area coverage.
 * Returns the mask plus the "landmarks" the app would get from pose detection.
 */
export function renderView(body, view, { pxPerMetre = 900, margin = 0.1 } = {}) {
  const halfWidth = 0.55;
  const width = Math.round(2 * halfWidth * pxPerMetre);
  const height = Math.round((body.stature + 2 * margin) * pxPerMetre);
  const data = new Float32Array(width * height);
  const floorY = Math.round((body.stature + margin) * pxPerMetre);
  const centerX = width / 2;
  const sub = 4;
  for (let r = 0; r < height; r++) {
    for (let s = 0; s < sub; s++) {
      const y = (floorY - (r + (s + 0.5) / sub)) / pxPerMetre;
      if (y < 0 || y > body.stature) continue;
      for (const [a, b] of body.spans(y, view)) {
        const pa = centerX + a * pxPerMetre;
        const pb = centerX + b * pxPerMetre;
        for (let c = Math.max(0, Math.floor(pa)); c < Math.min(width, Math.ceil(pb)); c++) {
          const cover = Math.min(c + 1, pb) - Math.max(c, pa);
          data[r * width + c] += cover / sub;
        }
      }
    }
  }
  const toImageY = (h) => floorY - h * pxPerMetre;
  return {
    mask: { data, width, height, toImage: { x0: 0, y0: 0, sx: 1, sy: 1 } },
    centerX,
    shoulderY: toImageY(body.shoulderHeight),
    hipY: toImageY(body.hipHeight),
  };
}

export function hullPerimeter(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let total = 0;
  for (let i = 0; i < hull.length; i++) total += Math.hypot(...hull[(i + 1) % hull.length].map((v, k) => v - hull[i][k]));
  return total;
}

function ellipse(a, b) {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}
