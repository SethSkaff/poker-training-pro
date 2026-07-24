import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  createLocalLogger,
  redactValue,
}: {
  createLocalLogger: (options: Record<string, unknown>) => {
    log: (
      level: string,
      event: string,
      fields?: Record<string, unknown>,
    ) => unknown;
    list: () => Array<{ file: string; bytes: number }>;
    createDiagnostics: (metadata?: Record<string, unknown>) => string;
    exportDiagnostics: (
      destination: string,
      metadata?: Record<string, unknown>,
    ) => { records: number; bytes: number };
  };
  redactValue: (value: unknown, seen: WeakSet<object>) => unknown;
} = require("../../electron/local-logger.cjs");

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("bounded local logger", () => {
  it("redacts credentials, local paths, hole cards, answers, and emails", () => {
    const redacted = redactValue(
      {
        token: "abc",
        nested: {
          message:
            "Open C:\\Users\\Player\\Saved Games\\save.json for person@example.com",
          holeCards: ["As", "Kh"],
          freeFormAnswer: "33%",
          authorization: "Bearer secret-token",
        },
      },
      new WeakSet(),
    ) as Record<string, unknown>;

    expect(redacted.token).toBe("[REDACTED]");
    expect(JSON.stringify(redacted)).not.toContain("Player");
    expect(JSON.stringify(redacted)).not.toContain("person@example.com");
    expect(JSON.stringify(redacted)).not.toContain("As");
    expect(JSON.stringify(redacted)).not.toContain("33%");
    expect(JSON.stringify(redacted)).not.toContain("secret-token");
  });

  it("writes versioned JSON lines and rotates within its disk bound", () => {
    const directory = temporaryDirectory();
    let tick = 0;
    const logger = createLocalLogger({
      directory,
      maxFileBytes: 480,
      maxFiles: 3,
      buildVersion: "0.1.0",
      engineVersion: "trainer-1.0",
      clock: () => new Date(1_800_000_000_000 + tick++ * 1_000),
    });

    for (let index = 0; index < 20; index += 1) {
      logger.log("info", "test-event", {
        index,
        note: "A bounded, non-user diagnostic field.",
      });
    }

    const files = logger.list();
    expect(files.length).toBeLessThanOrEqual(3);
    expect(files.every((file) => file.bytes > 0)).toBe(true);
    const records = files.flatMap((file) =>
      readFileSync(join(directory, file.file), "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
    expect(records.every((record) => record.buildVersion === "0.1.0")).toBe(
      true,
    );
    expect(records.every((record) => record.engineVersion === "trainer-1.0")).toBe(
      true,
    );
  });

  it("exports already-redacted records and tolerates one corrupt log line", () => {
    const directory = temporaryDirectory();
    const logger = createLocalLogger({
      directory,
      buildVersion: "0.1.0",
      engineVersion: "trainer-1.0",
      clock: () => new Date("2027-01-15T12:00:00.000Z"),
    });
    logger.log("error", "renderer-gone", {
      path: "C:\\Users\\Player\\private",
      reason: "crashed",
    });
    writeFileSync(
      join(directory, "poker-training-pro-old.log"),
      "{not valid JSON}\n",
      "utf8",
    );
    const destination = join(directory, "diagnostics.json");

    const result = logger.exportDiagnostics(destination, {
      email: "person@example.com",
      platform: "win32",
    });
    const exported = readFileSync(destination, "utf8");

    expect(result.records).toBe(2);
    expect(exported).toContain("unreadable-log-line");
    expect(exported).toContain('"platform": "win32"');
    expect(exported).not.toContain("Player");
    expect(exported).not.toContain("person@example.com");
    expect(JSON.parse(logger.createDiagnostics({ platform: "win32" }))).toMatchObject({
      schemaVersion: 1,
      buildVersion: "0.1.0",
      engineVersion: "trainer-1.0",
      metadata: { platform: "win32" },
    });
  });

  it("validates levels, events, and size limits", () => {
    const directory = temporaryDirectory();
    const logger = createLocalLogger({ directory });

    expect(() => logger.log("fatal", "event")).toThrow(/level/i);
    expect(() => logger.log("info", " ")).toThrow(/event/i);
    expect(() =>
      createLocalLogger({ directory, maxFiles: 0 }),
    ).toThrow(/maxFiles/i);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "poker-training-pro-log-"));
  temporaryDirectories.push(directory);
  return directory;
}
