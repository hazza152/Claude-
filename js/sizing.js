// Bra size from underbust and bust circumferences, using the modern UK method:
// band = snug underbust rounded to the nearest even inch (no "+4"),
// cup = one step per inch the bust exceeds the band.

const UK_CUPS = ['AA', 'A', 'B', 'C', 'D', 'DD', 'E', 'F', 'FF', 'G', 'GG', 'H', 'HH', 'J', 'JJ', 'K', 'KK', 'L'];
const US_CUPS = ['AA', 'A', 'B', 'C', 'D', 'DD', 'DDD', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];
const EU_CUPS = ['AA', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];

const cup = (table, index) => table[index] ?? '?';

export function braSize(band, cupIndex) {
  return {
    band,
    cupIndex,
    uk: `${band}${cup(UK_CUPS, cupIndex)}`,
    us: `${band}${cup(US_CUPS, cupIndex)}`,
    // EU bands step by 5 cm: UK 32 = EU 70.
    eu: `${70 + ((band - 32) / 2) * 5}${cup(EU_CUPS, cupIndex)}`,
    inRange: cupIndex >= 0 && cupIndex < UK_CUPS.length && band >= 26 && band <= 56,
  };
}

export function sizeFromMeasurements(underbustCm, bustCm) {
  const band = Math.round(underbustCm / 2.54 / 2) * 2;
  const cupIndex = Math.max(0, Math.round(bustCm / 2.54 - band));
  return braSize(band, cupIndex);
}

/** Same cup volume on a tighter and a looser band. */
export function sisterSizes(size) {
  return [braSize(size.band - 2, size.cupIndex + 1), braSize(size.band + 2, size.cupIndex - 1)]
    .filter((s) => s.inRange);
}

/**
 * Converts photo-estimated circumferences into what a fitter's tape would read.
 * These are starting guesses: replace them with values fitted to real fittings.
 */
export const DEFAULT_CALIBRATION = {
  // A snug tape compresses soft tissue under the bust; a photo outline doesn't.
  underbustOffsetCm: -1.5,
  // Thickness of the top or bra worn in the photos.
  bustOffsetCm: -0.3,
};

export function recommend(measurement, calibration = DEFAULT_CALIBRATION) {
  const underbustCm = measurement.underbustCm + calibration.underbustOffsetCm;
  const bustCm = measurement.bustCm + calibration.bustOffsetCm;
  const size = sizeFromMeasurements(underbustCm, bustCm);
  return { size, sisters: sisterSizes(size), underbustCm, bustCm, projectionCm: measurement.projectionCm };
}
