"use strict";

const {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { basename, join } = require("node:path");

const REDACTED = "[REDACTED]";
const PRIVATE_KEY =
  /(?:answer|authorization|card|cookie|credential|email|free.?form|hole|password|path|secret|seed|token|user.?content)/i;

function createLocalLogger(options) {
  const directory = options?.directory;
  if (typeof directory !== "string" || directory.trim().length === 0) {
    throw new TypeError("A log directory is required.");
  }

  const maxFileBytes = positiveInteger(
    options.maxFileBytes ?? 256 * 1024,
    "maxFileBytes",
  );
  const maxFiles = positiveInteger(options.maxFiles ?? 4, "maxFiles");
  const clock = options.clock ?? (() => new Date());
  const activePath = join(directory, "poker-training-pro.log");
  mkdirSync(directory, { recursive: true });
  prune(directory, Math.max(0, maxFiles - 1));

  return Object.freeze({
    log(level, event, fields = {}) {
      if (!["debug", "info", "warn", "error"].includes(level)) {
        throw new TypeError(`Unsupported log level: ${String(level)}`);
      }
      if (typeof event !== "string" || event.trim().length === 0) {
        throw new TypeError("A non-empty log event is required.");
      }

      const record = {
        timestamp: validIsoDate(clock()),
        level,
        event: safeString(event, 96),
        buildVersion: safeString(options.buildVersion ?? "unknown", 64),
        engineVersion: safeString(options.engineVersion ?? "unknown", 64),
        fields: redactValue(fields, new WeakSet()),
      };
      const line = `${JSON.stringify(record)}\n`;
      rotateBeforeAppend(
        directory,
        activePath,
        Buffer.byteLength(line),
        maxFileBytes,
        maxFiles,
        record.timestamp,
      );
      appendFileSync(activePath, line, {
        encoding: "utf8",
        mode: 0o600,
      });
      return record;
    },

    list() {
      return logFiles(directory).map((path) => ({
        file: basename(path),
        bytes: statSync(path).size,
      }));
    },

    createDiagnostics(metadata = {}) {
      return `${JSON.stringify(buildDiagnosticPayload(metadata), null, 2)}\n`;
    },

    exportDiagnostics(destination, metadata = {}) {
      if (
        typeof destination !== "string" ||
        destination.trim().length === 0
      ) {
        throw new TypeError("A diagnostics destination is required.");
      }
      const payload = buildDiagnosticPayload(metadata);
      writeFileSync(destination, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      return {
        destination,
        records: payload.logs.length,
        bytes: statSync(destination).size,
      };
    },
  });

  function buildDiagnosticPayload(metadata) {
    return {
      schemaVersion: 1,
      exportedAt: validIsoDate(clock()),
      buildVersion: safeString(options.buildVersion ?? "unknown", 64),
      engineVersion: safeString(options.engineVersion ?? "unknown", 64),
      metadata: redactValue(metadata, new WeakSet()),
      logs: logFiles(directory).flatMap(readValidRecords),
    };
  }
}

function rotateBeforeAppend(
  directory,
  activePath,
  incomingBytes,
  maxFileBytes,
  maxFiles,
  timestamp,
) {
  if (!existsSync(activePath)) return;
  if (statSync(activePath).size + incomingBytes <= maxFileBytes) return;

  const suffix = timestamp
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
  let candidate = join(directory, `poker-training-pro-${suffix}.log`);
  let collision = 1;
  while (existsSync(candidate)) {
    candidate = join(
      directory,
      `poker-training-pro-${suffix}-${collision}.log`,
    );
    collision += 1;
  }
  renameSync(activePath, candidate);
  prune(directory, maxFiles - 1);
}

function prune(directory, maximumRotatedFiles) {
  const rotated = logFiles(directory)
    .filter((path) => basename(path) !== "poker-training-pro.log")
    .sort((left, right) => {
      const modified = statSync(right).mtimeMs - statSync(left).mtimeMs;
      return modified || basename(right).localeCompare(basename(left));
    });
  for (const stale of rotated.slice(Math.max(0, maximumRotatedFiles))) {
    unlinkSync(stale);
  }
}

function logFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^poker-training-pro(?:-.+)?\.log$/.test(name))
    .map((name) => join(directory, name))
    .sort((left, right) => basename(left).localeCompare(basename(right)));
}

function readValidRecords(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [
          {
            timestamp: null,
            level: "warn",
            event: "unreadable-log-line",
            fields: { bytes: Buffer.byteLength(line) },
          },
        ];
      }
    });
}

function redactValue(value, seen, key = "") {
  if (PRIVATE_KEY.test(key)) return REDACTED;
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") return safeString(redactString(value), 512);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactValue(entry, seen));
  }
  if (typeof value !== "object" || value === null) return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  const output = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 100)) {
    output[safeString(entryKey, 64)] = redactValue(entryValue, seen, entryKey);
  }
  seen.delete(value);
  return output;
}

function redactString(value) {
  return value
    .replace(
      /\b[A-Z]:\\(?:Users|Documents and Settings)\\[^\\\s]+(?:\\[^\s"'<>|]*)?/gi,
      "[LOCAL_PATH]",
    )
    .replace(/\/(?:Users|home)\/[^/\s]+(?:\/[^\s"'<>|]*)?/g, "[LOCAL_PATH]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[EMAIL]",
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, REDACTED);
}

function safeString(value, maximumLength) {
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]/g, " ");
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength - 1)}…`;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function validIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new TypeError("Logger clock returned an invalid date.");
  }
  return date.toISOString();
}

module.exports = {
  createLocalLogger,
  redactValue,
};
