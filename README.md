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

1. **Pose check** (MediaPipe Pose Landmarker): one person, whole body in frame, upright,
   facing the camera or fully side-on, and arms clear of the body in the front photo.
2. **Scale:** the whole figure is segmented to find the top of the head and the soles of the
   feet. Your real height turns pixels into centimetres.
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

The tests render synthetic bodies into soft-edged silhouettes and run the same measuring
steps on them. On these bodies the results are within 1 cm of the true tape measurement,
across bust sizes, at low resolution, and with either facing direction.

## Accuracy: what still needs real data

The geometry is tested; how it maps onto real bodies is not yet. In order of impact:

1. **Calibration against real fittings.** These numbers are all starting guesses and need
   fitting against professional tape measurements and "did this size fit?" feedback:
   - `bustShape` and `underbustShape` in `measure.js`. The default bust factor comes from
     modelled busts, not real ones.
   - `DEFAULT_CALIBRATION` in `sizing.js`: the snug-tape and clothing offsets.
2. **Height accuracy.** Every 1 cm of height error is about 0.6% on every measurement.
3. **Clothing.** Padded bras and loose tops make the outline wrong; the app says so but
   can't detect it.
4. **The shape advice thresholds** in `app.js` are placeholders.

Once calibrated, front + side + height methods typically reach 1–2 cm on chest
circumferences. That is roughly one cup size, comparable to differences between human
fitters.

## Privacy

- Over-18 confirmation before use.
- Photos stay in memory in the browser and are cleared on "Start again". Nothing is uploaded:
  the only network requests download the MediaPipe library (jsDelivr) and models (Google).
- If you later collect data for calibration: use explicit opt-in consent and a DPIA, and
  store measurements, not photos.
