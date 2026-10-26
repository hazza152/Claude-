// Runs the on-device vision models on a photo and prepares the silhouette for measuring.
// Photos never leave the browser: the models are downloaded once and run locally.

import { FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';
import { figureExtent, heightAt, toCentimetres, torsoRows } from './measure.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const SEGMENT_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

// BlazePose landmark indices.
const NOSE = 0;
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
// Top of head to knee (pose landmark, the joint centre) as a fraction of standing height.
const HEAD_TO_KNEE = 0.725;

let models;

export function loadModels() {
  models ??= (async () => {
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
 * Finds the person, checks the photo is usable, and returns the torso outline in cm.
 * @param {ImageBitmap|HTMLCanvasElement} source
 * @param {'front'|'side'} view
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

  const detected = pose.detect(photo).landmarks;
  if (detected.length === 0) throw new PhotoProblem("Couldn't find a person in the photo.");
  if (detected.length > 1) throw new PhotoProblem('Only one person should be in the photo.');
  const lm = detected[0].map((p) => ({ x: p.x * W, y: p.y * H, visibility: p.visibility ?? 1 }));
  const inFrame = (p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
  if (![NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE].every((i) => inFrame(lm[i]))) {
    throw new PhotoProblem('Get from the top of your head down to at least your knees in the photo. Move the phone further away.');
  }

  const mid = (a, b) => ({ x: (lm[a].x + lm[b].x) / 2, y: (lm[a].y + lm[b].y) / 2 });
  const shoulders = mid(L_SHOULDER, R_SHOULDER);
  const hips = mid(L_HIP, R_HIP);
  const knees = mid(L_KNEE, R_KNEE);
  const feetInFrame = inFrame(lm[L_ANKLE]) && inFrame(lm[R_ANKLE]);
  const lowest = feetInFrame ? mid(L_ANKLE, R_ANKLE) : knees;
  const bodyPx = lowest.y - lm[NOSE].y;
  const torsoPx = hips.y - shoulders.y;
  if (torsoPx < H * 0.15) throw new PhotoProblem("You're too far away. Move closer so you fill more of the frame.");

  // Upright check: the line from hips to shoulders should be close to vertical.
  const lean = Math.abs(shoulders.x - hips.x) / torsoPx;
  if (lean > 0.12) throw new PhotoProblem('Stand up straight, and make sure the phone is upright, not tilted.');

  const shoulderSpread = Math.hypot(lm[L_SHOULDER].x - lm[R_SHOULDER].x, lm[L_SHOULDER].y - lm[R_SHOULDER].y) / torsoPx;
  if (view === 'front' && shoulderSpread < 0.45) throw new PhotoProblem('Face the camera straight on for the front photo.');
  if (view === 'side' && shoulderSpread > 0.3) throw new PhotoProblem('Turn fully sideways for the side photo.');

  // Height scale. Segment the figure at the best resolution the model allows to find the top
  // of the head, and the soles of the feet if they're in the photo.
  const centerX = (shoulders.x + hips.x) / 2;
  // A tight crop gives the most detail; without the feet, leave more room above the head.
  const figureBox = squareBox(centerX, (lm[NOSE].y + lowest.y) / 2, bodyPx * (feetInFrame ? 1.4 : 1.6));
  const found = figureExtent(segment(segmenter, labels, photo, figureBox, { includeHair: true }));
  if (!found || found.headTopY <= Math.max(0, figureBox.y) + 1) {
    throw new PhotoProblem('The top of your head needs to be in the photo.');
  }
  const feetFound = feetInFrame && found.floorY < Math.min(H, figureBox.y + figureBox.size) - 1;
  // Feet out of shot: place the floor from the knees instead. In women the knee sits 72.5% of
  // the way down from the top of the head, varying by about 1.2% (ANSUR II, 1,986 women).
  const figure = feetFound
    ? found
    : { headTopY: found.headTopY, floorY: found.headTopY + (knees.y - found.headTopY) / HEAD_TO_KNEE };

  // Torso outline: a tight crop gives the model several times more detail. Hair is left
  // out so long hair doesn't widen the outline.
  const torsoBox = squareBox(centerX, (shoulders.y + hips.y) / 2, torsoPx * 1.6);
  const torsoMask = segment(segmenter, labels, photo, torsoBox, { includeHair: false });

  const scale = { figure, statureCm };
  const outline = torsoRows(torsoMask, centerX);
  if (view === 'front') {
    // Where an arm rests against the body, the outline includes it and the chest looks wider
    // than it is. Mark those rows; the measurement only needs the bust and underbust clear.
    const arms = [[L_SHOULDER, L_ELBOW, L_WRIST], [R_SHOULDER, R_ELBOW, R_WRIST]].map((ids) => ids.map((i) => lm[i]));
    const margin = 0.02 * torsoPx;
    for (const row of outline) {
      row.armTouching = arms.some((arm) => {
        const x = armXAt(arm, row.y);
        return x !== null && x > row.left - margin && x < row.right + margin;
      });
    }
  }
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
