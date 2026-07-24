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
  // Common "good"/"needs improvement" paint budgets (e.g. the Lighthouse FCP
  // scoring curve), used here only as an observational reference point.
  firstContentfulPaintMs: Object.freeze({
    targetMax: 2_000,
    reviewMax: 4_000,
    unit: "ms",
  }),
  // Mirrors the widely published Total Blocking Time "good"/"needs
  // improvement" split, applied here to the startup window only.
  longTaskTotalMs: Object.freeze({
    targetMax: 200,
    reviewMax: 600,
    unit: "ms",
  }),
  jsHeapUsedBytes: Object.freeze({
    targetMax: 150 * 1024 * 1024,
    reviewMax: 300 * 1024 * 1024,
    unit: "bytes",
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

/**
 * Some metrics (first paint, FCP, long-task totals) are not guaranteed to be
 * exposed by every Chromium build/flag combination. This tolerates a missing
 * observation instead of throwing, so one absent optional metric cannot hide
 * the rest of the report.
 */
export function classifyOptionalMetric(value, budget) {
  if (value === null || value === undefined) return "not-observed";
  return classifyObservedMetric(value, budget);
}

/**
 * Validates and summarizes samples captured from a buffered
 * `PerformanceObserver({ type: "longtask", buffered: true })` registered as
 * early as the profiler's CDP session allows. This is a startup-window
 * main-thread-blocking proxy, not a full-session or pre-attach measurement.
 */
export function summarizeLongTasks(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("Long-task entries must be an array.");
  }
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      !Number.isFinite(entry.startTime) ||
      entry.startTime < 0 ||
      !Number.isFinite(entry.duration) ||
      entry.duration < 0 ||
      entry.duration > 60_000
    ) {
      throw new TypeError("Long-task entry has an invalid schema.");
    }
  }
  const totalDurationMs = round(
    entries.reduce((sum, entry) => sum + entry.duration, 0),
    3,
  );
  const longestDurationMs = entries.length
    ? round(Math.max(...entries.map((entry) => entry.duration)), 3)
    : 0;
  return {
    count: entries.length,
    totalDurationMs,
    longestDurationMs,
  };
}

/**
 * Validates and summarizes `PerformanceResourceTiming` samples into a
 * deterministic, name-sorted evidence shape. `durationMs` spans
 * `startTime`..`responseEnd`, so it includes network fetch time as well as
 * any in-process handling Chromium folds into that interval; it is a
 * dependency-evaluation / asset-decode *proxy*, not an isolated V8 compile or
 * GPU decode measurement (that requires the heavier Tracing domain).
 */
export function summarizeResourceEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("Resource entries must be an array.");
  }
  const sanitized = entries.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      entry.name.length === 0 ||
      !Number.isFinite(entry.startTime) ||
      entry.startTime < 0 ||
      !Number.isFinite(entry.responseEnd) ||
      entry.responseEnd < 0 ||
      !Number.isFinite(entry.transferSize) ||
      entry.transferSize < 0
    ) {
      throw new TypeError("Resource entry has an invalid schema.");
    }
    return {
      name: entry.name.slice(0, 300),
      durationMs: round(Math.max(0, entry.responseEnd - entry.startTime), 3),
      transferBytes: Math.round(entry.transferSize),
    };
  });
  sanitized.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.durationMs - right.durationMs,
  );
  return {
    count: sanitized.length,
    totalDurationMs: round(
      sanitized.reduce((sum, entry) => sum + entry.durationMs, 0),
      3,
    ),
    totalTransferBytes: sanitized.reduce(
      (sum, entry) => sum + entry.transferBytes,
      0,
    ),
    entries: sanitized,
  };
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
    firstContentfulPaint: classifyOptionalMetric(
      metrics.navigationTiming?.firstContentfulPaintMs,
      OBSERVATIONAL_BUDGETS.firstContentfulPaintMs,
    ),
    longTaskTotal: classifyOptionalMetric(
      metrics.longTasks?.totalDurationMs,
      OBSERVATIONAL_BUDGETS.longTaskTotalMs,
    ),
    jsHeapUsed: classifyOptionalMetric(
      metrics.cdpPerformanceMetrics?.JSHeapUsedSize,
      OBSERVATIONAL_BUDGETS.jsHeapUsedBytes,
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
