const {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

const PUBLIC_REPLAY_FORMAT = "poker-training-pro-public-replay";
const DEVELOPER_REPLAY_FORMAT = "poker-training-pro-developer-replay";
const REPLAY_EXPORT_VERSION = 1;
const SOURCE_REPLAY_FORMAT = "poker-training-pro-tournament-replay";
const MAX_REPLAY_EXPORT_BYTES = 2 * 1024 * 1024;
const MAX_REPLAY_ACTIONS = 10_000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_SEED_LENGTH = 256;
const MAX_HERO_NAME_LENGTH = 48;
const MAX_SAFE_AMOUNT = 1_000_000_000_000;
const ACTIONS = new Set(["fold", "check", "call", "raise", "all-in"]);
const MODES = new Set(["normal", "rational"]);
const KINDS = new Set(["career", "timed"]);

function createReplayExportController(options) {
  if (!options || typeof options.selectDestination !== "function") {
    throw new TypeError("A replay destination picker is required");
  }
  const writeArtifact =
    typeof options.writeArtifact === "function"
      ? options.writeArtifact
      : writeArtifactAtomic;
  const developerExportEnabled =
    options.isPackaged === false &&
    options.isProduction !== true &&
    options.developerFlagEnabled === true;
  const buildVersion =
    typeof options.buildVersion === "string" &&
    /^[0-9A-Za-z.+-]{1,64}$/.test(options.buildVersion)
      ? options.buildVersion
      : "unknown";

  async function exportPublicReplay(source) {
    const artifact = createPublicReplayArtifact(source, buildVersion);
    if (!artifact.ok) return artifact;
    return selectAndWrite(
      "public",
      "poker-training-pro-public-replay.json",
      artifact.serialized,
    );
  }

  async function exportDeveloperReplay(source) {
    if (!developerExportEnabled) {
      return failure(
        "developer-export-disabled",
        "Developer replay export is unavailable in this build.",
      );
    }
    const artifact = createDeveloperReplayArtifact(source, buildVersion);
    if (!artifact.ok) return artifact;
    return selectAndWrite(
      "developer",
      "poker-training-pro-developer-replay.json",
      artifact.serialized,
    );
  }

  async function selectAndWrite(kind, defaultName, serialized) {
    let selection;
    try {
      selection = await options.selectDestination({ kind, defaultName });
    } catch (error) {
      return { ok: false, error: mapFileError(error, "picker") };
    }
    if (
      !selection ||
      selection.canceled === true ||
      typeof selection.filePath !== "string" ||
      selection.filePath.length === 0
    ) {
      return failure("cancelled", "The replay export was cancelled.");
    }
    try {
      writeArtifact(selection.filePath, serialized);
      return {
        ok: true,
        fileName: path.basename(selection.filePath),
        kind,
      };
    } catch (error) {
      return { ok: false, error: mapFileError(error, "write") };
    }
  }

  return Object.freeze({
    exportPublicReplay,
    exportDeveloperReplay,
    isDeveloperExportEnabled: () => developerExportEnabled,
  });
}

function createPublicReplayArtifact(source, buildVersion = "unknown") {
  const replay = validateAndCanonicalizeReplay(source);
  if (!replay.ok) return replay;
  const publicReplay = {
    format: PUBLIC_REPLAY_FORMAT,
    version: REPLAY_EXPORT_VERSION,
    buildVersion,
    sourceVersions: {
      engine: replay.value.engineVersion,
      content: replay.value.contentVersion,
      policy: replay.value.policyVersion,
    },
    tournament: {
      kind: replay.value.kind,
      eventId: replay.value.eventId,
      mode: replay.value.mode,
      policySimulations: replay.value.policySimulations,
      heroRating: replay.value.hero.rating,
      priorResults: replay.value.careerResults,
      blindSchedule: replay.value.blindSchedule,
      ...(replay.value.timed
        ? { durationMinutes: replay.value.timed.durationMinutes }
        : {}),
    },
    actions: replay.value.actions.map((entry, sequence) => ({
      sequence,
      action: entry.request.action,
      ...(entry.request.raiseTo === undefined
        ? {}
        : { raiseTo: entry.request.raiseTo }),
      ...(entry.request.decisionElapsedMs === undefined
        ? {}
        : { decisionElapsedMs: entry.request.decisionElapsedMs }),
    })),
  };
  return serializeBounded(publicReplay);
}

function createDeveloperReplayArtifact(source, buildVersion = "unknown") {
  const replay = validateAndCanonicalizeReplay(source);
  if (!replay.ok) return replay;
  return serializeBounded({
    format: DEVELOPER_REPLAY_FORMAT,
    version: REPLAY_EXPORT_VERSION,
    buildVersion,
    replay: replay.value,
  });
}

function validateAndCanonicalizeReplay(source) {
  const safety = validateJsonSafety(source);
  if (!safety.ok) return safety;
  if (
    !isRecord(source) ||
    source.format !== SOURCE_REPLAY_FORMAT ||
    source.version !== 1 ||
    source.engineVersion !== "tournament-session-v1" ||
    source.contentVersion !== "career-events-v1" ||
    source.policyVersion !== "normal-rational-v1" ||
    !boundedInteger(source.policySimulations, 1, 10_000) ||
    !KINDS.has(source.kind) ||
    !validIdentifier(source.eventId) ||
    !MODES.has(source.mode) ||
    !validSeed(source.seed) ||
    !isRecord(source.hero) ||
    !validIdentifier(source.hero.id) ||
    typeof source.hero.name !== "string" ||
    source.hero.name.length === 0 ||
    source.hero.name.length > MAX_HERO_NAME_LENGTH ||
    !boundedFinite(source.hero.rating, -100_000, 100_000) ||
    !Array.isArray(source.careerResults) ||
    !Array.isArray(source.blindSchedule) ||
    !Array.isArray(source.actions) ||
    source.actions.length > MAX_REPLAY_ACTIONS
  ) {
    return failure("invalid-replay", "The replay schema is invalid.");
  }

  const careerResults = [];
  for (const result of source.careerResults) {
    const validated = validateCareerResult(result);
    if (!validated) {
      return failure("invalid-replay", "The replay results are invalid.");
    }
    careerResults.push(validated);
  }
  const blindSchedule = [];
  for (const level of source.blindSchedule) {
    const validated = validateBlindLevel(level);
    if (!validated) {
      return failure("invalid-replay", "The blind schedule is invalid.");
    }
    blindSchedule.push(validated);
  }
  const actions = [];
  for (const entry of source.actions) {
    const validated = validateReplayAction(entry);
    if (!validated) {
      return failure("invalid-replay", "A replay action is invalid.");
    }
    actions.push(validated);
  }

  let timed;
  if (source.kind === "timed") {
    if (
      !isRecord(source.timed) ||
      !boundedInteger(source.timed.durationMinutes, 5, 24 * 60) ||
      !boundedInteger(source.timed.startedAtMs, 0, Number.MAX_SAFE_INTEGER)
    ) {
      return failure("invalid-replay", "Timed replay metadata is invalid.");
    }
    timed = {
      durationMinutes: source.timed.durationMinutes,
      startedAtMs: source.timed.startedAtMs,
    };
  } else if (source.timed !== undefined) {
    return failure("invalid-replay", "Career replay metadata is invalid.");
  }

  return {
    ok: true,
    value: {
      format: SOURCE_REPLAY_FORMAT,
      version: 1,
      engineVersion: source.engineVersion,
      contentVersion: source.contentVersion,
      policyVersion: source.policyVersion,
      policySimulations: source.policySimulations,
      kind: source.kind,
      eventId: source.eventId,
      mode: source.mode,
      seed: source.seed,
      hero: {
        id: source.hero.id,
        name: source.hero.name,
        rating: source.hero.rating,
      },
      careerResults,
      blindSchedule,
      actions,
      ...(timed ? { timed } : {}),
    },
  };
}

function validateCareerResult(value) {
  if (
    !isRecord(value) ||
    !validIdentifier(value.eventId) ||
    !boundedInteger(value.finishPlace, 1, 1_000_000) ||
    !boundedInteger(value.fieldSize, 1, 1_000_000) ||
    !boundedInteger(value.sourceFieldSize, 1, 1_000_000) ||
    !boundedInteger(value.qualifyingPlaces, 1, 1_000_000) ||
    typeof value.qualified !== "boolean" ||
    !boundedFinite(value.tournamentEloDelta, -100_000, 100_000)
  ) {
    return undefined;
  }
  return {
    eventId: value.eventId,
    finishPlace: value.finishPlace,
    fieldSize: value.fieldSize,
    sourceFieldSize: value.sourceFieldSize,
    qualifyingPlaces: value.qualifyingPlaces,
    qualified: value.qualified,
    tournamentEloDelta: value.tournamentEloDelta,
  };
}

function validateBlindLevel(value) {
  if (
    !isRecord(value) ||
    !boundedInteger(value.level, 1, 100_000) ||
    !boundedInteger(value.smallBlind, 0, MAX_SAFE_AMOUNT) ||
    !boundedInteger(value.bigBlind, 1, MAX_SAFE_AMOUNT) ||
    value.bigBlind < value.smallBlind ||
    !boundedInteger(value.bigBlindAnte, 0, MAX_SAFE_AMOUNT) ||
    !boundedInteger(value.durationMs, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return undefined;
  }
  return {
    level: value.level,
    smallBlind: value.smallBlind,
    bigBlind: value.bigBlind,
    bigBlindAnte: value.bigBlindAnte,
    durationMs: value.durationMs,
  };
}

function validateReplayAction(value) {
  if (
    !isRecord(value) ||
    !isRecord(value.request) ||
    !ACTIONS.has(value.request.action) ||
    !boundedInteger(value.nowMs, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return undefined;
  }
  const raiseTo = value.request.raiseTo;
  const decisionElapsedMs = value.request.decisionElapsedMs;
  if (
    (raiseTo !== undefined &&
      !boundedInteger(raiseTo, 0, MAX_SAFE_AMOUNT)) ||
    (decisionElapsedMs !== undefined &&
      !boundedInteger(decisionElapsedMs, 0, 24 * 60 * 60 * 1000))
  ) {
    return undefined;
  }
  return {
    request: {
      action: value.request.action,
      ...(raiseTo === undefined ? {} : { raiseTo }),
      ...(decisionElapsedMs === undefined ? {} : { decisionElapsedMs }),
    },
    nowMs: value.nowMs,
  };
}

function validateJsonSafety(value) {
  const ancestors = new Set();
  let nodes = 0;
  function visit(item, depth) {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      return failure("replay-too-large", "The replay is too large.");
    }
    if (
      item === null ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      return { ok: true };
    }
    if (typeof item === "string") {
      return item.length <= MAX_REPLAY_EXPORT_BYTES
        ? { ok: true }
        : failure("replay-too-large", "The replay is too large.");
    }
    if (
      typeof item !== "object" ||
      (!Array.isArray(item) && !isRecord(item))
    ) {
      return failure("invalid-replay", "The replay contains invalid data.");
    }
    if (ancestors.has(item)) {
      return failure("invalid-replay", "The replay contains cyclic data.");
    }
    ancestors.add(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) {
      const result = visit(child, depth + 1);
      if (!result.ok) return result;
    }
    ancestors.delete(item);
    return { ok: true };
  }
  return visit(value, 0);
}

function serializeBounded(value) {
  const serialized = `${stableStringify(value)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPLAY_EXPORT_BYTES) {
    return failure("replay-too-large", "The replay export is too large.");
  }
  return { ok: true, serialized };
}

function writeArtifactAtomic(destination, serialized) {
  if (
    typeof destination !== "string" ||
    destination.length === 0 ||
    typeof serialized !== "string" ||
    serialized.length === 0 ||
    Buffer.byteLength(serialized, "utf8") > MAX_REPLAY_EXPORT_BYTES
  ) {
    throw new TypeError("Replay export write request is invalid");
  }
  const targetPath = path.resolve(destination);
  const directory = path.dirname(targetPath);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx");
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, targetPath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function mapFileError(error, operation) {
  const systemCode =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : undefined;
  let code = operation === "picker" ? "picker-failed" : "write-failed";
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
      operation === "picker"
        ? "The replay destination could not be selected."
        : "The replay could not be written.",
    retryable: true,
    ...(systemCode &&
    new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS", "EIO"]).has(
      systemCode,
    )
      ? { systemCode }
      : {}),
  };
}

function stableStringify(value) {
  return JSON.stringify(sortJsonValue(value));
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

function validIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    /^[0-9A-Za-z._:-]+$/.test(value)
  );
}

function validSeed(value) {
  return (
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_SEED_LENGTH) ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      Math.abs(value) <= MAX_SAFE_AMOUNT)
  );
}

function boundedFinite(value, minimum, maximum) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
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

function failure(code, message) {
  return { ok: false, error: { code, message, retryable: false } };
}

module.exports = {
  DEVELOPER_REPLAY_FORMAT,
  MAX_REPLAY_EXPORT_BYTES,
  PUBLIC_REPLAY_FORMAT,
  REPLAY_EXPORT_VERSION,
  createDeveloperReplayArtifact,
  createPublicReplayArtifact,
  createReplayExportController,
  validateAndCanonicalizeReplay,
  writeArtifactAtomic,
};
