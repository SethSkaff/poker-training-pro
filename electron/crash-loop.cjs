const {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const MARKER_FORMAT = "poker-training-pro-crash-loop";
const MARKER_VERSION = 1;
const MARKER_FILENAME = "crash-loop.json";
const MAX_MARKER_BYTES = 16 * 1024;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_DECAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HEALTHY_SESSION_MS = 60 * 1000;
const MAX_FAILURE_COUNT = 20;
const FAILURE_KINDS = new Set(["startup", "renderer"]);

function createCrashLoopController(options) {
  if (!options || typeof options.directory !== "string") {
    throw new TypeError("A crash-loop directory is required");
  }
  const directory = path.resolve(options.directory);
  const markerPath = path.join(directory, MARKER_FILENAME);
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const failureThreshold = boundedPositiveInteger(
    options.failureThreshold,
    DEFAULT_FAILURE_THRESHOLD,
    10,
  );
  const decayMs = boundedPositiveInteger(
    options.decayMs,
    DEFAULT_DECAY_MS,
    30 * 24 * 60 * 60 * 1000,
  );
  const healthySessionMs = boundedPositiveInteger(
    options.healthySessionMs,
    DEFAULT_HEALTHY_SESSION_MS,
    60 * 60 * 1000,
  );
  let marker = readMarker(markerPath);
  let hadCorruptMarker = false;
  if (!marker.ok) {
    hadCorruptMarker = marker.error.code !== "missing";
    marker = { ok: true, value: emptyMarker() };
  }

  const now = validTimestamp(clock());
  let state = decayMarker(marker.value, now, decayMs);
  if (state.sessionPending) {
    state = {
      ...state,
      consecutiveFailures: Math.min(
        MAX_FAILURE_COUNT,
        state.consecutiveFailures + 1,
      ),
      lastFailureAt: now,
      lastFailureKind: "startup",
    };
  }

  const selectedFailureCount = state.consecutiveFailures;
  const safeMode = selectedFailureCount >= failureThreshold;
  const safeModeReason = safeMode
    ? state.lastFailureKind === "renderer"
      ? "repeated-renderer-failures"
      : "repeated-startup-failures"
    : undefined;

  state = {
    ...state,
    sessionPending: true,
    lastStartupAt: now,
  };
  writeMarker(markerPath, state);

  function publicState() {
    return Object.freeze({
      available: true,
      active: safeMode,
      ...(safeModeReason ? { reason: safeModeReason } : {}),
      failureCount: selectedFailureCount,
      recoveryMarkerRecovered: hadCorruptMarker,
    });
  }

  function recordRendererFailure() {
    const timestamp = validTimestamp(clock());
    const current = currentState(timestamp);
    state = {
      ...current,
      consecutiveFailures: Math.min(
        MAX_FAILURE_COUNT,
        current.consecutiveFailures + 1,
      ),
      lastFailureAt: timestamp,
      lastFailureKind: "renderer",
      sessionPending: true,
    };
    writeMarker(markerPath, state);
    return state.consecutiveFailures;
  }

  function markHealthySession() {
    const timestamp = validTimestamp(clock());
    state = {
      ...emptyMarker(),
      sessionPending: true,
      lastStartupAt: state.lastStartupAt ?? timestamp,
    };
    writeMarker(markerPath, state);
  }

  function recordNormalQuit() {
    const timestamp = validTimestamp(clock());
    const current = currentState(timestamp);
    state = {
      ...current,
      sessionPending: false,
    };
    writeMarker(markerPath, state);
  }

  function currentState(timestamp) {
    const disk = readMarker(markerPath);
    const candidate = disk.ok ? disk.value : state;
    return decayMarker(candidate, timestamp, decayMs);
  }

  return Object.freeze({
    getPublicState: publicState,
    getHealthySessionMs: () => healthySessionMs,
    markHealthySession,
    recordNormalQuit,
    recordRendererFailure,
  });
}

function readMarker(markerPath) {
  if (!existsSync(markerPath)) {
    return failure("missing");
  }
  try {
    const metadata = statSync(markerPath);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_MARKER_BYTES) {
      return failure("invalid-marker");
    }
    const parsed = JSON.parse(readFileSync(markerPath, "utf8"));
    if (!isValidMarker(parsed)) {
      return failure("invalid-marker");
    }
    return { ok: true, value: parsed };
  } catch {
    return failure("invalid-marker");
  }
}

function writeMarker(markerPath, marker) {
  if (!isValidMarker(marker)) {
    throw new TypeError("Crash-loop marker is invalid");
  }
  const serialized = JSON.stringify(marker);
  if (Buffer.byteLength(serialized, "utf8") > MAX_MARKER_BYTES) {
    throw new TypeError("Crash-loop marker is too large");
  }
  const directory = path.dirname(markerPath);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(markerPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx");
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, markerPath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function decayMarker(marker, now, decayMs) {
  if (
    marker.lastFailureAt !== undefined &&
    now - marker.lastFailureAt >= decayMs
  ) {
    return {
      ...marker,
      consecutiveFailures: 0,
      lastFailureAt: undefined,
      lastFailureKind: undefined,
      sessionPending: false,
    };
  }
  return marker;
}

function emptyMarker() {
  return {
    format: MARKER_FORMAT,
    version: MARKER_VERSION,
    consecutiveFailures: 0,
    sessionPending: false,
  };
}

function isValidMarker(value) {
  if (
    !isRecord(value) ||
    value.format !== MARKER_FORMAT ||
    value.version !== MARKER_VERSION ||
    !Number.isInteger(value.consecutiveFailures) ||
    value.consecutiveFailures < 0 ||
    value.consecutiveFailures > MAX_FAILURE_COUNT ||
    typeof value.sessionPending !== "boolean"
  ) {
    return false;
  }
  for (const key of [
    "lastFailureAt",
    "lastStartupAt",
  ]) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || value[key] < 0)
    ) {
      return false;
    }
  }
  if (
    value.lastFailureKind !== undefined &&
    !FAILURE_KINDS.has(value.lastFailureKind)
  ) {
    return false;
  }
  if (
    (value.consecutiveFailures === 0 &&
      (value.lastFailureAt !== undefined ||
        value.lastFailureKind !== undefined)) ||
    (value.consecutiveFailures > 0 &&
      (value.lastFailureAt === undefined ||
        value.lastFailureKind === undefined))
  ) {
    return false;
  }
  const allowedKeys = new Set([
    "format",
    "version",
    "consecutiveFailures",
    "sessionPending",
    "lastFailureAt",
    "lastFailureKind",
    "lastStartupAt",
  ]);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Crash-loop clock returned an invalid timestamp");
  }
  return value;
}

function boundedPositiveInteger(value, fallback, maximum) {
  return Number.isInteger(value) && value > 0 && value <= maximum
    ? value
    : fallback;
}

function isRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function failure(code) {
  return { ok: false, error: { code } };
}

module.exports = {
  DEFAULT_DECAY_MS,
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_HEALTHY_SESSION_MS,
  MARKER_FILENAME,
  MAX_MARKER_BYTES,
  createCrashLoopController,
  readMarker,
};
