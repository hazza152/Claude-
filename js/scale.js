// Puts the front and side photos on a common centimetre scale.
//
// Each analysed photo carries a scale from one of two sources:
//  - height: the whole body is in frame and the person's height is known. The head and feet
//    are on the body's mid-plane, so the scale applies directly to the torso outline.
//  - paper: a sheet tucked into the waistband. The sheet sits on the body's surface, nearer
//    the camera than the outline edges, so it looks slightly too big; that is corrected
//    using the distance to the camera and how far the surface is from the mid-plane, which
//    the other photo tells us.

/**
 * @typedef {{y: number, left: number, right: number}} ImageRow  torso edges in image px
 * @typedef {object} View
 * @property {ImageRow[]} outline
 * @property {number} centerX, shoulderY, hipY
 * @property {1|-1} facing
 * @property {{mode: 'height', cmPerPx: number, floorY: number} |
 *            {mode: 'paper', cmPerPx: number, paperY: number, focalPx: number}} scale
 */

/**
 * @param {View} front
 * @param {View} side
 * @returns the input for measureTorso, plus yAt(view, hCm) to draw lines on the photos.
 */
export function combineViews(front, side) {
  // Heights come from the floor when both photos show it; otherwise from the shoulder line,
  // which pose detection finds in both.
  const fromFloor = front.scale.mode === 'height' && side.scale.mode === 'height';
  const origin = (v) => (fromFloor ? v.scale.floorY : v.shoulderY);

  let frontCm = front.scale.cmPerPx;
  let sideCm = side.scale.cmPerPx;
  let rows;
  // Each correction depends on the other photo's measurements; two rounds settle it.
  for (let round = 0; round < 3; round++) {
    rows = { front: toCm(front, frontCm, origin(front)), side: toCm(side, sideCm, origin(side)) };
    if (front.scale.mode === 'paper') {
      // Front photo: the sheet is on the stomach, half the body's depth in front of the sides.
      const h = (origin(front) - front.scale.paperY) * frontCm;
      const depth = valueAt(rows.side, h, (r) => r.right - r.left);
      frontCm = midPlaneScale(front.scale, depth / 2);
    }
    if (side.scale.mode === 'paper') {
      // Side photo: the sheet is on the hip, half the body's width nearer than front and back.
      const h = (origin(side) - side.scale.paperY) * sideCm;
      const width = valueAt(rows.front, h, (r) => r.right - r.left);
      sideCm = midPlaneScale(side.scale, width / 2);
    }
  }

  const heightOf = (v, cm) => (y) => (origin(v) - y) * cm;
  return {
    front: rows.front,
    side: rows.side,
    facing: side.facing,
    shoulderH: heightOf(front, frontCm)(front.shoulderY),
    hipH: heightOf(front, frontCm)(front.hipY),
    scales: { front: frontCm, side: sideCm },
    yAt: (view, hCm) => {
      const v = view === 'front' ? front : side;
      return origin(v) - hCm / (view === 'front' ? frontCm : sideCm);
    },
  };
}

/**
 * Scale at the body's mid-plane from the scale at the paper.
 * Distance to paper D = focal length (px) × cm per px. Things `offsetCm` further away look
 * smaller by D / (D + offset), so each pixel there covers (D + offset) / D more.
 */
export function midPlaneScale(paperScale, offsetCm) {
  if (!Number.isFinite(offsetCm)) return paperScale.cmPerPx;
  const distance = paperScale.focalPx * paperScale.cmPerPx;
  return (paperScale.cmPerPx * (distance + offsetCm)) / distance;
}

/**
 * Focal length in pixels, assuming a standard phone camera (about 26 mm full-frame
 * equivalent, i.e. the long side spans ~69°). Only feeds a small perspective correction,
 * so a rough value is enough.
 */
export function assumedFocalPx(width, height) {
  return (Math.max(width, height) * 26) / 36;
}

function toCm(view, cmPerPx, originY) {
  return view.outline.map((r) => ({
    h: (originY - r.y) * cmPerPx,
    left: (r.left - view.centerX) * cmPerPx,
    right: (r.right - view.centerX) * cmPerPx,
  }));
}

/** Value at the row nearest height h (cm), averaged over ±2 cm. NaN if none. */
function valueAt(rows, h, value) {
  const near = rows.filter((r) => Math.abs(r.h - h) <= 2);
  if (!near.length) return NaN;
  return near.reduce((sum, r) => sum + value(r), 0) / near.length;
}
