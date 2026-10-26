import { analysePhoto, loadModels, PhotoProblem } from './vision.js?v=8';
import { measureTorso, MeasureError } from './measure.js?v=8';
import { recommend } from './sizing.js?v=8';

const $ = (id) => document.getElementById(id);

const VIEWS = {
  front: {
    step: 'Photo 1 of 2',
    title: 'Front photo',
    hint: 'Face the camera. Hands on hips works best.',
  },
  side: {
    step: 'Photo 2 of 2',
    title: 'Side photo',
    hint: 'Turn sideways and stand naturally.',
  },
};

const state = {
  statureCm: null,
  view: 'front',
  pending: null, // analysed photo awaiting "Use this photo"
  photos: {}, // accepted analysed photos, by view
  stream: null,
  facingMode: 'user',
  timer: null,
  useFeet: false,
};

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function setLoading(text) {
  $('loading').hidden = !text;
  if (text) $('loading-text').textContent = text;
}

function message(id, text) {
  $(id).hidden = !text;
  $(id).textContent = text ?? '';
}

// --- Age check and setup ---------------------------------------------------------------

function storedAdult() {
  try {
    return localStorage.getItem('brafit-adult') === 'yes';
  } catch {
    return false;
  }
}

$('confirm-age').addEventListener('click', () => {
  try {
    localStorage.setItem('brafit-adult', 'yes');
  } catch {}
  openSetup();
});

function openSetup() {
  show('setup');
  // Start downloading the models while the person reads the instructions.
  loadModels().catch(() => {});
}

$('toggle-units').addEventListener('click', () => {
  state.useFeet = !state.useFeet;
  $('height-cm-wrap').hidden = state.useFeet;
  $('height-ftin-wrap').hidden = !state.useFeet;
  $('toggle-units').textContent = state.useFeet ? 'Use cm' : 'Use ft/in';
});

function readHeight() {
  if (state.useFeet) {
    const ft = parseFloat($('height-ft').value);
    const inches = parseFloat($('height-in').value || '0');
    return Number.isFinite(ft) ? (ft * 12 + inches) * 2.54 : NaN;
  }
  return parseFloat($('height-cm').value);
}

$('start').addEventListener('click', () => {
  const cm = readHeight();
  if (!(cm >= 120 && cm <= 220)) {
    message('setup-error', 'Please enter your height.');
    return;
  }
  message('setup-error', null);
  state.statureCm = cm;
  openCapture('front');
});

// --- Capture -----------------------------------------------------------------------------

function openCapture(view) {
  state.view = view;
  state.pending = null;
  $('capture-step').textContent = VIEWS[view].step;
  $('capture-title').textContent = VIEWS[view].title;
  $('capture-hint').textContent = VIEWS[view].hint;
  message('capture-error', null);
  message('capture-status', null);
  $('preview').hidden = true;
  $('camera-actions').hidden = false;
  $('review-actions').hidden = true;
  show('capture');
  startCamera();
}

async function startCamera() {
  stopCamera();
  const video = $('video');
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false,
    });
  } catch {
    $('stage-placeholder').textContent = 'Camera unavailable. You can upload photos instead.';
    $('stage-placeholder').hidden = false;
    $('timer').disabled = true;
    return;
  }
  video.srcObject = state.stream;
  video.style.transform = state.facingMode === 'user' ? 'scaleX(-1)' : '';
  await video.play();
  video.hidden = false;
  $('stage-placeholder').hidden = true;
  $('timer').disabled = false;
}

function stopCamera() {
  clearInterval(state.timer);
  state.timer = null;
  $('countdown').hidden = true;
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  $('video').hidden = true;
}

$('switch-camera').addEventListener('click', () => {
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  startCamera();
});

$('timer').addEventListener('click', () => {
  if (state.timer) return;
  let remaining = 10;
  $('countdown').hidden = false;
  $('countdown').textContent = remaining;
  state.timer = setInterval(async () => {
    remaining -= 1;
    if (remaining > 0) {
      $('countdown').textContent = remaining;
      if (remaining <= 3) beep(660);
      return;
    }
    clearInterval(state.timer);
    state.timer = null;
    $('countdown').hidden = true;
    beep(990);
    const video = $('video');
    const frame = document.createElement('canvas');
    frame.width = video.videoWidth;
    frame.height = video.videoHeight;
    frame.getContext('2d').drawImage(video, 0, 0);
    await check(frame);
  }, 1000);
});

$('upload').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let image;
  try {
    image = await openImage(file);
  } catch (error) {
    console.error(error);
    message('capture-error', `That file couldn't be opened as a photo (${error.message}).`);
    return;
  }
  await check(image);
});

/** Decodes an uploaded photo, upright. Falls back for browsers with partial support. */
async function openImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {}
  try {
    return await createImageBitmap(file);
  } catch {}
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function check(image) {
  stopCamera();
  message('capture-error', null);
  setLoading('Checking your photo…');
  try {
    const analysed = await analysePhoto(image, state.view, state.statureCm);
    state.pending = analysed;
    drawPreview(analysed);
    message(
      'capture-status',
      analysed.tips.length
        ? `Got it. For a more accurate result next time: ${analysed.tips.map((t) => t.text).join(' ')}`
        : 'Looks good.',
    );
    $('accept').hidden = false;
  } catch (error) {
    drawPlain(image);
    message(
      'capture-error',
      error instanceof PhotoProblem
        ? error.message
        : `Something went wrong reading the photo. Please try again. (Details: ${error?.message ?? error})`,
    );
    if (!(error instanceof PhotoProblem)) console.error(error);
    $('accept').hidden = true;
  } finally {
    setLoading(null);
    $('camera-actions').hidden = true;
    $('review-actions').hidden = false;
  }
}

$('retake').addEventListener('click', () => openCapture(state.view));

$('accept').addEventListener('click', () => {
  state.photos[state.view] = state.pending;
  if (!state.photos.front) openCapture('front');
  else if (!state.photos.side) openCapture('side');
  else showResult();
});

function drawPlain(image) {
  const canvas = $('preview');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  canvas.hidden = false;
  $('stage-placeholder').hidden = true;
}

function drawPreview(analysed) {
  const canvas = $('preview');
  drawPlain(analysed.photo);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2bd47d';
  const dot = Math.max(2, canvas.width / 300);
  analysed.outline.forEach((row, i) => {
    if (i % 3) return;
    ctx.fillRect(row.left - dot / 2, row.y - dot / 2, dot, dot);
    ctx.fillRect(row.right - dot / 2, row.y - dot / 2, dot, dot);
  });
}

// --- Result ------------------------------------------------------------------------------

function showResult() {
  const { front, side } = state.photos;
  let measurement;
  try {
    measurement = measureTorso({
      front: front.rows,
      side: side.rows,
      facing: side.facing,
      shoulderH: front.shoulderH,
      hipH: front.hipH,
      statureCm: state.statureCm,
    });
  } catch (error) {
    if (!(error instanceof MeasureError)) console.error(error);
    state.photos = {};
    openCapture('front');
    message('capture-error', `${error instanceof MeasureError ? error.message : 'Something went wrong.'} Please retake both photos.`);
    return;
  }

  const rec = recommend(measurement);
  if (!rec.size.inRange) {
    state.photos = {};
    openCapture('front');
    message('capture-error', "Those measurements don't look right. Please check the setup and retake both photos.");
    return;
  }
  $('size-uk').textContent = rec.size.uk;
  $('size-alt').textContent = `UK · US ${rec.size.us} · EU ${rec.size.eu}`;
  $('sisters-card').hidden = rec.sisters.length === 0;
  $('sisters').textContent = rec.sisters.map((s) => s.uk).join('  ·  ');

  const dl = $('measurements');
  dl.replaceChildren();
  for (const [label, cm] of [['Underbust', rec.underbustCm], ['Bust', rec.bustCm], ['Projection', rec.projectionCm]]) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = `${cm.toFixed(1)} cm (${(cm / 2.54).toFixed(1)} in)`;
    dl.append(dt, dd);
  }
  showAccuracy(front, side, measurement);
  $('shape').textContent = shapeAdvice(rec);

  drawThumb($('thumb-front'), front, measurement);
  drawThumb($('thumb-side'), side, measurement);
  show('result');
}

/** Good / Fair / Rough, from everything that made this result less certain, plus tips. */
function showAccuracy(front, side, m) {
  const tips = [...front.tips, ...side.tips];
  if (m.bust.widthSource === 'estimated' || m.underbust.widthSource === 'estimated') {
    tips.push({ severity: 1, text: 'Put your hands on your hips in the front photo so the sides of your chest can be seen.' });
  }
  if (m.method !== 'fold') {
    tips.push({ severity: 1, text: "Wear an unpadded bra or fitted top so the line under your bust shows in the side photo." });
  }
  const worst = Math.max(0, ...tips.map((t) => t.severity));
  $('accuracy-level').textContent = ['Good', 'Fair', 'Rough estimate'][worst];
  const list = $('accuracy-tips');
  list.replaceChildren(...[...new Set(tips.map((t) => t.text))].map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  $('accuracy-intro').hidden = tips.length === 0;
}

function drawThumb(canvas, analysed, m) {
  const { photo } = analysed;
  // Crop to the torso so the lines are easy to see.
  const top = analysed.yAt(m.bustH + 30);
  const bottom = analysed.yAt(m.underbustH - 25);
  const h = bottom - top;
  const w = h * 0.8;
  const x = analysed.centerX - w / 2;
  canvas.width = 400;
  canvas.height = 500;
  const k = canvas.width / w;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(photo, x, top, w, h, 0, 0, canvas.width, canvas.height);
  const style = getComputedStyle(document.documentElement);
  for (const [hCm, color] of [[m.bustH, style.getPropertyValue('--line-bust')], [m.underbustH, style.getPropertyValue('--line-underbust')]]) {
    const y = (analysed.yAt(hCm) - top) * k;
    ctx.strokeStyle = color.trim();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

/** Rough guide from how far the bust projects relative to the cup difference. */
function shapeAdvice(rec) {
  const difference = rec.bustCm - rec.underbustCm;
  if (difference <= 2) return 'A soft or lightly lined cup is likely to fit you best.';
  const ratio = rec.projectionCm / difference;
  if (ratio > 0.55) {
    return 'Your bust projects forward. Look for deeper cups with narrower wires, such as seamed balconettes or full cups.';
  }
  if (ratio < 0.35) {
    return 'Your bust is shallower and spreads wider. Look for shallower cups with wider wires, such as plunges and moulded T-shirt bras.';
  }
  return 'Your bust has an even shape. Most cup styles should work; balconettes and plunges are good places to start.';
}

$('again').addEventListener('click', () => {
  state.photos = {};
  state.pending = null;
  for (const id of ['thumb-front', 'thumb-side', 'preview']) {
    const c = $(id);
    c.width = c.height = 0;
  }
  show('setup');
});

function beep(frequency) {
  try {
    const audio = (beep.ctx ??= new AudioContext());
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = frequency;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.15);
  } catch {}
}

if (storedAdult()) openSetup();
