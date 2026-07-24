import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const crashLoop = require("../../electron/crash-loop.cjs") as {
  DEFAULT_DECAY_MS: number;
  MARKER_FILENAME: string;
  MAX_MARKER_BYTES: number;
  createCrashLoopController(options: {
    directory: string;
    clock?: () => number;
    failureThreshold?: number;
    decayMs?: number;
    healthySessionMs?: number;
  }): CrashLoopController;
  readMarker(markerPath: string):
    | { ok: true; value: CrashLoopMarker }
    | { ok: false; error: { code: string } };
};

interface CrashLoopController {
  getPublicState(): {
    available: boolean;
    active: boolean;
    reason?: string;
    failureCount: number;
    recoveryMarkerRecovered: boolean;
  };
  getHealthySessionMs(): number;
  markHealthySession(): void;
  recordNormalQuit(): void;
  recordRendererFailure(): number;
}

interface CrashLoopMarker {
  format: string;
  version: number;
  consecutiveFailures: number;
  sessionPending: boolean;
  lastFailureAt?: number;
  lastFailureKind?: string;
}

const temporaryDirectories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), "poker-training-pro-crash-loop-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function create(
  directory: string,
  now: () => number,
): CrashLoopController {
  return crashLoop.createCrashLoopController({
    directory,
    clock: now,
    failureThreshold: 3,
    decayMs: 1_000,
    healthySessionMs: 50,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(tmpdir()))) {
      throw new Error(`Refusing to remove unexpected test path ${resolved}`);
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

describe("Electron crash-loop recovery marker", () => {
  it("selects safe mode only after the repeated-startup threshold", () => {
    const directory = tempDirectory();
    let time = 100;
    const now = () => time;

    expect(create(directory, now).getPublicState()).toMatchObject({
      available: true,
      active: false,
      failureCount: 0,
    });
    time += 10;
    expect(create(directory, now).getPublicState()).toMatchObject({
      active: false,
      failureCount: 1,
    });
    time += 10;
    expect(create(directory, now).getPublicState()).toMatchObject({
      active: false,
      failureCount: 2,
    });
    time += 10;
    expect(create(directory, now).getPublicState()).toMatchObject({
      active: true,
      reason: "repeated-startup-failures",
      failureCount: 3,
    });
  });

  it("counts renderer failures for safe mode on the next launch", () => {
    const directory = tempDirectory();
    let time = 200;
    const now = () => time;
    const session = create(directory, now);

    session.recordRendererFailure();
    session.recordRendererFailure();
    session.recordRendererFailure();
    session.recordNormalQuit();
    time += 10;

    expect(create(directory, now).getPublicState()).toMatchObject({
      active: true,
      reason: "repeated-renderer-failures",
      failureCount: 3,
    });
  });

  it("does not count a normal quit as a startup failure", () => {
    const directory = tempDirectory();
    let time = 300;
    const now = () => time;
    create(directory, now).recordNormalQuit();
    time += 10;

    expect(create(directory, now).getPublicState()).toMatchObject({
      active: false,
      failureCount: 0,
    });
  });

  it("resets failure counters after a healthy session", () => {
    const directory = tempDirectory();
    let time = 400;
    const now = () => time;
    const session = create(directory, now);
    session.recordRendererFailure();
    session.recordRendererFailure();
    expect(
      crashLoop.readMarker(path.join(directory, crashLoop.MARKER_FILENAME)),
    ).toMatchObject({
      ok: true,
      value: { consecutiveFailures: 2, sessionPending: true },
    });

    time += session.getHealthySessionMs();
    session.markHealthySession();
    expect(
      crashLoop.readMarker(path.join(directory, crashLoop.MARKER_FILENAME)),
    ).toMatchObject({
      ok: true,
      value: { consecutiveFailures: 0, sessionPending: true },
    });
    session.recordNormalQuit();
    time += 10;
    expect(create(directory, now).getPublicState()).toMatchObject({
      active: false,
      failureCount: 0,
    });
  });

  it("decays stale failures outside the configured window", () => {
    const directory = tempDirectory();
    let time = 500;
    const now = () => time;
    const session = create(directory, now);
    session.recordRendererFailure();
    session.recordRendererFailure();
    session.recordNormalQuit();
    time += 1_001;

    expect(create(directory, now).getPublicState()).toMatchObject({
      active: false,
      failureCount: 0,
    });
  });

  it("recovers a corrupt or oversized marker into a bounded valid marker", () => {
    const directory = tempDirectory();
    const markerPath = path.join(directory, crashLoop.MARKER_FILENAME);
    writeFileSync(markerPath, "x".repeat(crashLoop.MAX_MARKER_BYTES + 1), "utf8");

    const state = create(directory, () => 600).getPublicState();

    expect(state).toMatchObject({
      active: false,
      failureCount: 0,
      recoveryMarkerRecovered: true,
    });
    expect(crashLoop.readMarker(markerPath)).toMatchObject({
      ok: true,
      value: {
        format: "poker-training-pro-crash-loop",
        version: 1,
        sessionPending: true,
      },
    });
    expect(statSync(markerPath).size).toBeLessThan(crashLoop.MAX_MARKER_BYTES);
    expect(readdirSync(directory).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("stores only allowlisted crash metadata without paths or player data", () => {
    const directory = tempDirectory();
    const session = create(directory, () => 700);
    session.recordRendererFailure();
    const raw = readFileSync(
      path.join(directory, crashLoop.MARKER_FILENAME),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual(
      [
        "consecutiveFailures",
        "format",
        "lastFailureAt",
        "lastFailureKind",
        "lastStartupAt",
        "sessionPending",
        "version",
      ].sort(),
    );
    expect(raw).not.toContain(directory);
    expect(raw).not.toContain("player");
    expect(raw).not.toContain("save");
  });

  it("keeps hardware and renderer integration pre-ready and read-only", () => {
    const main = readFileSync(
      path.resolve("electron/main.cjs"),
      "utf8",
    );
    const preload = readFileSync(
      path.resolve("electron/preload.cjs"),
      "utf8",
    );

    expect(main.indexOf("app.disableHardwareAcceleration()")).toBeGreaterThan(
      -1,
    );
    expect(main.indexOf("app.disableHardwareAcceleration()")).toBeLessThan(
      main.indexOf("app.whenReady()"),
    );
    expect(main).toContain('ipcMain.handle("recovery:getSafeModeState"');
    expect(main).toContain("crashLoopController.recordRendererFailure()");
    expect(main).toContain("crashLoopController.recordNormalQuit()");
    expect(preload).toContain(
      'getSafeModeState: () =>\n    ipcRenderer.invoke("recovery:getSafeModeState")',
    );
    expect(preload).not.toContain("setSafeMode");
  });
});
