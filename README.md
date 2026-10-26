# BraFit

Find a bra size from two photos (front and side). Upper body is enough, using a folded
sheet of paper for scale; or use the whole body plus your height. Runs in the browser on
any phone. Photos are processed on the device and never uploaded or saved.

## Run it

It's a static site with no build step:

```sh
npm start        # serves on http://localhost:8080
npm test         # measurement and sizing tests (Node 20+)
```

Phones only allow camera access over HTTPS, so host it on GitHub Pages or similar to use it
on a phone. Photo upload works anywhere.

## How it works

1. **Pose check** (MediaPipe Pose Landmarker): one person, whole body in frame, upright,
   facing the camera or fully side-on, and arms clear of the body in the front photo.
2. **Scale** (`js/paper.js`, `js/scale.js`), from either:
   - **A sheet of A4 or Letter, folded in half and tucked into the waistband**: on the
     stomach for the front photo, on the hip for the side photo. Its vertical edge gives
     cm per pixel. The sheet is nearer the camera than the torso's edges, so the scale is
     corrected using the camera distance (from an assumed phone focal length) and the depth
     or width measured in the other photo.
   - **Height:** when the whole body is in frame and the height is entered, the head and
     feet give the scale.
3. **Torso outline** (MediaPipe selfie multiclass segmenter): the torso is cropped tightly
   before segmenting, because the model works at 256×256 and a tight crop gives several
   times more detail. Hair is excluded. Edges are found to sub-pixel accuracy.
4. **Measuring** (`js/measure.js`): the front photo gives width at every height, the side
   photo gives depth and the bust's profile.
   - The bust is where the profile sticks out furthest.
   - The underbust is the fold below it, where the profile stops receding.
   - At each line, width and depth become a circumference: an ellipse with a shape factor.
5. **Sizing** (`js/sizing.js`): the modern UK method (band = underbust to the nearest even
   inch, one cup per inch), with US and EU conversions and sister sizes.

## Calibration

The step from silhouette width and depth to a tape circumference is calibrated on real
women. **ANSUR II** (US Army anthropometric survey, 2012; public domain) measured 1,986
women with both a tape and calipers at the same levels. Run
`python3 calibration/fit_ansur.py` to refit; it prints the constants for
`CIRCUMFERENCE_MODEL` in `js/measure.js`.

| | Plain ellipse | Calibrated (cross-validated) |
|---|---|---|
| Bust | 13.5 cm too small on average | no bias, typical error 1.7 cm |
| Underbust (waist used as stand-in) | 4.9 cm too small | no bias, typical error 1.4 cm |

Real torso cross-sections are much boxier than ellipses, especially at the bust, where the
tape runs nearly straight across the front.

## Testing

- **Synthetic bodies** are rendered into soft-edged silhouettes and run through the same
  measuring steps. Width and depth come out within 3 mm, across bust sizes, at low
  resolution and with either facing direction.
- **A 400-woman ANSUR II sample** (`test/fixtures`) checks the circumference model.

## Accuracy: what still needs real data

In order of impact:

1. **Photo-to-caliper agreement.** The model assumes the photo outlines give the same width
   and depth as calipers. Segmentation edges, clothing and posture will add some error.
   Checking needs a set of photos paired with tape measurements; 30–50 people is enough
   to correct any bias.
2. **Underbust.** ANSUR II has no underbust measurement, so the waist stands in for it.
3. **Band fit offsets** (`DEFAULT_CALIBRATION` in `sizing.js`): how much snugger a fitter's
   band is than a relaxed tape. This is a starting guess; "did this size fit?" feedback
   will tune it.
4. **Scale accuracy.** In height mode, every 1 cm of height error is about 0.6% on every
   measurement. In paper mode, a phone lens 20% different from the assumed one costs about 1.5%.
5. **The shape advice thresholds** in `app.js` are placeholders.

## Privacy

- Over-18 confirmation before use.
- Photos stay in memory in the browser and are cleared on "Start again". Nothing is uploaded:
  the only network requests download the MediaPipe library (jsDelivr) and models (Google).
- If you later collect data for calibration: use explicit opt-in consent and a DPIA, and
  store measurements, not photos.
