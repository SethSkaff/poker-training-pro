import assert from "node:assert/strict";
import {
  OBSERVATIONAL_BUDGETS,
  assertValidatedTemporaryProfile,
  classifyObservedMetric,
  parseWindowsProcessTreeSample,
  summarizeProcessSamples,
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

console.log(
  "Packaged runtime profiler self-tests passed: sample parser negatives, budget boundaries, CPU/working-set aggregation, and cleanup path validation.",
);
