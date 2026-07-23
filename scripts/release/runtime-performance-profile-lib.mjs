import {
  basename,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export const RUNTIME_PROFILE_FORMAT =
  "poker-training-pro-packaged-runtime-profile";
export const RUNTIME_PROFILE_VERSION = 1;

export const OBSERVATIONAL_BUDGETS = Object.freeze({
  coldLaunchMs: Object.freeze({
    targetMax: 5_000,
    reviewMax: 10_000,
    unit: "ms",
  }),
  peakWorkingSetBytes: Object.freeze({
    targetMax: 750 * 1024 * 1024,
    reviewMax: 1_200 * 1024 * 1024,
    unit: "bytes",
  }),
  peakNormalizedCpuPercent: Object.freeze({
    targetMax: 75,
    reviewMax: 100,
    unit: "percent-of-host-capacity",
  }),
});

export function parseWindowsProcessTreeSample(
  serialized,
  expectedRootPid,
) {
  if (
    !Number.isInteger(expectedRootPid) ||
    expectedRootPid <= 0
  ) {
    throw new TypeError("Expected root PID is invalid.");
  }
  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new TypeError("Process sample is not valid JSON.");
  }
  if (
    !isRecord(value) ||
    value.rootPid !== expectedRootPid ||
    !boundedInteger(value.timestampMs, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(value.processCount, 1, 256) ||
    !boundedInteger(value.workingSetBytes, 0, 4 * 1024 ** 4) ||
    !boundedInteger(value.cpuTime100ns, 0, Number.MAX_SAFE_INTEGER)
  ) {
    throw new TypeError("Process sample has an invalid schema.");
  }
  return {
    timestampMs: value.timestampMs,
    rootPid: value.rootPid,
    processCount: value.processCount,
    workingSetBytes: value.workingSetBytes,
    cpuTime100ns: value.cpuTime100ns,
  };
}

export function classifyObservedMetric(value, budget) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !isRecord(budget) ||
    typeof budget.targetMax !== "number" ||
    typeof budget.reviewMax !== "number" ||
    !Number.isFinite(budget.targetMax) ||
    !Number.isFinite(budget.reviewMax) ||
    budget.targetMax < 0 ||
    budget.reviewMax < budget.targetMax
  ) {
    throw new TypeError("Metric or observational budget is invalid.");
  }
  if (value <= budget.targetMax) return "within-observed-target";
  if (value <= budget.reviewMax) return "review-on-this-host";
  return "over-observed-budget";
}

export function summarizeProcessSamples(samples, logicalCpuCount) {
  if (
    !Array.isArray(samples) ||
    samples.length === 0 ||
    !Number.isInteger(logicalCpuCount) ||
    logicalCpuCount < 1 ||
    logicalCpuCount > 1024
  ) {
    throw new TypeError("Process samples or host CPU count are invalid.");
  }
  const ordered = [...samples].sort(
    (left, right) => left.timestampMs - right.timestampMs,
  );
  let peakNormalizedCpuPercent = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const elapsedMs = current.timestampMs - previous.timestampMs;
    const cpuDelta100ns =
      current.cpuTime100ns - previous.cpuTime100ns;
    if (elapsedMs <= 0 || cpuDelta100ns < 0) continue;
    const cpuMs = cpuDelta100ns / 10_000;
    peakNormalizedCpuPercent = Math.max(
      peakNormalizedCpuPercent,
      (cpuMs / elapsedMs / logicalCpuCount) * 100,
    );
  }
  const first = ordered[0];
  const last = ordered.at(-1);
  return {
    sampleCount: ordered.length,
    sampleWindowMs: Math.max(0, last.timestampMs - first.timestampMs),
    peakProcessCount: Math.max(
      ...ordered.map((sample) => sample.processCount),
    ),
    peakWorkingSetBytes: Math.max(
      ...ordered.map((sample) => sample.workingSetBytes),
    ),
    observedCpuTimeMs: Math.max(
      0,
      (last.cpuTime100ns - first.cpuTime100ns) / 10_000,
    ),
    peakNormalizedCpuPercent: round(
      peakNormalizedCpuPercent,
      3,
    ),
  };
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

export function classifyRuntimeObservations(metrics) {
  return {
    coldLaunch:
      classifyObservedMetric(
        metrics.coldLaunchToRecognizedMs,
        OBSERVATIONAL_BUDGETS.coldLaunchMs,
      ),
    peakWorkingSet:
      classifyObservedMetric(
        metrics.processTree.peakWorkingSetBytes,
        OBSERVATIONAL_BUDGETS.peakWorkingSetBytes,
      ),
    peakNormalizedCpu:
      classifyObservedMetric(
        metrics.processTree.peakNormalizedCpuPercent,
        OBSERVATIONAL_BUDGETS.peakNormalizedCpuPercent,
      ),
  };
}

export function assertValidatedTemporaryProfile(
  profile,
  temporaryRoot,
  requiredPrefix,
) {
  if (
    typeof profile !== "string" ||
    typeof temporaryRoot !== "string" ||
    typeof requiredPrefix !== "string" ||
    requiredPrefix.length < 8
  ) {
    throw new TypeError("Temporary profile validation input is invalid.");
  }
  const resolvedProfile = resolve(profile);
  const resolvedTemp = resolve(temporaryRoot);
  const childPath = relative(resolvedTemp, resolvedProfile);
  if (
    !childPath ||
    childPath === ".." ||
    childPath.startsWith(`..${sep}`) ||
    isAbsolute(childPath) ||
    !basename(resolvedProfile).startsWith(requiredPrefix)
  ) {
    throw new Error("Refusing to operate on an unexpected profile path.");
  }
  return resolvedProfile;
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(value, minimum, maximum) {
  return (
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
