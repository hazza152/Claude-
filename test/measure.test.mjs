import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, renderView } from './synthetic.mjs';
import { readFileSync } from 'node:fs';
import { figureExtent, torsoRows, toCentimetres, heightAt, measureTorso, rowRuns, tapeCircumference, CIRCUMFERENCE_MODEL } from '../js/measure.js';

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
  return { m, body };
}

/** True width and depth (cm) of the synthetic torso at a height (cm). */
function extents(body, hCm) {
  const s = body.section(hCm / 100);
  const span = (k) => (Math.max(...s.map((p) => p[k])) - Math.min(...s.map((p) => p[k]))) * 100;
  return { width: span(0), depth: span(1) };
}

function assertSilhouette(m, body, tolerance = 0.3) {
  for (const line of ['bust', 'underbust']) {
    const truth = extents(body, m[`${line}H`]);
    assert.ok(Math.abs(m[line].width - truth.width) < tolerance, `${line} width ${m[line].width} vs ${truth.width}`);
    assert.ok(Math.abs(m[line].depth - truth.depth) < tolerance, `${line} depth ${m[line].depth} vs ${truth.depth}`);
  }
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
  test(`reads width and depth of the ${name} body from its silhouettes to within 3 mm`, () => {
    const { m, body } = measureBody(params);
    assertSilhouette(m, body);
    assert.ok(Math.abs(m.bustH - body.bustHeight * 100) < 1.5, `bust height ${m.bustH}`);
    assert.ok(m.underbustH < m.bustH && m.bustH - m.underbustH < 16, `underbust height ${m.underbustH}`);
  });
}

test('works when the person faces left in the side photo', () => {
  const right = measureBody({}, { sideFacing: 1 }).m;
  const left = measureBody({}, { sideFacing: -1 }).m;
  assert.ok(Math.abs(right.bustCm - left.bustCm) < 0.1);
  assert.ok(Math.abs(right.underbustCm - left.underbustCm) < 0.1);
});

test('holds up at lower photo resolution', () => {
  const { m, body } = measureBody({}, { pxPerMetre: 300 });
  assertSilhouette(m, body, 0.5);
});

test('a wrong height scales every measurement', () => {
  // 5 cm too tall on 165 cm is 3% too big: the reason the height must be accurate.
  const exact = measureBody().m;
  const { m } = measureBody({}, { statureError: 5 });
  assert.ok(Math.abs(m.underbustCm / exact.underbustCm - 170 / 165) < 0.005);
});

test('finds sub-pixel edges', () => {
  const row = new Float32Array([0, 0, 0.25, 1, 1, 0.75, 0]);
  const [[a, b]] = rowRuns(row, row.length, 0);
  assert.ok(Math.abs(a - 2.83) < 0.01, `left ${a}`);
  assert.ok(Math.abs(b - 5.83) < 0.01, `right ${b}`);
});

test('circumference model matches tape measurements of real women (ANSUR II sample)', () => {
  const sample = JSON.parse(readFileSync(new URL('./fixtures/ansur-sample.json', import.meta.url)));
  for (const [section, factor, maxMeanError] of [['bust', CIRCUMFERENCE_MODEL.bust, 2.0], ['waist', CIRCUMFERENCE_MODEL.underbust, 1.6]]) {
    const errors = sample[section].map(([w, d, tape]) => tapeCircumference(w, d, factor) - tape);
    const bias = errors.reduce((a, e) => a + e, 0) / errors.length;
    const meanAbs = errors.reduce((a, e) => a + Math.abs(e), 0) / errors.length;
    assert.ok(Math.abs(bias) < 0.5, `${section} bias ${bias}`);
    assert.ok(meanAbs < maxMeanError, `${section} mean error ${meanAbs}`);
  }
});

test('falls back gracefully when arms hide the sides of the chest', () => {
  const body = makeBody();
  const statureCm = body.stature * 100;
  const views = {};
  for (const view of ['front', 'side']) {
    const r = renderView(body, view, { pxPerMetre: 900 });
    const figure = figureExtent(r.mask);
    views[view] = { r, figure, rows: toCentimetres(torsoRows(r.mask, r.centerX), { figure, centerX: r.centerX, statureCm }) };
  }
  const { r, figure } = views.front;
  const input = (touching) => ({
    front: views.front.rows.map((row) => ({ ...row, armTouching: touching(row.h) })),
    side: views.side.rows,
    facing: 1,
    shoulderH: heightAt(r.shoulderY, { figure, statureCm }),
    hipH: heightAt(r.hipY, { figure, statureCm }),
  });
  const bustH = body.bustHeight * 100;
  const clear = measureTorso(input(() => false));
  // Hands on hips: arms touch around the waist, well below the underbust.
  const handsOnHips = measureTorso(input((h) => h < bustH - 25));
  assert.equal(handsOnHips.bust.widthSource, 'measured');
  assert.equal(handsOnHips.underbust.widthSource, 'measured');
  // Arms touching just at the bust: the width comes from a clear row close by.
  const nearby = measureTorso(input((h) => Math.abs(h - bustH) < 1));
  assert.equal(nearby.bust.widthSource, 'nearby');
  assert.ok(Math.abs(nearby.bustCm - clear.bustCm) < 1);
  // Arms down by the sides: the width is predicted from depth and height instead.
  const armsDown = measureTorso({ ...input((h) => h > bustH - 30), statureCm });
  assert.equal(armsDown.bust.widthSource, 'estimated');
  assert.equal(armsDown.underbust.widthSource, 'estimated');
  assert.ok(Number.isFinite(armsDown.bustCm) && Number.isFinite(armsDown.underbustCm));
  // Without a height to predict from, it says what's wrong.
  assert.throws(() => measureTorso(input((h) => h > bustH - 30)), (e) => e.kind === 'arms');
});

test('a bump halfway down the breast is not mistaken for the fold', () => {
  const body = makeBody();
  const statureCm = body.stature * 100;
  const views = {};
  for (const view of ['front', 'side']) {
    const r = renderView(body, view, { pxPerMetre: 900 });
    const figure = figureExtent(r.mask);
    views[view] = { r, figure, rows: toCentimetres(torsoRows(r.mask, r.centerX), { figure, centerX: r.centerX, statureCm }) };
  }
  const bustH = body.bustHeight * 100;
  // Flatten the profile for 2.5 cm partway down the underside of the breast, like blur can.
  // The real fold is lower, where the profile reaches the ribs.
  const nearest = (h) => views.side.rows.reduce((a, b) => (Math.abs(b.h - h) < Math.abs(a.h - h) ? b : a));
  const plateauTop = nearest(bustH - 4.5).right;
  const side = views.side.rows.map((row) =>
    row.h < bustH - 4.5 && row.h > bustH - 7 ? { ...row, right: plateauTop } : row,
  );
  const { r, figure } = views.front;
  const m = measureTorso({
    front: views.front.rows,
    side,
    facing: 1,
    shoulderH: heightAt(r.shoulderY, { figure, statureCm }),
    hipH: heightAt(r.hipY, { figure, statureCm }),
  });
  // The breast in this body ends 7.5 cm below the apex.
  assert.ok(bustH - m.underbustH > 7, `underbust ${(bustH - m.underbustH).toFixed(1)} cm below apex`);
});
