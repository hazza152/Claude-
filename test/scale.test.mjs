import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, renderView } from './synthetic.mjs';
import { torsoRows, measureTorso } from '../js/measure.js';
import { combineViews, midPlaneScale } from '../js/scale.js';

const PX_PER_M = 900;
const TRUE_CM_PER_PX = 100 / PX_PER_M;

/**
 * Builds a view as the app would, but with the scale a sheet of paper would give: the sheet
 * sits `offsetCm` nearer a camera `distanceCm` from the body's mid-plane, so it looks bigger.
 */
function paperView(body, view, { offsetCm, distanceCm, focalError = 1 }) {
  const r = renderView(body, view, { pxPerMetre: PX_PER_M });
  const toPaper = distanceCm - offsetCm;
  const paperCmPerPx = (TRUE_CM_PER_PX * toPaper) / distanceCm;
  const focalPx = (toPaper / paperCmPerPx) * focalError;
  return {
    outline: torsoRows(r.mask, r.centerX),
    centerX: r.centerX,
    shoulderY: r.shoulderY,
    hipY: r.hipY,
    facing: 1,
    scale: { mode: 'paper', cmPerPx: paperCmPerPx, paperY: r.hipY - 0.12 * PX_PER_M, focalPx },
  };
}

function truthAt(body, hCm) {
  const s = body.section(hCm / 100);
  const span = (k) => (Math.max(...s.map((p) => p[k])) - Math.min(...s.map((p) => p[k]))) * 100;
  return { width: span(0), depth: span(1) };
}

test('paper scale is corrected to the body mid-plane', () => {
  const body = makeBody();
  // At the paper's height the synthetic torso is 27 cm wide and 19 cm deep.
  const front = paperView(body, 'front', { offsetCm: 9.5, distanceCm: 180 });
  const side = paperView(body, 'side', { offsetCm: 13.5, distanceCm: 180 });
  const c = combineViews(front, side);
  assert.ok(Math.abs(c.scales.front / TRUE_CM_PER_PX - 1) < 0.003, `front scale ${c.scales.front}`);
  assert.ok(Math.abs(c.scales.side / TRUE_CM_PER_PX - 1) < 0.003, `side scale ${c.scales.side}`);

  const m = measureTorso(c);
  // Heights are relative to the shoulders here, so convert back for the truth lookup.
  const shoulderCm = body.shoulderHeight * 100;
  for (const line of ['bust', 'underbust']) {
    const truth = truthAt(body, shoulderCm + m[`${line}H`]);
    assert.ok(Math.abs(m[line].width - truth.width) < 0.4, `${line} width ${m[line].width} vs ${truth.width}`);
    assert.ok(Math.abs(m[line].depth - truth.depth) < 0.4, `${line} depth ${m[line].depth} vs ${truth.depth}`);
  }
});

test('a phone with a different lens than assumed only costs a little', () => {
  const body = makeBody();
  for (const focalError of [0.8, 1.2]) {
    const c = combineViews(
      paperView(body, 'front', { offsetCm: 9.5, distanceCm: 180, focalError }),
      paperView(body, 'side', { offsetCm: 13.5, distanceCm: 180, focalError }),
    );
    assert.ok(Math.abs(c.scales.front / TRUE_CM_PER_PX - 1) < 0.015, `front scale off by ${c.scales.front / TRUE_CM_PER_PX - 1}`);
  }
});

test('mid-plane scale grows with distance behind the paper', () => {
  // Paper 100 cm away (focal 1000 px, 0.1 cm/px); mid-plane 10 cm further: 10% bigger.
  assert.ok(Math.abs(midPlaneScale({ cmPerPx: 0.1, focalPx: 1000 }, 10) - 0.11) < 1e-12);
});

test('height-scaled views are measured from the floor', () => {
  const body = makeBody();
  const view = (name) => {
    const r = renderView(body, name, { pxPerMetre: PX_PER_M });
    const floorY = r.hipY + body.hipHeight * PX_PER_M;
    return { outline: torsoRows(r.mask, r.centerX), centerX: r.centerX, shoulderY: r.shoulderY, hipY: r.hipY, facing: 1,
      scale: { mode: 'height', cmPerPx: TRUE_CM_PER_PX, floorY } };
  };
  const c = combineViews(view('front'), view('side'));
  assert.ok(Math.abs(c.shoulderH - body.shoulderHeight * 100) < 0.01);
  const m = measureTorso(c);
  assert.ok(Math.abs(m.bustH - body.bustHeight * 100) < 1.5, `bust height ${m.bustH}`);
});
