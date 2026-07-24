import assert from "node:assert/strict";
import {
  FLASH_CEILING_PER_SECOND,
  detectOpposingTransitions,
  evaluateFlashSequence,
  isGeneralFlashTransition,
  isRedFlashTransition,
  isSaturatedRed,
  maxEventsInAnySlidingWindow,
  relativeLuminance,
  rgbToHsv,
  summarizeFramePixels,
} from "./release/flash-luminance-analysis-lib.mjs";

// --- relativeLuminance: known reference values ---
assert.equal(relativeLuminance(255, 255, 255), 1);
assert.equal(relativeLuminance(0, 0, 0), 0);
assert.ok(
  Math.abs(relativeLuminance(255, 0, 0) - 0.2126) < 1e-9,
  "pure red's relative luminance is exactly the R coefficient (its channel is fully saturated)",
);

// --- rgbToHsv / isSaturatedRed ---
assert.deepEqual(rgbToHsv(255, 0, 0), { hue: 0, saturation: 1, value: 1 });
assert.equal(rgbToHsv(255, 255, 255).saturation, 0);
assert.equal(isSaturatedRed(255, 0, 0), true, "pure red must be a saturated red");
assert.equal(isSaturatedRed(255, 255, 255), false, "white is not red");
assert.equal(isSaturatedRed(0, 0, 255), false, "blue is not red");
assert.equal(
  isSaturatedRed(100, 0, 0),
  false,
  "a dark red below the value threshold does not count as saturated red",
);
assert.equal(
  isSaturatedRed(255, 210, 210),
  false,
  "a desaturated pink below the saturation threshold does not count",
);

// --- summarizeFramePixels ---
// A 2x1 frame: one pure-red pixel, one pure-white pixel.
const framePixels = Uint8Array.of(255, 0, 0, 255, 255, 255, 255, 255);
const summary = summarizeFramePixels(framePixels, 2, 1);
assert.ok(Math.abs(summary.meanRelativeLuminance - (0.2126 + 1) / 2) < 1e-9);
assert.equal(summary.saturatedRedCoverage, 0.5);
assert.throws(
  () => summarizeFramePixels(framePixels, 3, 1),
  /length/i,
  "a width/height mismatch against the buffer length must be rejected",
);

// --- detectOpposingTransitions ---
// A sawtooth: 0.9 (dark) -> 0.1 (bright change, dark<0.8) -> 0.9 -> 0.1 is two
// opposing pairs (decrease then increase, then decrease then increase).
const sawtooth = [
  { timestampMs: 0, value: 0.9 },
  { timestampMs: 100, value: 0.1 },
  { timestampMs: 200, value: 0.9 },
  { timestampMs: 300, value: 0.1 },
];
const sawtoothEvents = detectOpposingTransitions(sawtooth, isGeneralFlashTransition);
assert.equal(sawtoothEvents.length, 2, "each direction reversal after the first transition is one flash");
assert.deepEqual(
  sawtoothEvents.map((event) => event.atMs),
  [200, 300],
);

// A change that never dips below the 0.80 "darker frame" ceiling must not count.
const tooLightToFlash = [
  { timestampMs: 0, value: 0.95 },
  { timestampMs: 100, value: 0.82 },
  { timestampMs: 200, value: 0.95 },
];
assert.deepEqual(detectOpposingTransitions(tooLightToFlash, isGeneralFlashTransition), []);

// A change below the 10% delta threshold must not count.
const tooSmallToFlash = [
  { timestampMs: 0, value: 0.5 },
  { timestampMs: 100, value: 0.55 },
  { timestampMs: 200, value: 0.5 },
];
assert.deepEqual(detectOpposingTransitions(tooSmallToFlash, isGeneralFlashTransition), []);

assert.throws(
  () =>
    detectOpposingTransitions(
      [
        { timestampMs: 100, value: 0.9 },
        { timestampMs: 0, value: 0.1 },
      ],
      isGeneralFlashTransition,
    ),
  /sorted/i,
);

// --- maxEventsInAnySlidingWindow ---
assert.equal(maxEventsInAnySlidingWindow([]), 0);
assert.equal(maxEventsInAnySlidingWindow([0, 990]), 2, "two events within one second both count");
assert.equal(
  maxEventsInAnySlidingWindow([0, 990, 2000]),
  2,
  "the third event is outside the first window",
);
assert.equal(
  maxEventsInAnySlidingWindow([0, 200, 400, 600, 5000]),
  4,
  "four events packed inside 600ms are all within one sliding second",
);

// --- evaluateFlashSequence: synthetic frame sequences with known flash counts ---

// Four opposing luminance swings inside one second (250ms period) must fail
// the three-per-second ceiling.
const failingFrames = [];
for (let i = 0; i <= 8; i += 1) {
  failingFrames.push({
    timestampMs: i * 125,
    meanRelativeLuminance: i % 2 === 0 ? 0.9 : 0.1,
    saturatedRedCoverage: 0,
  });
}
const failingResult = evaluateFlashSequence({ sequenceId: "synthetic-fail", frames: failingFrames });
assert.equal(failingResult.generalFlash.pass, false);
assert.ok(failingResult.generalFlash.maxPerSecond > FLASH_CEILING_PER_SECOND);
assert.equal(failingResult.pass, false);

// The same shape but slowed to a 400ms period keeps the flash rate at or
// under three per second and must pass.
const passingFrames = [];
for (let i = 0; i <= 6; i += 1) {
  passingFrames.push({
    timestampMs: i * 400,
    meanRelativeLuminance: i % 2 === 0 ? 0.9 : 0.1,
    saturatedRedCoverage: 0,
  });
}
const passingResult = evaluateFlashSequence({ sequenceId: "synthetic-pass", frames: passingFrames });
assert.equal(passingResult.generalFlash.pass, true);
assert.ok(passingResult.generalFlash.maxPerSecond <= FLASH_CEILING_PER_SECOND);
assert.equal(passingResult.pass, true);

// A static (non-animated) sequence must produce zero flashes of either kind.
const staticFrames = Array.from({ length: 10 }, (_, i) => ({
  timestampMs: i * 100,
  meanRelativeLuminance: 0.42,
  saturatedRedCoverage: 0.02,
}));
const staticResult = evaluateFlashSequence({ sequenceId: "synthetic-static", frames: staticFrames });
assert.equal(staticResult.generalFlash.events.length, 0);
assert.equal(staticResult.redFlash.events.length, 0);
assert.equal(staticResult.pass, true);

// A saturated-red coverage oscillation above the ceiling must fail red-flash
// even when luminance stays flat (a same-luminance red/dark-red swap).
const redFlashFrames = [];
for (let i = 0; i <= 8; i += 1) {
  redFlashFrames.push({
    timestampMs: i * 125,
    meanRelativeLuminance: 0.5,
    saturatedRedCoverage: i % 2 === 0 ? 0.9 : 0.05,
  });
}
const redFlashResult = evaluateFlashSequence({ sequenceId: "synthetic-red-fail", frames: redFlashFrames });
assert.equal(redFlashResult.generalFlash.pass, true, "flat luminance must not trip the general-flash detector");
assert.equal(redFlashResult.redFlash.pass, false);
assert.equal(redFlashResult.pass, false);

assert.throws(
  () => evaluateFlashSequence({ sequenceId: "too-short", frames: [{ timestampMs: 0, meanRelativeLuminance: 0.5, saturatedRedCoverage: 0 }] }),
  /at least two frames/i,
);
assert.throws(
  () => evaluateFlashSequence({ sequenceId: "", frames: staticFrames }),
  /sequenceid/i,
);
assert.equal(isRedFlashTransition(0.5, 0.65), true);
assert.equal(isRedFlashTransition(0.5, 0.55), false);

console.log(
  "Flash/luminance analysis self-tests passed: relative luminance and HSV reference values, saturated-red classification, frame-pixel summarization, opposing-transition detection (delta and darkness-ceiling gating), sliding-window flash-rate counting, and pass/fail synthetic sequences for general flash, red flash, and a static baseline.",
);
