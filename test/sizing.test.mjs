import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeFromMeasurements, sisterSizes, braSize, recommend } from '../js/sizing.js';

const inch = 2.54;

test('modern UK method', () => {
  // 30.5" underbust, 36" bust -> 30 band, 6" difference -> E.
  const s = sizeFromMeasurements(30.5 * inch, 36 * inch);
  assert.equal(s.uk, '30E');
  assert.equal(s.us, '30DDD');
  assert.equal(s.eu, '65F');
});

test('small and equal measurements', () => {
  assert.equal(sizeFromMeasurements(34 * inch, 34 * inch).uk, '34AA');
  assert.equal(sizeFromMeasurements(32 * inch, 35 * inch).uk, '32C');
});

test('sister sizes', () => {
  assert.deepEqual(sisterSizes(braSize(32, 6)).map((s) => s.uk), ['30F', '34DD']);
});

test('calibration is applied before sizing', () => {
  const r = recommend({ underbustCm: 78.7, bustCm: 91.7, projectionCm: 6 });
  assert.ok(Math.abs(r.underbustCm - 77.2) < 1e-9);
  assert.equal(r.size.uk, '30E');
});
