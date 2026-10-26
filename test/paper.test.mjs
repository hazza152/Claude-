import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPaper } from '../js/paper.js';

/** A noisy beige scene with a skin-coloured body and a white sheet drawn on it. */
function scene({ width = 900, height = 700, sheet, angleDeg = 0, curve = 1, color = [245, 244, 240] }) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 16;
  const a = (angleDeg * Math.PI) / 180;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Background, then a torso-coloured block in the middle.
      let c = x > 250 && x < 650 ? [205, 160, 140] : [190, 175, 150];
      if (sheet) {
        const dx = x - sheet.cx, dy = y - sheet.cy;
        const u = dx * Math.cos(a) + dy * Math.sin(a);
        const v = -dx * Math.sin(a) + dy * Math.cos(a);
        if (Math.abs(u) <= (sheet.w * curve) / 2 && Math.abs(v) <= sheet.h / 2) c = color;
      }
      rgba[i] = c[0] + noise();
      rgba[i + 1] = c[1] + noise();
      rgba[i + 2] = c[2] + noise();
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width };
}

const everywhere = { x0: 0, y0: 0, x1: 900, y1: 700 };

test('finds a folded A4 sheet, landscape, and its scale', () => {
  // 210 x 148.5 px: exactly 0.1 cm per pixel.
  const { rgba, width } = scene({ sheet: { cx: 450, cy: 400, w: 210, h: 148.5 } });
  const p = findPaper(rgba, width, everywhere, 'A4');
  assert.ok(p, 'paper found');
  assert.ok(Math.abs(p.cmPerPx - 0.1) < 0.001, `cm/px ${p.cmPerPx}`);
  assert.ok(Math.abs(p.centerY - 400) < 1.5, `centre ${p.centerY}`);
});

test('handles a slightly tilted sheet', () => {
  const { rgba, width } = scene({ sheet: { cx: 450, cy: 400, w: 210, h: 148.5 }, angleDeg: 6 });
  const p = findPaper(rgba, width, everywhere, 'A4');
  assert.ok(p && Math.abs(p.cmPerPx - 0.1) < 0.0015, `cm/px ${p?.cmPerPx}`);
});

test('uses the vertical edge when the sheet curves around the body', () => {
  const { rgba, width } = scene({ sheet: { cx: 450, cy: 400, w: 210, h: 148.5 }, curve: 0.88 });
  const p = findPaper(rgba, width, everywhere, 'A4');
  assert.ok(p && Math.abs(p.cmPerPx - 0.1) < 0.001, `cm/px ${p?.cmPerPx}`);
});

test('ignores white things that are not sheet-shaped', () => {
  const { rgba, width } = scene({ sheet: { cx: 450, cy: 400, w: 150, h: 150 } });
  assert.equal(findPaper(rgba, width, everywhere, 'A4'), null);
});

test('only looks inside the region it is given', () => {
  const { rgba, width } = scene({ sheet: { cx: 450, cy: 400, w: 210, h: 148.5 } });
  assert.equal(findPaper(rgba, width, { x0: 0, y0: 0, x1: 900, y1: 250 }, 'A4'), null);
});
