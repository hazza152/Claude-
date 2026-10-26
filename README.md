# BraFit

Find a bra size from two photos (front and side) plus your height. Runs in the browser on
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

1. **Pose** (MediaPipe Pose Landmarker): finds the person (the biggest one, if there are
   several). Photos are never rejected for pose or framing; anything that lowers accuracy
   becomes a tip, and the result shows an accuracy rating (Good / Fair / Rough estimate).
2. **Scale:** your height is the ruler. The app uses the longest span in the photo: from the
   top of the head (or the eyes, or the shoulders) down to the feet (or knees, or hips). Each
   span's share of height comes from ANSUR II women; how much it varies between people
   sets the accuracy, from about 0.3% (head to feet) through 1.2% (head to knees) to about
   3% (head to hips).
3. **Torso outline** (MediaPipe selfie multiclass segmenter): the torso is cropped tightly
   before segmenting, because the model works at 256×256 and a tight crop gives several
   times more detail. Hair is excluded. Edges are found to sub-pixel accuracy.
4. **Measuring** (`js/measure.js`): the front photo gives width at every height, the side
   photo gives depth and the bust's profile.
   - The bust is where the profile sticks out furthest.
   - The underbust is the fold below it, where the profile stops receding.
   - At each line, width and depth become a circumference: an ellipse with a shape factor.
   - Where arms hide the sides of the chest, the width comes from a clear row close by, or
     is predicted from depth and height (bust typically within 2.1 cm instead of 1.7 cm).
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
4. **Height accuracy.** Every 1 cm of height error is about 0.6% on every measurement.
5. **The shape advice thresholds** in `app.js` are placeholders.

## Privacy

- Over-18 confirmation before use.
- Photos stay in memory in the browser and are cleared on "Start again". Nothing is uploaded:
  the only network requests download the MediaPipe library (jsDelivr) and models (Google).
- If you later collect data for calibration: use explicit opt-in consent and a DPIA, and
  store measurements, not photos.
