// Runs the on-device vision models on a photo and prepares the silhouette for measuring.
// Photos never leave the browser: the models are downloaded once and run locally.

import { FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';
import { figureExtent, rowRuns, torsoRows } from './measure.js';
import { findPaper } from './paper.js';
import { assumedFocalPx } from './scale.js';

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
const L_ANKLE = 27;
const R_ANKLE = 28;

const MAX_PHOTO_SIDE = 2400;

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
 * Finds the person, checks the photo is usable, and returns the torso outline plus a scale.
 * The scale comes from the person's height when they are fully in frame, otherwise from a
 * sheet of paper tucked into their waistband.
 * @param {ImageBitmap|HTMLCanvasElement} source
 * @param {'front'|'side'} view
 * @param {{statureCm?: number, paper: 'A4'|'Letter'}} options
 */
export async function analysePhoto(source, view, { statureCm, paper }) {
  const { pose, segmenter, labels } = await loadModels();
  const photo = toCanvas(source);
  const W = photo.width;
  const H = photo.height;
  const inFrame = (p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;

  const detected = pose.detect(photo).landmarks;
  if (detected.length === 0) throw new PhotoProblem("Couldn't find a person in the photo.");
  if (detected.length > 1) throw new PhotoProblem('Only one person should be in the photo.');
  const lm = detected[0].map((p) => ({ x: p.x * W, y: p.y * H }));
  if (![NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP].every((i) => inFrame(lm[i]))) {
    throw new PhotoProblem('Your head and body down to your hips need to be in the photo.');
  }

  const mid = (a, b) => ({ x: (lm[a].x + lm[b].x) / 2, y: (lm[a].y + lm[b].y) / 2 });
  const shoulders = mid(L_SHOULDER, R_SHOULDER);
  const hips = mid(L_HIP, R_HIP);
  const torsoPx = hips.y - shoulders.y;
  if (torsoPx < H * 0.15) throw new PhotoProblem("You're too far away. Move closer so you fill more of the frame.");

  // Upright check: the line from hips to shoulders should be close to vertical.
  const lean = Math.abs(shoulders.x - hips.x) / torsoPx;
  if (lean > 0.12) throw new PhotoProblem('Stand up straight, and make sure the phone is upright, not tilted.');

  const shoulderSpread = Math.hypot(lm[L_SHOULDER].x - lm[R_SHOULDER].x, lm[L_SHOULDER].y - lm[R_SHOULDER].y) / torsoPx;
  if (view === 'front' && shoulderSpread < 0.45) throw new PhotoProblem('Face the camera straight on for the front photo.');
  if (view === 'side' && shoulderSpread > 0.3) throw new PhotoProblem('Turn fully sideways for the side photo.');

  const centerX = (shoulders.x + hips.x) / 2;
  const scale = (statureCm && heightScale()) || paperScale();
  if (!scale) {
    throw new PhotoProblem(
      view === 'front'
        ? `Couldn't see the folded ${paper} sheet. Tuck it into your waistband, landscape, flat against your stomach, or get your whole body in the photo.`
        : `Couldn't see the folded ${paper} sheet. Move it to your side, landscape and flat against your hip, facing the camera.`,
    );
  }

  // Torso outline: a tight crop gives the model several times more detail. Hair is left
  // out so long hair doesn't widen the outline.
  const torsoBox = squareBox(centerX, (shoulders.y + hips.y) / 2, torsoPx * 1.6);
  const torsoMask = segment(segmenter, labels, photo, torsoBox, { includeHair: false });
  if (scale.paperBox && view === 'front') fillBox(torsoMask, scale.paperBox);

  if (view === 'front') {
    // The arms must be clear of the body or the chest looks wider than it is: no elbow or
    // wrist between shoulder and hip height may sit inside the torso outline.
    for (const i of [L_ELBOW, R_ELBOW, L_WRIST, R_WRIST]) {
      const p = lm[i];
      if (p.y <= shoulders.y || p.y >= hips.y) continue;
      const row = Math.round((p.y - torsoBox.y) / torsoMask.toImage.sy - 0.5);
      const cx = (centerX - torsoBox.x) / torsoMask.toImage.sx;
      const px = (p.x - torsoBox.x) / torsoMask.toImage.sx;
      const torso = rowRuns(torsoMask.data, torsoMask.width, row).find(([a, b]) => a <= cx && cx <= b);
      if (torso && px > torso[0] - 2 && px < torso[1] + 2) {
        throw new PhotoProblem('Hold your arms out from your sides so there is a gap between your arms and body.');
      }
    }
  }

  const { paperBox, ...publicScale } = scale;
  return {
    view,
    photo,
    centerX,
    /** Torso edges in image pixels. */
    outline: torsoRows(torsoMask, centerX),
    shoulderY: shoulders.y,
    hipY: hips.y,
    // In a side photo the face points forward.
    facing: lm[NOSE].x >= centerX ? 1 : -1,
    scale: publicScale,
  };

  /** Scale from the person's height, if they are fully in frame. */
  function heightScale() {
    const ankles = mid(L_ANKLE, R_ANKLE);
    if (!inFrame(lm[L_ANKLE]) || !inFrame(lm[R_ANKLE])) return null;
    const bodyPx = ankles.y - lm[NOSE].y;
    const box = squareBox(centerX, (lm[NOSE].y + ankles.y) / 2, bodyPx * 1.4);
    const figure = figureExtent(segment(segmenter, labels, photo, box, { includeHair: true }));
    if (!figure || figure.headTopY <= Math.max(0, box.y) + 1 || figure.floorY >= Math.min(H, box.y + box.size) - 1) {
      return null;
    }
    return { mode: 'height', cmPerPx: statureCm / (figure.floorY - figure.headTopY), floorY: figure.floorY };
  }

  /** Scale from a sheet of paper around waist height. */
  function paperScale() {
    const halfWidth = torsoPx * (view === 'front' ? 0.75 : 0.65);
    const region = { x0: centerX - halfWidth, x1: centerX + halfWidth, y0: shoulders.y + 0.35 * torsoPx, y1: hips.y + 0.4 * torsoPx };
    const pixels = photo.getContext('2d').getImageData(0, 0, W, H).data;
    const found = findPaper(pixels, W, region, paper);
    if (!found) return null;
    return { mode: 'paper', cmPerPx: found.cmPerPx, paperY: found.centerY, focalPx: assumedFocalPx(W, H), paperBox: found.box };
  }
}

/** Marks a region of the mask as body (the paper lies on the body, in front of it). */
function fillBox(mask, box) {
  const { x0, y0, sx, sy } = mask.toImage;
  const c0 = Math.max(0, Math.floor((box.x0 - x0) / sx));
  const c1 = Math.min(mask.width, Math.ceil((box.x1 - x0) / sx));
  const r0 = Math.max(0, Math.floor((box.y0 - y0) / sy));
  const r1 = Math.min(mask.height, Math.ceil((box.y1 - y0) / sy));
  for (let r = r0; r < r1; r++) mask.data.fill(1, r * mask.width + c0, r * mask.width + c1);
}

function toCanvas(source) {
  const k = Math.min(1, MAX_PHOTO_SIDE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * k);
  canvas.height = Math.round(source.height * k);
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
