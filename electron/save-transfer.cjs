const {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
const {
  CURRENT_FILENAME,
  LAST_KNOWN_GOOD_FILENAME,
  PREVIOUS_FILENAME,
  parseAutosaveRecord,
  probeAutosaveGenerations,
  writeAutosaveGeneration,
} = require("./save-store.cjs");

const SAVE_FORMAT = "poker-training-pro-save";
const CURRENT_SAVE_VERSION = 1;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 20_000;
const MAX_STRING_LENGTH = 16_384;

const DEFAULT_SETTINGS = Object.freeze({
  masterVolume: 100,
  muted: false,
  musicVolume: 35,
  effectsVolume: 70,
  fullscreen: false,
  reducedMotion: false,
  dealSpeed: "standard",
  colorAssist: false,
  cameraSensitivity: "standard",
  cameraView: "standard",
  autoCameraMovement: true,
  menuMotion: "full",
  roomMotion: "full",
  cameraMotion: "full",
  tableMotion: "full",
  transitionMotion: "full",
  interfaceScale: "standard",
});

const DEFAULT_PROGRESS = Object.freeze({
  onboardingCompleted: false,
  playChipsAcknowledged: false,
  playerName: "Player",
  decisionElo: 1000,
  mathElo: 1000,
  tournamentElo: 1000,
  trainingCompleted: 0,
  currentStreak: 0,
  bestStreak: 0,
  totalDecisionMs: 0,
  results: [],
  unlockedCircuit: 1,
});

const ACTIONS = new Set(["fold", "check", "call", "raise", "all-in"]);
const DEAL_SPEEDS = new Set(["cinematic", "standard", "quick"]);
const GENERATION_FILES = Object.freeze({
  current: CURRENT_FILENAME,
  previous: PREVIOUS_FILENAME,
  "last-known-good": LAST_KNOWN_GOOD_FILENAME,
});

function createSaveTransferController(options) {
  if (!options || typeof options.saveDirectory !== "function") {
    throw new TypeError("A save directory provider is required");
  }
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const tokenFactory =
    typeof options.tokenFactory === "function"
      ? options.tokenFactory
      : () => randomBytes(32).toString("base64url");
  const maxImportBytes = positiveInteger(
    options.maxImportBytes,
    MAX_IMPORT_BYTES,
  );
  const confirmationTtlMs = positiveInteger(
    options.confirmationTtlMs,
    CONFIRMATION_TTL_MS,
  );
  const pending = new Map();

  function prepareImportFromPath(filePath) {
    pruneExpired();
    const inspected = inspectImportFile(filePath, { maxImportBytes });
    if (!inspected.ok) return inspected;
    const token = issueToken();
    const expiresAt = clock() + confirmationTtlMs;
    pending.set(token, {
      kind: "import",
      expiresAt,
      filePath: inspected.private.filePath,
      fingerprint: inspected.private.fingerprint,
      serializedSave: inspected.private.serializedSave,
    });
    return {
      ok: true,
      preview: {
        confirmationToken: token,
        expiresAt: new Date(expiresAt).toISOString(),
        migratedFromVersion: inspected.preview.migratedFromVersion,
        trainingCompleted: inspected.preview.trainingCompleted,
        resultCount: inspected.preview.resultCount,
        decisionElo: inspected.preview.decisionElo,
        mathElo: inspected.preview.mathElo,
        tournamentElo: inspected.preview.tournamentElo,
        settingsWillBeReplaced: true,
        progressWillBeReplaced: true,
      },
    };
  }

  function confirmImport(confirmationToken) {
    const prepared = consumeToken(confirmationToken, "import");
    if (!prepared.ok) return prepared;

    const current = inspectImportFile(prepared.value.filePath, {
      maxImportBytes,
    });
    if (!current.ok) {
      return failure(
        "import-changed",
        "The selected save changed after preview. Choose it again.",
      );
    }
    if (
      !sameFingerprint(current.private.fingerprint, prepared.value.fingerprint)
    ) {
      return failure(
        "import-changed",
        "The selected save changed after preview. Choose it again.",
      );
    }

    try {
      preserveValidGeneration(options.saveDirectory());
      const result = writeAutosaveGeneration(
        options.saveDirectory(),
        prepared.value.serializedSave,
        { boundary: "lifecycle" },
      );
      return { ok: true, receipt: saveReceipt(result) };
    } catch (error) {
      return { ok: false, error: mapFileError(error, "write") };
    }
  }

  function prepareProgressReset() {
    pruneExpired();
    const selected = selectValidGeneration(options.saveDirectory());
    if (!selected.ok) return selected;
    const migrated = migrateAndValidateSaveText(selected.record.payload);
    if (!migrated.ok) {
      return failure(
        "invalid-current-save",
        "Current settings could not be read safely, so progress was not reset.",
      );
    }
    const resetSave = stableStringify({
      format: SAVE_FORMAT,
      version: CURRENT_SAVE_VERSION,
      data: {
        settings: migrated.save.data.settings,
        progress: DEFAULT_PROGRESS,
      },
    });
    const token = issueToken();
    const expiresAt = clock() + confirmationTtlMs;
    pending.set(token, {
      kind: "reset-progress",
      expiresAt,
      source: selected.source,
      sourceChecksum: selected.record.checksum,
      serializedSave: resetSave,
    });
    return {
      ok: true,
      preview: {
        confirmationToken: token,
        expiresAt: new Date(expiresAt).toISOString(),
        trainingCompleted: migrated.save.data.progress.trainingCompleted,
        resultCount: migrated.save.data.progress.results.length,
        settingsWillBePreserved: true,
        progressWillBeReset: true,
      },
    };
  }

  function confirmProgressReset(confirmationToken) {
    const prepared = consumeToken(confirmationToken, "reset-progress");
    if (!prepared.ok) return prepared;
    const selected = selectValidGeneration(options.saveDirectory());
    if (
      !selected.ok ||
      selected.source !== prepared.value.source ||
      selected.record.checksum !== prepared.value.sourceChecksum
    ) {
      return failure(
        "save-changed",
        "Progress changed after the reset preview. Review the reset again.",
      );
    }

    try {
      archiveValidGenerations(options.saveDirectory(), "progress-reset");
      const result = writeAutosaveGeneration(
        options.saveDirectory(),
        prepared.value.serializedSave,
        { boundary: "lifecycle" },
      );
      return { ok: true, receipt: saveReceipt(result) };
    } catch (error) {
      return { ok: false, error: mapFileError(error, "archive") };
    }
  }

  function issueToken() {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const token = tokenFactory();
      if (
        typeof token === "string" &&
        token.length >= 16 &&
        token.length <= 256 &&
        !pending.has(token)
      ) {
        return token;
      }
    }
    throw new Error("Could not create a unique save confirmation token");
  }

  function consumeToken(token, expectedKind) {
    if (typeof token !== "string" || token.length < 16 || token.length > 256) {
      return failure(
        "invalid-confirmation",
        "The confirmation request is invalid.",
      );
    }
    const prepared = pending.get(token);
    pending.delete(token);
    if (
      !prepared ||
      prepared.kind !== expectedKind ||
      prepared.expiresAt < clock()
    ) {
      return failure(
        "invalid-confirmation",
        "The confirmation expired or was already used.",
      );
    }
    return { ok: true, value: prepared };
  }

  function pruneExpired() {
    const now = clock();
    for (const [token, item] of pending) {
      if (item.expiresAt < now) pending.delete(token);
    }
  }

  return {
    prepareImportFromPath,
    confirmImport,
    prepareProgressReset,
    confirmProgressReset,
  };
}

function inspectImportFile(filePath, options = {}) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return failure("invalid-import", "No save file was selected.");
  }
  const maxImportBytes = positiveInteger(
    options.maxImportBytes,
    MAX_IMPORT_BYTES,
  );
  let descriptor;
  try {
    descriptor = openSync(path.resolve(filePath), "r");
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      return failure(
        "invalid-import",
        "The selected item is not a regular save file.",
      );
    }
    if (before.size <= 0n || before.size > BigInt(maxImportBytes)) {
      return failure(
        "import-too-large",
        `Save files must be no larger than ${maxImportBytes} bytes.`,
      );
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor, { bigint: true });
    if (
      !sameFileStat(before, after) ||
      Buffer.byteLength(raw, "utf8") > maxImportBytes
    ) {
      return failure(
        "import-changed",
        "The selected save changed while it was being read.",
      );
    }
    const migrated = migrateAndValidateSaveText(raw);
    if (!migrated.ok) return migrated;
    const serializedSave = stableStringify(migrated.save);
    return {
      ok: true,
      preview: createRedactedPreview(migrated),
      private: {
        filePath: path.resolve(filePath),
        serializedSave,
        fingerprint: {
          digest: sha256(raw),
          size: before.size.toString(),
          modifiedNanoseconds: before.mtimeNs.toString(),
          device: before.dev.toString(),
          inode: before.ino.toString(),
        },
      },
    };
  } catch (error) {
    return { ok: false, error: mapFileError(error, "read") };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function migrateAndValidateSaveText(serialized) {
  if (typeof serialized !== "string" || serialized.length === 0) {
    return failure("invalid-json", "The selected save is empty.");
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return failure("invalid-json", "The selected save is not valid JSON.");
  }
  return migrateAndValidateSave(parsed);
}

function migrateAndValidateSave(payload) {
  const jsonSafety = validateJsonSafety(payload);
  if (!jsonSafety.ok) return jsonSafety;
  if (!isRecord(payload)) {
    return failure("invalid-payload", "The save must contain an object.");
  }
  if ("format" in payload && payload.format !== SAVE_FORMAT) {
    return failure(
      "foreign-save",
      "The selected file belongs to another application or save format.",
    );
  }
  if ("version" in payload) {
    if (!Number.isInteger(payload.version) || payload.version < 0) {
      return failure("invalid-payload", "The save version is invalid.");
    }
    if (payload.version > CURRENT_SAVE_VERSION) {
      return failure(
        "future-save",
        "This save was created by a newer version of Poker Training Pro.",
      );
    }
  }

  let settings;
  let progress;
  let migratedFromVersion;
  if (payload.format === SAVE_FORMAT || payload.version === 1) {
    if (
      payload.format !== SAVE_FORMAT ||
      payload.version !== 1 ||
      !isRecord(payload.data) ||
      !isRecord(payload.data.settings) ||
      !isRecord(payload.data.progress)
    ) {
      return failure(
        "invalid-payload",
        "The versioned save is missing settings or progress.",
      );
    }
    settings = validateCurrentSettings(payload.data.settings);
    if (!settings.ok) return settings;
    progress = validateCurrentProgress(payload.data.progress);
    if (!progress.ok) return progress;
    migratedFromVersion = 1;
  } else {
    const legacy =
      payload.version === 0 && isRecord(payload.data) ? payload.data : payload;
    if (
      !isRecord(legacy.settings) ||
      !isRecord(legacy.progress)
    ) {
      return failure(
        "invalid-payload",
        "The legacy save does not contain valid settings and progress.",
      );
    }
    settings = { ok: true, value: normalizeLegacySettings(legacy.settings) };
    progress = { ok: true, value: normalizeLegacyProgress(legacy.progress) };
    migratedFromVersion = 0;
  }

  return {
    ok: true,
    save: {
      format: SAVE_FORMAT,
      version: CURRENT_SAVE_VERSION,
      data: { settings: settings.value, progress: progress.value },
    },
    migratedFromVersion,
  };
}

function validateCurrentSettings(value) {
  const numberFields = ["masterVolume", "musicVolume", "effectsVolume"];
  for (const key of numberFields) {
    if (!finiteBetween(value[key], 0, 100)) {
      return failure("invalid-payload", `The ${key} setting is invalid.`);
    }
  }
  for (const key of [
    "muted",
    "fullscreen",
    "reducedMotion",
    "colorAssist",
  ]) {
    if (typeof value[key] !== "boolean") {
      return failure("invalid-payload", `The ${key} setting is invalid.`);
    }
  }
  if (!DEAL_SPEEDS.has(value.dealSpeed)) {
    return failure("invalid-payload", "The dealSpeed setting is invalid.");
  }
  if (
    (value.cameraSensitivity !== undefined &&
      !["low", "standard", "high"].includes(value.cameraSensitivity)) ||
    (value.cameraView !== undefined &&
      !["close", "standard", "wide"].includes(value.cameraView)) ||
    (value.autoCameraMovement !== undefined &&
      typeof value.autoCameraMovement !== "boolean") ||
    (["menuMotion", "roomMotion", "cameraMotion", "tableMotion", "transitionMotion"].some(
      (key) => value[key] !== undefined && !["full", "reduced", "off"].includes(value[key]),
    )) ||
    (value.interfaceScale !== undefined &&
      !["compact", "standard", "large", "extra-large"].includes(
        value.interfaceScale,
      ))
  ) {
    return failure("invalid-payload", "The camera settings are invalid.");
  }
  return {
    ok: true,
    value: {
      masterVolume: value.masterVolume,
      muted: value.muted,
      musicVolume: value.musicVolume,
      effectsVolume: value.effectsVolume,
      fullscreen: value.fullscreen,
      reducedMotion: value.reducedMotion,
      dealSpeed: value.dealSpeed,
      colorAssist: value.colorAssist,
      // Camera comfort controls were introduced after the first v1 saves.
      // Missing values therefore migrate safely to their defaults, while an
      // explicitly supplied invalid value remains a rejected import.
      cameraSensitivity: ["low", "standard", "high"].includes(
        value.cameraSensitivity,
      )
        ? value.cameraSensitivity
        : DEFAULT_SETTINGS.cameraSensitivity,
      cameraView: ["close", "standard", "wide"].includes(value.cameraView)
        ? value.cameraView
        : DEFAULT_SETTINGS.cameraView,
      autoCameraMovement:
        typeof value.autoCameraMovement === "boolean"
          ? value.autoCameraMovement
          : DEFAULT_SETTINGS.autoCameraMovement,
      menuMotion: normalizeMotionIntensity(value.menuMotion),
      roomMotion: normalizeMotionIntensity(value.roomMotion),
      cameraMotion: normalizeMotionIntensity(value.cameraMotion),
      tableMotion: normalizeMotionIntensity(value.tableMotion),
      transitionMotion: normalizeMotionIntensity(value.transitionMotion),
      interfaceScale: ["compact", "standard", "large", "extra-large"].includes(
        value.interfaceScale,
      )
        ? value.interfaceScale
        : DEFAULT_SETTINGS.interfaceScale,
    },
  };
}

function validateCurrentProgress(value) {
  if (
    typeof value.onboardingCompleted !== "boolean" ||
    typeof value.playChipsAcknowledged !== "boolean" ||
    typeof value.playerName !== "string" ||
    value.playerName.trim().length === 0 ||
    value.playerName.length > 48
  ) {
    return failure("invalid-payload", "The player profile is invalid.");
  }
  for (const key of ["decisionElo", "mathElo", "tournamentElo"]) {
    if (!Number.isFinite(value[key])) {
      return failure("invalid-payload", `The ${key} value is invalid.`);
    }
  }
  for (const key of [
    "trainingCompleted",
    "currentStreak",
    "bestStreak",
    "unlockedCircuit",
  ]) {
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      return failure("invalid-payload", `The ${key} value is invalid.`);
    }
  }
  if (
    !Number.isFinite(value.totalDecisionMs) ||
    value.totalDecisionMs < 0 ||
    !Array.isArray(value.results) ||
    value.results.length > 250
  ) {
    return failure("invalid-payload", "The progress history is invalid.");
  }
  const results = [];
  for (const result of value.results) {
    const validated = validateTrainingResult(result);
    if (!validated.ok) return validated;
    results.push(validated.value);
  }
  return {
    ok: true,
    value: {
      onboardingCompleted: value.onboardingCompleted,
      playChipsAcknowledged: value.playChipsAcknowledged,
      playerName: value.playerName,
      decisionElo: value.decisionElo,
      mathElo: value.mathElo,
      tournamentElo: value.tournamentElo,
      trainingCompleted: value.trainingCompleted,
      currentStreak: value.currentStreak,
      bestStreak: Math.max(value.currentStreak, value.bestStreak),
      totalDecisionMs: value.totalDecisionMs,
      results,
      unlockedCircuit: Math.max(1, value.unlockedCircuit),
    },
  };
}

function validateTrainingResult(value) {
  if (
    !isRecord(value) ||
    typeof value.scenarioId !== "string" ||
    value.scenarioId.length === 0 ||
    value.scenarioId.length > 256 ||
    typeof value.completedAt !== "string" ||
    value.completedAt.length === 0 ||
    value.completedAt.length > 128 ||
    !ACTIONS.has(value.action) ||
    typeof value.actionCorrect !== "boolean" ||
    typeof value.mathCorrect !== "boolean" ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    !Number.isFinite(value.eloDelta) ||
    (value.mathAnswer !== undefined && !Number.isFinite(value.mathAnswer))
  ) {
    return failure("invalid-payload", "A training result is invalid.");
  }
  return {
    ok: true,
    value: {
      scenarioId: value.scenarioId,
      completedAt: value.completedAt,
      action: value.action,
      actionCorrect: value.actionCorrect,
      ...(value.mathAnswer === undefined
        ? {}
        : { mathAnswer: value.mathAnswer }),
      mathCorrect: value.mathCorrect,
      elapsedMs: value.elapsedMs,
      eloDelta: value.eloDelta,
    },
  };
}

function normalizeLegacySettings(value) {
  const source = isRecord(value) ? value : {};
  return {
    masterVolume: boundedNumber(source.masterVolume, 0, 100, 100),
    muted: booleanOr(source.muted, false),
    musicVolume: boundedNumber(source.musicVolume, 0, 100, 35),
    effectsVolume: boundedNumber(source.effectsVolume, 0, 100, 70),
    fullscreen: booleanOr(source.fullscreen, false),
    reducedMotion: booleanOr(source.reducedMotion, false),
    dealSpeed: DEAL_SPEEDS.has(source.dealSpeed)
      ? source.dealSpeed
      : "standard",
    colorAssist: booleanOr(source.colorAssist, false),
    cameraSensitivity:
      source.cameraSensitivity === "low" ||
      source.cameraSensitivity === "standard" ||
      source.cameraSensitivity === "high"
        ? source.cameraSensitivity
        : "standard",
    cameraView:
      source.cameraView === "close" ||
      source.cameraView === "standard" ||
      source.cameraView === "wide"
        ? source.cameraView
        : "standard",
    autoCameraMovement: booleanOr(source.autoCameraMovement, true),
    menuMotion: normalizeMotionIntensity(source.menuMotion),
    roomMotion: normalizeMotionIntensity(source.roomMotion),
    cameraMotion: normalizeMotionIntensity(source.cameraMotion),
    tableMotion: normalizeMotionIntensity(source.tableMotion),
    transitionMotion: normalizeMotionIntensity(source.transitionMotion),
    interfaceScale:
      source.interfaceScale === "compact" ||
      source.interfaceScale === "standard" ||
      source.interfaceScale === "large" ||
      source.interfaceScale === "extra-large"
        ? source.interfaceScale
        : "standard",
  };
}

function normalizeLegacyProgress(value) {
  const source = isRecord(value) ? value : {};
  const results = Array.isArray(source.results)
    ? source.results
        .map((result) => validateTrainingResult(result))
        .filter((result) => result.ok)
        .slice(-250)
        .map((result) => result.value)
    : [];
  const currentStreak = nonNegativeInteger(source.currentStreak, 0);
  return {
    onboardingCompleted: booleanOr(source.onboardingCompleted, false),
    playChipsAcknowledged: booleanOr(source.playChipsAcknowledged, false),
    playerName:
      typeof source.playerName === "string" &&
      source.playerName.trim().length > 0
        ? source.playerName.slice(0, 48)
        : "Player",
    decisionElo: finiteNumber(source.decisionElo, 1000),
    mathElo: finiteNumber(source.mathElo, 1000),
    tournamentElo: finiteNumber(source.tournamentElo, 1000),
    trainingCompleted: nonNegativeInteger(source.trainingCompleted, 0),
    currentStreak,
    bestStreak: Math.max(
      currentStreak,
      nonNegativeInteger(source.bestStreak, 0),
    ),
    totalDecisionMs: Math.max(0, finiteNumber(source.totalDecisionMs, 0)),
    results,
    unlockedCircuit: Math.max(
      1,
      nonNegativeInteger(source.unlockedCircuit, 1),
    ),
  };
}

function validateJsonSafety(value) {
  const ancestors = new Set();
  let nodes = 0;
  function visit(item, depth) {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      return failure("invalid-payload", "The save contains too many values.");
    }
    if (depth > MAX_JSON_DEPTH) {
      return failure("invalid-payload", "The save is nested too deeply.");
    }
    if (
      item === null ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      return { ok: true };
    }
    if (typeof item === "string") {
      return item.length <= MAX_STRING_LENGTH
        ? { ok: true }
        : failure("invalid-payload", "The save contains an oversized value.");
    }
    if (typeof item !== "object") {
      return failure(
        "invalid-payload",
        "The save contains a non-JSON value.",
      );
    }
    if (ancestors.has(item)) {
      return failure("cyclic-save", "The save contains a cyclic value.");
    }
    if (!Array.isArray(item) && !isRecord(item)) {
      return failure(
        "invalid-payload",
        "The save contains an unsupported object.",
      );
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

function createRedactedPreview(migrated) {
  const progress = migrated.save.data.progress;
  return {
    migratedFromVersion: migrated.migratedFromVersion,
    trainingCompleted: progress.trainingCompleted,
    resultCount: progress.results.length,
    decisionElo: progress.decisionElo,
    mathElo: progress.mathElo,
    tournamentElo: progress.tournamentElo,
  };
}

function selectValidGeneration(directory) {
  const probe = probeAutosaveGenerations(directory);
  const selected = probe.generations.find(
    (generation) => generation.exists && generation.record,
  );
  if (!selected) {
    return failure("no-save", "No valid save is available.");
  }
  return { ok: true, source: selected.source, record: selected.record };
}

function preserveValidGeneration(directory) {
  const probe = probeAutosaveGenerations(directory);
  const current = probe.generations.find(
    (generation) => generation.source === "current",
  );
  if (current?.record) return;
  const fallback = probe.generations.find(
    (generation) => generation.exists && generation.record,
  );
  if (!fallback?.record) return;
  atomicReplace(
    path.join(path.resolve(directory), PREVIOUS_FILENAME),
    JSON.stringify(fallback.record),
  );
}

function archiveValidGenerations(directory, reason) {
  const resolvedDirectory = path.resolve(directory);
  const probe = probeAutosaveGenerations(resolvedDirectory);
  for (const generation of probe.generations) {
    if (!generation.record) continue;
    const fileName = GENERATION_FILES[generation.source];
    const raw = readFileSync(path.join(resolvedDirectory, fileName), "utf8");
    const parsed = parseAutosaveRecord(raw);
    if (!parsed.ok) continue;
    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replaceAll(".", "-");
    const archivePath = path.join(
      resolvedDirectory,
      `archive.${reason}.${generation.source}.${timestamp}.${parsed.record.checksum.slice(0, 12)}.json`,
    );
    atomicReplace(archivePath, raw);
  }
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

function sameFingerprint(left, right) {
  return (
    left.digest === right.digest &&
    left.size === right.size &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function sameFileStat(left, right) {
  return (
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function saveReceipt(result) {
  return {
    boundary: result.record.boundary,
    savedAt: result.record.savedAt,
    rotatedPrevious: result.rotatedPrevious,
    ignoredCorruptCurrent: result.ignoredCorruptCurrent,
  };
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
        ? "The selected save could not be read."
        : operation === "archive"
          ? "Existing progress could not be archived safely."
          : "The save could not be written.",
    retryable: true,
    ...(systemCode &&
    new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS", "EIO"]).has(
      systemCode,
    )
      ? { systemCode }
      : {}),
  };
}

function failure(code, message) {
  return { ok: false, error: { code, message, retryable: false } };
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

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boundedNumber(value, minimum, maximum, fallback) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

function nonNegativeInteger(value, fallback) {
  return Math.max(0, Math.trunc(finiteNumber(value, fallback)));
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMotionIntensity(value) {
  return ["full", "reduced", "off"].includes(value)
    ? value
    : "full";
}

function finiteBetween(value, minimum, maximum) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

module.exports = {
  CONFIRMATION_TTL_MS,
  CURRENT_SAVE_VERSION,
  DEFAULT_PROGRESS,
  MAX_IMPORT_BYTES,
  SAVE_FORMAT,
  createSaveTransferController,
  migrateAndValidateSave,
  migrateAndValidateSaveText,
};
