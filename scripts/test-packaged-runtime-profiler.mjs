import assert from "node:assert/strict";
import {
  OBSERVATIONAL_BUDGETS,
  assertValidatedTemporaryProfile,
  classifyObservedMetric,
  classifyOptionalMetric,
  classifyRuntimeObservations,
  parseWindowsProcessTreeSample,
  summarizeLongTasks,
  summarizeProcessSamples,
  summarizeResourceEntries,
} from "./release/runtime-performance-profile-lib.mjs";

const rootPid = 4242;
const valid = JSON.stringify({
  timestampMs: 1_000,
  rootPid,
  processCount: 4,
  workingSetBytes: 300_000_000,
  cpuTime100ns: 2_000_000,
});
assert.deepEqual(parseWindowsProcessTreeSample(valid, rootPid), {
  timestampMs: 1_000,
  rootPid,
  processCount: 4,
  workingSetBytes: 300_000_000,
  cpuTime100ns: 2_000_000,
});

for (const invalid of [
  "{partial",
  JSON.stringify({
    timestampMs: 1_000,
    rootPid: 9,
    processCount: 4,
    workingSetBytes: 1,
    cpuTime100ns: 1,
  }),
  JSON.stringify({
    timestampMs: 1_000,
    rootPid,
    processCount: 0,
    workingSetBytes: 1,
    cpuTime100ns: 1,
  }),
  JSON.stringify({
    timestampMs: 1_000,
    rootPid,
    processCount: 1,
    workingSetBytes: -1,
    cpuTime100ns: 1,
  }),
  JSON.stringify({
    timestampMs: 1_000,
    rootPid,
    processCount: 1,
    workingSetBytes: 5 * 1024 ** 4,
    cpuTime100ns: 1,
  }),
]) {
  assert.throws(
    () => parseWindowsProcessTreeSample(invalid, rootPid),
    /invalid|JSON/i,
  );
}

const budget = { targetMax: 10, reviewMax: 20 };
assert.equal(classifyObservedMetric(10, budget), "within-observed-target");
assert.equal(classifyObservedMetric(10.001, budget), "review-on-this-host");
assert.equal(classifyObservedMetric(20, budget), "review-on-this-host");
assert.equal(classifyObservedMetric(20.001, budget), "over-observed-budget");
assert.throws(() => classifyObservedMetric(Number.NaN, budget), /invalid/i);
assert.throws(
  () =>
    classifyObservedMetric(1, { targetMax: 20, reviewMax: 10 }),
  /invalid/i,
);

assert.deepEqual(
  summarizeProcessSamples(
    [
      {
        timestampMs: 1_000,
        rootPid,
        processCount: 2,
        workingSetBytes: 100,
        cpuTime100ns: 1_000_000,
      },
      {
        timestampMs: 2_000,
        rootPid,
        processCount: 4,
        workingSetBytes: 400,
        cpuTime100ns: 21_000_000,
      },
    ],
    4,
  ),
  {
    sampleCount: 2,
    sampleWindowMs: 1_000,
    peakProcessCount: 4,
    peakWorkingSetBytes: 400,
    observedCpuTimeMs: 2_000,
    peakNormalizedCpuPercent: 50,
  },
);
assert.equal(
  OBSERVATIONAL_BUDGETS.coldLaunchMs.unit,
  "ms",
);

const fakeTempRoot = "C:\\Temp";
assert.equal(
  assertValidatedTemporaryProfile(
    "C:\\Temp\\poker-training-pro-runtime-profile-abc123",
    fakeTempRoot,
    "poker-training-pro-runtime-profile-",
  ),
  "C:\\Temp\\poker-training-pro-runtime-profile-abc123",
);
for (const unsafePath of [
  "C:\\Temp",
  "C:\\Temp\\unrelated-profile",
  "C:\\Users\\Player\\poker-training-pro-runtime-profile-abc123",
]) {
  assert.throws(
    () =>
      assertValidatedTemporaryProfile(
        unsafePath,
        fakeTempRoot,
        "poker-training-pro-runtime-profile-",
      ),
    /refusing/i,
  );
}

// --- Optional-metric classification (first paint/FCP, long tasks, JS heap) ---
assert.equal(classifyOptionalMetric(null, budget), "not-observed");
assert.equal(classifyOptionalMetric(undefined, budget), "not-observed");
assert.equal(classifyOptionalMetric(5, budget), "within-observed-target");
assert.equal(classifyOptionalMetric(25, budget), "over-observed-budget");

// --- Long-task summarization (startup main-thread-blocking proxy) ---
assert.deepEqual(
  summarizeLongTasks([
    { startTime: 10, duration: 60 },
    { startTime: 120, duration: 90 },
  ]),
  { count: 2, totalDurationMs: 150, longestDurationMs: 90 },
);
assert.deepEqual(summarizeLongTasks([]), {
  count: 0,
  totalDurationMs: 0,
  longestDurationMs: 0,
});
for (const invalidEntries of [
  [{ startTime: -1, duration: 10 }],
  [{ startTime: 0, duration: -5 }],
  [{ startTime: 0, duration: 70_000 }],
  [{ startTime: "0", duration: 10 }],
  "not-an-array",
]) {
  assert.throws(() => summarizeLongTasks(invalidEntries), /invalid|array/i);
}

// --- Resource-timing summarization (dependency-evaluation / decode proxy) ---
const resourceSummary = summarizeResourceEntries([
  {
    name: "poker-training-pro://app/assets/chunk-b.js",
    startTime: 100,
    responseEnd: 140,
    transferSize: 2_048,
  },
  {
    name: "poker-training-pro://app/assets/chunk-a.js",
    startTime: 50,
    responseEnd: 90,
    transferSize: 4_096,
  },
]);
assert.equal(resourceSummary.count, 2);
assert.equal(resourceSummary.totalDurationMs, 80);
assert.equal(resourceSummary.totalTransferBytes, 6_144);
assert.deepEqual(
  resourceSummary.entries.map((entry) => entry.name),
  [
    "poker-training-pro://app/assets/chunk-a.js",
    "poker-training-pro://app/assets/chunk-b.js",
  ],
  "resource entries must sort deterministically by name",
);
assert.deepEqual(summarizeResourceEntries([]), {
  count: 0,
  totalDurationMs: 0,
  totalTransferBytes: 0,
  entries: [],
});
for (const invalidEntries of [
  [{ name: "", startTime: 0, responseEnd: 1, transferSize: 0 }],
  [{ name: "x", startTime: -1, responseEnd: 1, transferSize: 0 }],
  [{ name: "x", startTime: 0, responseEnd: -1, transferSize: 0 }],
  [{ name: "x", startTime: 0, responseEnd: 1, transferSize: -1 }],
  "not-an-array",
]) {
  assert.throws(() => summarizeResourceEntries(invalidEntries), /invalid|array/i);
}

// --- End-to-end classification wiring for the new metrics ---
const syntheticClassification = classifyRuntimeObservations({
  coldLaunchToRecognizedMs: 1_000,
  navigationTiming: { firstContentfulPaintMs: 900 },
  cdpPerformanceMetrics: { JSHeapUsedSize: 50 * 1024 * 1024 },
  processTree: { peakWorkingSetBytes: 1, peakNormalizedCpuPercent: 1 },
  longTasks: { totalDurationMs: 50 },
});
assert.equal(syntheticClassification.firstContentfulPaint, "within-observed-target");
assert.equal(syntheticClassification.longTaskTotal, "within-observed-target");
assert.equal(syntheticClassification.jsHeapUsed, "within-observed-target");
const missingOptionalClassification = classifyRuntimeObservations({
  coldLaunchToRecognizedMs: 1_000,
  navigationTiming: {},
  cdpPerformanceMetrics: {},
  processTree: { peakWorkingSetBytes: 1, peakNormalizedCpuPercent: 1 },
  longTasks: {},
});
assert.equal(missingOptionalClassification.firstContentfulPaint, "not-observed");
assert.equal(missingOptionalClassification.longTaskTotal, "not-observed");
assert.equal(missingOptionalClassification.jsHeapUsed, "not-observed");

console.log(
  "Packaged runtime profiler self-tests passed: sample parser negatives, budget boundaries, CPU/working-set aggregation, cleanup path validation, optional-metric classification, long-task summarization, and resource-timing summarization.",
);
