/**
 * Pure math for the rendered flash/luminance analysis. This is an
 * implementation of the WCAG 2.3.1 thresholds as described in the W3C
 * "Understanding SC 2.3.1: Three Flashes or Below Threshold" document, not a
 * certified photosensitive-epilepsy analysis tool. Every threshold this
 * module applies is documented below, and the simplifications versus the
 * full WCAG definition are called out explicitly so nobody mistakes this for
 * G15 tool-grade conformance evidence.
 *
 * WCAG 2.3.1 (informative glossary, "general flash and red flash
 * thresholds") defines, in summary:
 *  - a GENERAL FLASH: a pair of opposing changes in relative luminance of
 *    10% or more of the maximum relative luminance, where the relative
 *    luminance of the darker frame is below 0.80, measured over a
 *    341x256px block (or the content's area/a 341x256 block within it,
 *    whichever is smaller);
 *  - a RED FLASH: any pair of opposing transitions involving a saturated
 *    red;
 *  - content fails unless it has no more than three flashes of either kind
 *    in any one-second period.
 *
 * Simplifications this module makes (documented, not hidden):
 *  1. Area: like the project's static source-level gate
 *     (docs/motion-flash-accessibility-policy.md), this measures the whole
 *     captured region as one block instead of scanning every possible
 *     341x256px sub-block. That is the *more* conservative reading (it
 *     cannot under-count a small hazardous region that a sub-block scan
 *     would catch, but it also cannot pinpoint which sub-region is
 *     responsible) and keeps the same policy the project already committed
 *     to for its CSS/script gate.
 *  2. Relative luminance uses the WCAG 2.x contrast-ratio definition
 *     (linearized sRGB, Rec. 709 coefficients), the same formula WCAG's own
 *     glossary points to for "relative luminance".
 *  3. Saturated red is approximated with an HSV hue/saturation/value test
 *     (hue within 20 degrees of red, saturation >= 0.8, value >= 0.5)
 *     instead of the CIE chromaticity-coordinate polygon used by
 *     colorimetric flash-analysis tools. This is a coarser, hand-rollable
 *     stand-in, not a colorimetric match.
 *  4. "Opposing changes" for the red-flash test are measured as a >=10
 *     percentage-point swing in the fraction of captured pixels classified
 *     as saturated red between adjacent frames, since WCAG's glossary does
 *     not give a numeric magnitude for the red case the way it does for
 *     general flash. The 10-percentage-point figure mirrors the general
 *     flash magnitude (10% of the observable range) for consistency.
 */

export const GENERAL_FLASH_LUMINANCE_DELTA = 0.1;
export const GENERAL_FLASH_DARK_CEILING = 0.8;
export const RED_FLASH_COVERAGE_DELTA = 0.1;
export const RED_HUE_MAX_DEGREES = 20;
export const RED_MIN_SATURATION = 0.8;
export const RED_MIN_VALUE = 0.5;
export const FLASH_CEILING_PER_SECOND = 3;
export const SLIDING_WINDOW_MS = 1_000;

/**
 * WCAG relative luminance for one 8-bit sRGB channel (0..255 in, 0..1 out).
 */
export function linearizeChannel(channel8bit) {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance for one RGB pixel (each channel 0..255). */
export function relativeLuminance(r, g, b) {
  return (
    0.2126 * linearizeChannel(r) +
    0.7152 * linearizeChannel(g) +
    0.0722 * linearizeChannel(b)
  );
}

/** RGB (0..255 each) to HSV; hue in degrees [0,360), saturation/value in [0,1]. */
export function rgbToHsv(r, g, b) {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === rf) hue = 60 * (((gf - bf) / delta) % 6);
    else if (max === gf) hue = 60 * ((bf - rf) / delta + 2);
    else hue = 60 * ((rf - gf) / delta + 4);
    if (hue < 0) hue += 360;
  }
  const saturation = max === 0 ? 0 : delta / max;
  return { hue, saturation, value: max };
}

/** Section 3 of the module doc comment: the saturated-red pixel test. */
export function isSaturatedRed(r, g, b) {
  const { hue, saturation, value } = rgbToHsv(r, g, b);
  const nearRedHue = hue <= RED_HUE_MAX_DEGREES || hue >= 360 - RED_HUE_MAX_DEGREES;
  return nearRedHue && saturation >= RED_MIN_SATURATION && value >= RED_MIN_VALUE;
}

/**
 * Reduces one decoded RGBA frame to the two per-frame scalars the flash
 * detectors need: mean relative luminance and saturated-red pixel coverage
 * across the whole captured region (see simplification #1 above).
 * `stride` samples every Nth pixel instead of every pixel, trading precision
 * for speed on large captures; it defaults to 1 (every pixel).
 */
export function summarizeFramePixels(pixels, width, height, options = {}) {
  const stride = Number.isInteger(options.stride) && options.stride > 0 ? options.stride : 1;
  if (!(pixels instanceof Uint8Array) && !(pixels instanceof Uint8ClampedArray)) {
    throw new TypeError("Frame pixels must be a Uint8Array/Uint8ClampedArray.");
  }
  const pixelCount = width * height;
  if (pixels.length !== pixelCount * 4) {
    throw new TypeError("Frame pixel buffer length does not match width*height*4.");
  }
  let luminanceSum = 0;
  let redCount = 0;
  let sampled = 0;
  for (let index = 0; index < pixelCount; index += stride) {
    const offset = index * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    luminanceSum += relativeLuminance(r, g, b);
    if (isSaturatedRed(r, g, b)) redCount += 1;
    sampled += 1;
  }
  if (sampled === 0) throw new TypeError("No pixels were sampled from the frame.");
  return {
    meanRelativeLuminance: luminanceSum / sampled,
    saturatedRedCoverage: redCount / sampled,
    sampledPixelCount: sampled,
  };
}

/**
 * Detects "opposing change" transitions in a scalar time series (luminance
 * or red-pixel coverage), applying the given significance rule between each
 * adjacent pair of frames, then keeping only transitions whose direction
 * reverses the previous *significant* transition's direction (an "opposing
 * pair" per the WCAG glossary; two same-direction significant changes in a
 * row are one ongoing change, not two flashes).
 *
 * @param {{timestampMs:number, value:number}[]} series sorted ascending by
 *   timestampMs.
 * @param {(previous:number, current:number) => boolean} isSignificant
 * @returns {{atMs:number, fromValue:number, toValue:number, direction:"increase"|"decrease"}[]}
 */
export function detectOpposingTransitions(series, isSignificant) {
  if (!Array.isArray(series) || series.length < 2) return [];
  for (let index = 1; index < series.length; index += 1) {
    if (series[index].timestampMs < series[index - 1].timestampMs) {
      throw new TypeError("Frame series must be sorted ascending by timestampMs.");
    }
  }
  const events = [];
  let lastDirection = null;
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    const delta = current.value - previous.value;
    if (delta === 0 || !isSignificant(previous.value, current.value)) continue;
    const direction = delta > 0 ? "increase" : "decrease";
    if (lastDirection !== null && direction !== lastDirection) {
      events.push({
        atMs: current.timestampMs,
        fromValue: previous.value,
        toValue: current.value,
        direction,
      });
    }
    lastDirection = direction;
  }
  return events;
}

/** The general-flash significance rule from the module doc comment. */
export function isGeneralFlashTransition(previousLuminance, currentLuminance) {
  const delta = Math.abs(currentLuminance - previousLuminance);
  const darker = Math.min(previousLuminance, currentLuminance);
  return delta >= GENERAL_FLASH_LUMINANCE_DELTA && darker < GENERAL_FLASH_DARK_CEILING;
}

/** The red-flash significance rule from the module doc comment (item 4). */
export function isRedFlashTransition(previousCoverage, currentCoverage) {
  return Math.abs(currentCoverage - previousCoverage) >= RED_FLASH_COVERAGE_DELTA;
}

/**
 * The maximum number of events found in any sliding window of `windowMs`
 * starting at an observed event timestamp. This is the standard way flash
 * analyzers turn a list of flash timestamps into a "flashes per second"
 * figure: it is exact for the recorded event timestamps (no binning
 * artifacts), and is what gets compared against the three-per-second
 * ceiling.
 */
export function maxEventsInAnySlidingWindow(eventTimestampsMs, windowMs = SLIDING_WINDOW_MS) {
  if (!Array.isArray(eventTimestampsMs)) {
    throw new TypeError("Event timestamps must be an array.");
  }
  if (eventTimestampsMs.length === 0) return 0;
  const sorted = [...eventTimestampsMs].sort((left, right) => left - right);
  let maxCount = 0;
  let windowStart = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    while (sorted[index] - sorted[windowStart] >= windowMs) windowStart += 1;
    maxCount = Math.max(maxCount, index - windowStart + 1);
  }
  return maxCount;
}

/**
 * Runs both flash detectors over one captured sequence's per-frame summary
 * data and classifies it against the project's three-per-second ceiling
 * (matching docs/motion-flash-accessibility-policy.md's static-gate ceiling,
 * which the WCAG glossary itself allows as a simple sufficient route below
 * SC 2.3.1's more complex area exception).
 *
 * @param {{sequenceId:string, frames:{timestampMs:number, meanRelativeLuminance:number, saturatedRedCoverage:number}[]}} input
 */
export function evaluateFlashSequence({ sequenceId, frames, ceilingPerSecond = FLASH_CEILING_PER_SECOND }) {
  if (typeof sequenceId !== "string" || sequenceId.length === 0) {
    throw new TypeError("sequenceId is required.");
  }
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new TypeError("At least two frames are required to detect a transition.");
  }
  const luminanceSeries = frames.map((frame) => ({
    timestampMs: frame.timestampMs,
    value: frame.meanRelativeLuminance,
  }));
  const redSeries = frames.map((frame) => ({
    timestampMs: frame.timestampMs,
    value: frame.saturatedRedCoverage,
  }));
  const generalEvents = detectOpposingTransitions(luminanceSeries, isGeneralFlashTransition);
  const redEvents = detectOpposingTransitions(redSeries, isRedFlashTransition);
  const generalMaxPerSecond = maxEventsInAnySlidingWindow(generalEvents.map((event) => event.atMs));
  const redMaxPerSecond = maxEventsInAnySlidingWindow(redEvents.map((event) => event.atMs));
  const generalPass = generalMaxPerSecond <= ceilingPerSecond;
  const redPass = redMaxPerSecond <= ceilingPerSecond;
  return {
    sequenceId,
    frameCount: frames.length,
    durationMs: frames.at(-1).timestampMs - frames[0].timestampMs,
    ceilingPerSecond,
    generalFlash: { events: generalEvents, maxPerSecond: generalMaxPerSecond, pass: generalPass },
    redFlash: { events: redEvents, maxPerSecond: redMaxPerSecond, pass: redPass },
    pass: generalPass && redPass,
  };
}
