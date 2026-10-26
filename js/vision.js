// Runs the on-device vision models on a photo and prepares the silhouette for measuring.
// Photos never leave the browser: the models are downloaded once and run locally.

import { figureExtent, heightAt, toCentimetres, torsoRows } from './measure.js?v=9';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const SEGMENT_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

// BlazePose landmark indices.
const NOSE = 0;
const L_EYE = 2;
const R_EYE = 5;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;
const L_KNEE = 25;
const R_KNEE = 26;
const L_ANKLE = 27;
const R_ANKLE = 28;

const MAX_PHOTO_SIDE = 2400;

let models;

export function loadModels() {
  models ??= (async () => {
    // Loaded on demand, so the page still works if the download is slow or fails.
    const { FilesetResolver, ImageSegmenter, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(WASM);
    const [pose, segmenter] = await Promise.all([
      PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 2,
      }),
      ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: SEGMENT_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      }),
    ]);
    return { pose, segmenter, labels: segmenter.getLabels() };
  })();
  models.catch(() => (models = undefined));
  return models;
}

export class PhotoProblem extends Error {}

/**
 * Lengths between body points as fractions of standing height, and how much they vary
 * between people (%), from the 1,986 women of ANSUR II. The photo's ruler is the longest
 * span that's visible: the less it varies, the more accurate the scale.
 */
const SPANS = {
  head: { feet: [1, 0.3], knee: [0.725, 1.2], hip: [0.481, 3.0] },
  eye: { feet: [0.933, 0.6], knee: [0.657, 1.4], hip: [0.414, 3.5] },
  // Pose shoulder points sit a little below the bony tip the survey measured to.
  shoulder: { feet: [0.82, 1.5], knee: [0.544, 2.5], hip: [0.301, 5.0] },
};
const HEAD_TO_EYE = 0.067;
// Height above the floor of each lower point, as a fraction of standing height.
const ABOVE_FLOOR = { feet: 0, knee: 0.275, hip: 0.519 };

/**
 * Finds the person and returns the torso outline in cm. Never rejects a photo it can measure:
 * anything that makes the result less accurate is returned as a tip instead.
 * @param {ImageBitmap|HTMLCanvasElement|HTMLImageElement} source
 * @param {'front'|'side'} view
 * @returns tips: {text, severity} where severity 1 = slightly less accurate, 2 = rough.
 */
export async function analysePhoto(source, view, statureCm) {
  let loaded;
  try {
    loaded = await loadModels();
  } catch (error) {
    console.error(error);
    throw new PhotoProblem("Couldn't download the measuring tools. Check your internet connection and try again.");
  }
  const { pose, segmenter, labels } = loaded;
  const photo = toCanvas(source);
  const W = photo.width;
  const H = photo.height;
  const inFrame = (p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;

  const people = pose.detect(photo).landmarks;
  if (people.length === 0) throw new PhotoProblem("Couldn't find a person in the photo.");
  // If there's more than one person, measure the biggest.
  const torsoSize = (p) => Math.abs(p[L_HIP].y + p[R_HIP].y - p[L_SHOULDER].y - p[R_SHOULDER].y);
  const person = people.reduce((a, b) => (torsoSize(b) > torsoSize(a) ? b : a));
  const lm = person.map((p) => ({ x: p.x * W, y: p.y * H }));
  if (!inFrame(lm[L_SHOULDER]) && !inFrame(lm[R_SHOULDER])) {
    throw new PhotoProblem("Couldn't see your chest. Make sure it's in the photo.");
  }

  const tips = [];
  const tip = (severity, text) => tips.push({ severity, text });
  const mid = (a, b) => ({ x: (lm[a].x + lm[b].x) / 2, y: (lm[a].y + lm[b].y) / 2 });
  const shoulders = mid(L_SHOULDER, R_SHOULDER);
  const hips = mid(L_HIP, R_HIP);
  const knees = mid(L_KNEE, R_KNEE);
  const torsoPx = hips.y - shoulders.y;
  const centerX = (shoulders.x + hips.x) / 2;

  if (torsoPx < H * 0.12) tip(1, 'Stand a bit closer so you fill more of the photo.');
  if (Math.abs(shoulders.x - hips.x) / torsoPx > 0.12) tip(2, 'Stand up straight with the phone upright, not tilted.');
  const shoulderSpread = Math.hypot(lm[L_SHOULDER].x - lm[R_SHOULDER].x, lm[L_SHOULDER].y - lm[R_SHOULDER].y) / torsoPx;
  if (view === 'front' && shoulderSpread < 0.45) tip(2, 'Face the camera straight on in the front photo.');
  if (view === 'side' && shoulderSpread > 0.3) tip(2, 'Turn fully sideways in the side photo.');

  // Ruler: from the top of the head (or eyes, or shoulders) down to the feet (or knees, or
  // hips), whichever are in the photo.
  const feetInFrame = inFrame(lm[L_ANKLE]) && inFrame(lm[R_ANKLE]);
  const kneesInFrame = inFrame(lm[L_KNEE]) && inFrame(lm[R_KNEE]);
  const lowestY = feetInFrame ? mid(L_ANKLE, R_ANKLE).y : kneesInFrame ? knees.y : hips.y;
  const spanPx = Math.max(lowestY - lm[NOSE].y, torsoPx * 1.5);
  // A tight crop gives the model the most detail; leave room above the head.
  const figureBox = squareBox(centerX, (lm[NOSE].y + lowestY) / 2, spanPx * (feetInFrame ? 1.4 : 1.6));
  const found = figureExtent(segment(segmenter, labels, photo, figureBox, { includeHair: true }));
  const headVisible = found && found.headTopY > Math.max(0, figureBox.y) + 1;
  const eyes = mid(L_EYE, R_EYE);
  const top = headVisible
    ? { from: 'head', y: found.headTopY }
    : inFrame(eyes)
      ? { from: 'eye', y: eyes.y }
      : { from: 'shoulder', y: shoulders.y };
  const feetFound = feetInFrame && found && found.floorY < Math.min(H, figureBox.y + figureBox.size) - 1;
  const bottom = feetFound
    ? { to: 'feet', y: found.floorY }
    : kneesInFrame
      ? { to: 'knee', y: knees.y }
      : { to: 'hip', y: hips.y };
  const [fraction, variation] = SPANS[top.from][bottom.to];
  const cmPerPx = (statureCm * fraction) / (bottom.y - top.y);
  if (variation > 2) {
    tip(variation > 3 ? 2 : 1, 'Get more of yourself in the photo, ideally from the top of your head to your knees or feet.');
  }

  // Express everything as if from the floor, so both photos share heights.
  const headTopY =
    top.from === 'head' ? top.y : top.from === 'eye' ? top.y - (HEAD_TO_EYE * statureCm) / cmPerPx : null;
  const floorY =
    headTopY !== null ? headTopY + statureCm / cmPerPx : bottom.y + (ABOVE_FLOOR[bottom.to] * statureCm) / cmPerPx;
  const figure = { floorY, headTopY: floorY - statureCm / cmPerPx };

  // Torso outline: a tight crop gives the model several times more detail. Hair is left
  // out so long hair doesn't widen the outline.
  const torsoBox = squareBox(centerX, (shoulders.y + hips.y) / 2, torsoPx * 1.6);
  const torsoMask = segment(segmenter, labels, photo, torsoBox, { includeHair: false });
  const outline = torsoRows(torsoMask, centerX);
  if (view === 'front') {
    // Where an arm rests against the body, the outline includes it and the chest looks wider
    // than it is. Mark those rows so their width isn't used.
    const arms = [[L_SHOULDER, L_ELBOW, L_WRIST], [R_SHOULDER, R_ELBOW, R_WRIST]].map((ids) => ids.map((i) => lm[i]));
    const margin = 0.02 * torsoPx;
    for (const row of outline) {
      row.armTouching = arms.some((arm) => {
        const x = armXAt(arm, row.y);
        return x !== null && x > row.left - margin && x < row.right + margin;
      });
    }
  }

  const scale = { figure, statureCm };
  return {
    view,
    photo,
    figure,
    centerX,
    rows: toCentimetres(outline, { figure, centerX, statureCm }),
    /** Torso edges in image pixels, for drawing. */
    outline,
    shoulderH: heightAt(shoulders.y, scale),
    hipH: heightAt(hips.y, scale),
    // In a side photo the face points forward.
    facing: lm[NOSE].x >= centerX ? 1 : -1,
    /** Image y for a height above the floor, for drawing the measured lines. */
    yAt: (hCm) => figure.floorY - (hCm * (figure.floorY - figure.headTopY)) / statureCm,
    tips,
  };
}

/** Where an arm (shoulder → elbow → wrist) crosses height y, or null if it doesn't. */
function armXAt(points, y) {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y) && a.y !== b.y) {
      return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
    }
  }
  return null;
}

function toCanvas(source) {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const k = Math.min(1, MAX_PHOTO_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A square region centred on (cx, cy), in image pixels. May extend past the photo edges. */
function squareBox(cx, cy, size) {
  return { x: cx - size / 2, y: cy - size / 2, size };
}

/**
 * Segments one square region of the photo. The model works at 256×256, so the smaller the
 * region the finer the outline. Areas outside the photo are padded black.
 */
function segment(segmenter, labels, photo, box, { includeHair }) {
  const side = 512;
  const crop = document.createElement('canvas');
  crop.width = side;
  crop.height = side;
  const ctx = crop.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, side, side);
  const k = side / box.size;
  ctx.drawImage(photo, -box.x * k, -box.y * k, photo.width * k, photo.height * k);

  const result = segmenter.segment(crop);
  try {
    const masks = result.confidenceMasks;
    const background = masks[labels.indexOf('background')].getAsFloat32Array();
    const hair = masks[labels.indexOf('hair')].getAsFloat32Array();
    const { width, height } = masks[0];
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = 1 - background[i] - (includeHair ? 0 : hair[i]);
    const px = box.size / width;
    return { data, width, height, toImage: { x0: box.x, y0: box.y, sx: px, sy: box.size / height } };
  } finally {
    result.close();
  }
}
