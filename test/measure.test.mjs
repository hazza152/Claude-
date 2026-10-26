import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, renderView } from './synthetic.mjs';
import { figureExtent, torsoRows, toCentimetres, heightAt, measureTorso, rowRuns } from '../js/measure.js';

/** Runs the same steps the app does, on rendered silhouettes of a synthetic body. */
function measureBody(params = {}, { pxPerMetre = 900, sideFacing = 1, statureError = 0 } = {}) {
  const body = makeBody(params);
  const statureCm = body.stature * 100 + statureError;
  const prepared = {};
  for (const view of ['front', 'side']) {
    const r = renderView(body, view, { pxPerMetre });
    if (view === 'side' && sideFacing < 0) mirror(r.mask);
    const figure = figureExtent(r.mask);
    const rows = toCentimetres(torsoRows(r.mask, r.centerX), { figure, centerX: r.centerX, statureCm });
    prepared[view] = { r, figure, rows };
  }
  const { r, figure } = prepared.front;
  const m = measureTorso({
    front: prepared.front.rows,
    side: prepared.side.rows,
    facing: sideFacing,
    shoulderH: heightAt(r.shoulderY, { figure, statureCm }),
    hipH: heightAt(r.hipY, { figure, statureCm }),
  });
  return { m, body, tapeAtApex: body.tapeAt(body.bustHeight) * 100, rib: body.ribPerimeter * 100 };
}

function mirror(mask) {
  for (let r = 0; r < mask.height; r++) mask.data.subarray(r * mask.width, (r + 1) * mask.width).reverse();
}

const bodies = {
  average: {},
  small: { bustProjection: 0.02, breastRadius: 0.06 },
  full: { bustProjection: 0.12, breastRadius: 0.095 },
  broad: { ribHalfWidth: 0.16, ribHalfDepth: 0.115, bustProjection: 0.08, breastRadius: 0.09, breastSpacing: 0.1 },
  petite: { ribHalfWidth: 0.12, ribHalfDepth: 0.085, bustProjection: 0.05, breastRadius: 0.065, breastSpacing: 0.075, stature: 1.55 },
};

for (const [name, params] of Object.entries(bodies)) {
  test(`measures the ${name} body to within 1 cm`, () => {
    const { m, body, tapeAtApex, rib } = measureBody(params);
    assert.ok(Math.abs(m.underbustCm - rib) < 1, `underbust ${m.underbustCm} vs ${rib}`);
    assert.ok(Math.abs(m.bustCm - tapeAtApex) < 1, `bust ${m.bustCm} vs ${tapeAtApex}`);
    assert.ok(Math.abs(m.bustH - body.bustHeight * 100) < 1.5, `bust height ${m.bustH}`);
    assert.ok(m.underbustH < m.bustH);
  });
}

test('works when the person faces left in the side photo', () => {
  const right = measureBody({}, { sideFacing: 1 }).m;
  const left = measureBody({}, { sideFacing: -1 }).m;
  assert.ok(Math.abs(right.bustCm - left.bustCm) < 0.1);
  assert.ok(Math.abs(right.underbustCm - left.underbustCm) < 0.1);
});

test('holds up at lower photo resolution', () => {
  const { m, tapeAtApex, rib } = measureBody({}, { pxPerMetre: 300 });
  assert.ok(Math.abs(m.underbustCm - rib) < 1);
  assert.ok(Math.abs(m.bustCm - tapeAtApex) < 1);
});

test('a wrong height scales every measurement', () => {
  // 5 cm too tall on 165 cm is 3% too big: the reason the height must be accurate.
  const { m, rib } = measureBody({}, { statureError: 5 });
  assert.ok(Math.abs(m.underbustCm / rib - 170 / 165) < 0.005);
});

test('finds sub-pixel edges', () => {
  const row = new Float32Array([0, 0, 0.25, 1, 1, 0.75, 0]);
  const [[a, b]] = rowRuns(row, row.length, 0);
  assert.ok(Math.abs(a - 2.83) < 0.01, `left ${a}`);
  assert.ok(Math.abs(b - 5.83) < 0.01, `right ${b}`);
});
