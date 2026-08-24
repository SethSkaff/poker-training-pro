const {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");

const AUTOSAVE_FORMAT = "poker-training-pro-autosave";
const AUTOSAVE_VERSION = 1;
// Match the reviewed import/export ceilings. IPC is an untrusted boundary even
// with context isolation: reject oversized structured data before parsing,
// checksumming, rotating, or writing it in the main process.
const MAX_AUTOSAVE_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_AUTOSAVE_REPLAY_BYTES = 2 * 1024 * 1024;
const MAX_AUTOSAVE_REPLAY_DEPTH = 32;
const MAX_AUTOSAVE_REPLAY_NODES = 20_000;
const CURRENT_FILENAME = "autosave.json";
const PREVIOUS_FILENAME = "autosave.previous.json";
const LAST_KNOWN_GOOD_FILENAME = "autosave.last-known-good.json";
const SAVE_FORMAT = "poker-training-pro-save";
const BOUNDARIES = new Set([
  "settings",
  "action",
  "hand",
  "result",
  "lifecycle",
]);
const FORBIDDEN_REPLAY_KEYS = new Set([
  "deck",
  "futureCards",
  "futureDeck",
  "hiddenCards",
  "holeCards",
  "opponentCards",
  "serverSeed",
]);

function checksum(payload) {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function assertSavePayload(serializedSave) {
  if (typeof serializedSave !== "string" || serializedSave.length === 0) {
    throw new TypeError("Autosave payload must be a non-empty JSON string");
  }
  if (Buffer.byteLength(serializedSave, "utf8") > MAX_AUTOSAVE_PAYLOAD_BYTES) {
    throw new TypeError("Autosave payload is too large");
  }
  let parsed;
  try {
    parsed = JSON.parse(serializedSave);
  } catch {
    throw new TypeError("Autosave payload must be valid JSON");
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== SAVE_FORMAT ||
    !Number.isInteger(parsed.version) ||
    parsed.version < 0 ||
    !isRecord(parsed.data)
  ) {
    throw new TypeError("Autosave payload is not a Poker Training Pro save");
  }
}

function sanitizeReplayMetadata(metadata) {
  if (metadata === undefined) return undefined;
  if (!isRecord(metadata)) {
    throw new TypeError("Replay metadata must be an object");
  }
  assertJsonSafe(metadata);
  const serialized = JSON.stringify(metadata);
  if (Buffer.byteLength(serialized, "utf8") > MAX_AUTOSAVE_REPLAY_BYTES) {
    throw new TypeError("Replay metadata is too large");
  }
  return JSON.parse(serialized);
}

function assertJsonSafe(value) {
  const ancestors = new Set();
  let nodes = 0;

  function visit(item, depth) {
    nodes += 1;
    if (nodes > MAX_AUTOSAVE_REPLAY_NODES) {
      throw new TypeError("Replay metadata contains too many values");
    }
    if (depth > MAX_AUTOSAVE_REPLAY_DEPTH) {
      throw new TypeError("Replay metadata is nested too deeply");
    }
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      return;
    }
    if (
      typeof item !== "object" ||
      (!Array.isArray(item) && !isPlainRecord(item))
    ) {
      throw new TypeError("Replay metadata must contain only JSON-safe values");
    }
    if (ancestors.has(item)) throw new TypeError("Replay metadata is cyclic");
    ancestors.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else {
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        if (FORBIDDEN_REPLAY_KEYS.has(key)) {
          throw new TypeError(`Replay metadata cannot contain ${key}`);
        }
        visit(item[key], depth + 1);
      }
    }
    ancestors.delete(item);
  }

  visit(value, 0);
}

function isPlainRecord(value) {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createAutosaveRecord(serializedSave, options = {}) {
  assertSavePayload(serializedSave);
  const boundary = options.boundary;
  if (!BOUNDARIES.has(boundary)) {
    throw new TypeError("Autosave boundary is invalid");
  }
  const savedAt =
    typeof options.savedAt === "string" && options.savedAt.length > 0
      ? options.savedAt
      : new Date().toISOString();
  const replay = sanitizeReplayMetadata(options.replay);

  return {
    format: AUTOSAVE_FORMAT,
    version: AUTOSAVE_VERSION,
    boundary,
    savedAt,
    checksum: checksum(serializedSave),
    payload: serializedSave,
    ...(replay === undefined ? {} : { replay }),
  };
}

function parseAutosaveRecord(serializedRecord) {
  let record;
  try {
    record = JSON.parse(serializedRecord);
  } catch {
    return failure("invalid-json", "Autosave record is not valid JSON");
  }
  if (
    !isRecord(record) ||
    record.format !== AUTOSAVE_FORMAT ||
    record.version !== AUTOSAVE_VERSION ||
    !BOUNDARIES.has(record.boundary) ||
    typeof record.savedAt !== "string" ||
    typeof record.payload !== "string" ||
    typeof record.checksum !== "string"
  ) {
    return failure("invalid-record", "Autosave record has an invalid shape");
  }
  if (checksum(record.payload) !== record.checksum) {
    return failure("checksum-mismatch", "Autosave checksum does not match");
  }
  try {
    assertSavePayload(record.payload);
    sanitizeReplayMetadata(record.replay);
  } catch (error) {
    return failure(
      "invalid-payload",
      error instanceof Error ? error.message : String(error),
    );
  }
  return { ok: true, record };
}

function writeAutosaveGeneration(directory, serializedSave, options = {}) {
  const resolvedDirectory = path.resolve(directory);
  mkdirSync(resolvedDirectory, { recursive: true });
  const currentPath = path.join(resolvedDirectory, CURRENT_FILENAME);
  const previousPath = path.join(resolvedDirectory, PREVIOUS_FILENAME);
  const record = createAutosaveRecord(serializedSave, options);
  const serializedRecord = JSON.stringify(record);
  let rotatedPrevious = false;
  let ignoredCorruptCurrent = false;

  if (existsSync(currentPath)) {
    const currentRaw = readFileSync(currentPath, "utf8");
    if (parseAutosaveRecord(currentRaw).ok) {
      atomicReplace(previousPath, currentRaw);
      rotatedPrevious = true;
    } else {
      ignoredCorruptCurrent = true;
    }
  }

  atomicReplace(currentPath, serializedRecord);
  const verified = parseAutosaveRecord(readFileSync(currentPath, "utf8"));
  if (!verified.ok || verified.record.checksum !== record.checksum) {
    throw withCode(
      "Save verification failed after replacing the current generation",
      "EIO",
    );
  }

  let lastKnownGoodUpdated = false;
  let lastKnownGoodError;
  try {
    atomicReplace(
      path.join(resolvedDirectory, LAST_KNOWN_GOOD_FILENAME),
      serializedRecord,
    );
    lastKnownGoodUpdated = true;
  } catch (error) {
    lastKnownGoodError = mapFileError(error, "write");
  }
  return {
    record,
    currentPath,
    previousPath,
    rotatedPrevious,
    ignoredCorruptCurrent,
    lastKnownGoodUpdated,
    ...(lastKnownGoodError ? { lastKnownGoodError } : {}),
  };
}

function loadAutosaveGeneration(directory) {
  const resolvedDirectory = path.resolve(directory);
  const candidates = [
    ["current", path.join(resolvedDirectory, CURRENT_FILENAME)],
    ["previous", path.join(resolvedDirectory, PREVIOUS_FILENAME)],
  ];
  const errors = [];

  for (const [source, filePath] of candidates) {
    if (!existsSync(filePath)) {
      errors.push({ source, code: "missing" });
      continue;
    }
    let raw;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      errors.push({
        source,
        code: "read-failed",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const parsed = parseAutosaveRecord(raw);
    if (parsed.ok) {
      return { ok: true, source, filePath, record: parsed.record, errors };
    }
    errors.push({ source, ...parsed.error });
  }

  return {
    ok: false,
    error: {
      code: "no-valid-generation",
      message: "No valid autosave generation is available",
      generations: errors,
    },
  };
}

function probeAutosaveGenerations(directory) {
  const resolvedDirectory = path.resolve(directory);
  const candidates = [
    ["current", CURRENT_FILENAME],
    ["previous", PREVIOUS_FILENAME],
    ["last-known-good", LAST_KNOWN_GOOD_FILENAME],
  ];

  const generations = candidates.map(([source, fileName]) => {
      const filePath = path.join(resolvedDirectory, fileName);
      if (!existsSync(filePath)) return { source, exists: false };
      let raw;
      try {
        raw = readFileSync(filePath, "utf8");
      } catch (error) {
        return {
          source,
          exists: true,
          error: mapFileError(error, "read"),
        };
      }
      const parsed = parseAutosaveRecord(raw);
      return parsed.ok
        ? { source, exists: true, record: parsed.record }
        : { source, exists: true, error: parsed.error };
    });
  let archiveEvidence = false;
  try {
    archiveEvidence =
      existsSync(resolvedDirectory) &&
      readdirSync(resolvedDirectory).some(
        (fileName) =>
          fileName.startsWith("archive.") && fileName.endsWith(".json"),
      );
  } catch {
    // An unreadable save directory is authoritative evidence, not first-run.
    archiveEvidence = true;
  }

  return {
    generations,
    hasAuthoritativeEvidence:
      archiveEvidence ||
      generations.some((generation) => generation.exists),
  };
}

function restoreAutosaveGeneration(directory, source) {
  if (source !== "previous" && source !== "last-known-good") {
    throw new TypeError("Recovery source must be previous or last-known-good");
  }
  const probe = probeAutosaveGenerations(directory);
  const selected = probe.generations.find(
    (generation) => generation.source === source,
  );
  if (!selected?.exists || !selected.record) {
    return {
      ok: false,
      error: selected?.error ?? {
        code: "no-save",
        message: "The selected recovery generation is unavailable",
      },
    };
  }

  try {
    archiveGeneration(directory, "current", "restore");
    const result = writeAutosaveGeneration(directory, selected.record.payload, {
      boundary: "lifecycle",
      replay: selected.record.replay,
    });
    return {
      ok: true,
      record: result.record,
      rotatedPrevious: result.rotatedPrevious,
      ignoredCorruptCurrent: result.ignoredCorruptCurrent,
    };
  } catch (error) {
    return { ok: false, error: mapFileError(error, "archive") };
  }
}

function startFreshAutosave(directory, serializedSave) {
  assertSavePayload(serializedSave);
  try {
    archiveGeneration(directory, "current", "fresh-start");
    archiveGeneration(directory, "previous", "fresh-start");
    archiveGeneration(directory, "last-known-good", "fresh-start");
    const result = writeAutosaveGeneration(directory, serializedSave, {
      boundary: "lifecycle",
    });
    return {
      ok: true,
      record: result.record,
      rotatedPrevious: result.rotatedPrevious,
      ignoredCorruptCurrent: result.ignoredCorruptCurrent,
    };
  } catch (error) {
    return { ok: false, error: mapFileError(error, "archive") };
  }
}

function readSaveForExport(directory, source = "current") {
  if (
    source !== "current" &&
    source !== "previous" &&
    source !== "last-known-good"
  ) {
    throw new TypeError("Export source is invalid");
  }
  const selected = probeAutosaveGenerations(directory).generations.find(
    (generation) => generation.source === source,
  );
  if (!selected?.exists || !selected.record) {
    return {
      ok: false,
      error: selected?.error ?? {
        code: "no-save",
        message: "The selected save is unavailable",
      },
    };
  }
  return { ok: true, payload: selected.record.payload };
}

function createDiagnosticExport(directory) {
  const probe = probeAutosaveGenerations(directory);
  return JSON.stringify(
    {
      format: "poker-training-pro-save-diagnostics",
      version: 1,
      createdAt: new Date().toISOString(),
      generations: probe.generations.map((generation) => ({
        source: generation.source,
        exists: generation.exists,
        ...(generation.record
          ? {
              valid: true,
              journalVersion: generation.record.version,
              boundary: generation.record.boundary,
              savedAt: generation.record.savedAt,
              checksum: generation.record.checksum,
              payload: summarizeSavePayload(generation.record.payload),
            }
          : {}),
        ...(generation.error
          ? {
              valid: false,
              error: {
                code: generation.error.code,
                ...(generation.error.systemCode
                  ? { systemCode: generation.error.systemCode }
                  : {}),
              },
            }
          : {}),
      })),
    },
    null,
    2,
  );
}

function summarizeSavePayload(serializedSave) {
  try {
    const value = JSON.parse(serializedSave);
    return {
      format: typeof value?.format === "string" ? value.format : "unknown",
      version: Number.isInteger(value?.version) ? value.version : "unknown",
      playerProfilePresent:
        typeof value?.data?.progress?.playerName === "string",
      trainingCompleted: Number.isFinite(
        value?.data?.progress?.trainingCompleted,
      )
        ? Math.max(0, Math.trunc(value.data.progress.trainingCompleted))
        : undefined,
      resultCount: Array.isArray(value?.data?.progress?.results)
        ? value.data.progress.results.length
        : undefined,
    };
  } catch {
    return { format: "unreadable" };
  }
}

function archiveGeneration(directory, source, reason) {
  const fileNames = {
    current: CURRENT_FILENAME,
    previous: PREVIOUS_FILENAME,
    "last-known-good": LAST_KNOWN_GOOD_FILENAME,
  };
  const fileName = fileNames[source];
  if (!fileName) throw new TypeError("Archive source is invalid");
  const resolvedDirectory = path.resolve(directory);
  const sourcePath = path.join(resolvedDirectory, fileName);
  if (!existsSync(sourcePath)) return undefined;

  const raw = readFileSync(sourcePath, "utf8");
  const parsed = parseAutosaveRecord(raw);
  const digest = parsed.ok
    ? parsed.record.checksum.slice(0, 12)
    : checksum(raw).slice(0, 12);
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  const archivePath = path.join(
    resolvedDirectory,
    `archive.${reason}.${source}.${timestamp}.${digest}.json`,
  );
  renameSync(sourcePath, archivePath);
  return archivePath;
}

function atomicReplace(targetPath, contents) {
  const directory = path.dirname(targetPath);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx");
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, targetPath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function mapFileError(error, operation) {
  const systemCode =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : undefined;
  let code = operation === "read" ? "read-failed" : "write-failed";
  if (systemCode === "ENOSPC") code = "disk-full";
  if (systemCode === "EDQUOT") code = "quota-exceeded";
  if (
    systemCode === "EACCES" ||
    systemCode === "EPERM" ||
    systemCode === "EROFS"
  ) {
    code = "permission-denied";
  }
  return {
    code,
    message:
      operation === "read"
        ? "The save generation could not be read"
        : operation === "archive"
          ? "The existing save could not be archived"
          : "The save generation could not be written",
    retryable:
      code === "disk-full" ||
      code === "quota-exceeded" ||
      code === "permission-denied" ||
      code === "read-failed" ||
      code === "write-failed",
    ...(systemCode &&
    new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS", "EIO"]).has(
      systemCode,
    )
      ? { systemCode }
      : {}),
  };
}

function withCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  AUTOSAVE_FORMAT,
  AUTOSAVE_VERSION,
  MAX_AUTOSAVE_PAYLOAD_BYTES,
  MAX_AUTOSAVE_REPLAY_BYTES,
  MAX_AUTOSAVE_REPLAY_DEPTH,
  MAX_AUTOSAVE_REPLAY_NODES,
  CURRENT_FILENAME,
  LAST_KNOWN_GOOD_FILENAME,
  PREVIOUS_FILENAME,
  createAutosaveRecord,
  createDiagnosticExport,
  loadAutosaveGeneration,
  parseAutosaveRecord,
  probeAutosaveGenerations,
  readSaveForExport,
  restoreAutosaveGeneration,
  startFreshAutosave,
  writeAutosaveGeneration,
};
