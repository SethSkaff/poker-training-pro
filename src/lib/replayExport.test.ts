import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCareerTournamentRunner,
  createTournamentRunnerReplay,
} from "../modes/tournamentRunner";

const require = createRequire(import.meta.url);
const replayExport = require("../../electron/replay-export.cjs") as {
  MAX_REPLAY_EXPORT_BYTES: number;
  createPublicReplayArtifact(source: unknown, buildVersion?: string):
    | { ok: true; serialized: string }
    | { ok: false; error: { code: string } };
  createDeveloperReplayArtifact(source: unknown, buildVersion?: string):
    | { ok: true; serialized: string }
    | { ok: false; error: { code: string } };
  createReplayExportController(options: {
    selectDestination(input: {
      kind: "public" | "developer";
      defaultName: string;
    }): Promise<{ canceled: boolean; filePath?: string }>;
    writeArtifact?: (destination: string, serialized: string) => void;
    isPackaged: boolean;
    isProduction: boolean;
    developerFlagEnabled: boolean;
    buildVersion: string;
  }): {
    exportPublicReplay(source: unknown): Promise<ExportResult>;
    exportDeveloperReplay(source: unknown): Promise<ExportResult>;
    isDeveloperExportEnabled(): boolean;
  };
  writeArtifactAtomic(destination: string, serialized: string): void;
};

type ExportResult =
  | { ok: true; fileName: string; kind: string }
  | { ok: false; error: { code: string; systemCode?: string } };

const temporaryDirectories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), "poker-training-pro-replay-export-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function replay(overrides: Record<string, unknown> = {}) {
  return {
    format: "poker-training-pro-tournament-replay",
    version: 1,
    engineVersion: "tournament-session-v1",
    contentVersion: "career-events-v1",
    policyVersion: "normal-rational-v4",
    policySimulations: 60,
    kind: "career",
    eventId: "local-qualifier",
    mode: "normal",
    seed: "private-deterministic-seed",
    hero: {
      id: "hero-private-id",
      name: "Free Form Player Name",
      rating: 1042,
    },
    careerResults: [
      {
        eventId: "prior-event",
        finishPlace: 2,
        fieldSize: 6,
        sourceFieldSize: 120,
        qualifyingPlaces: 3,
        qualified: true,
        tournamentEloDelta: 12,
      },
    ],
    blindSchedule: [
      {
        level: 1,
        smallBlind: 50,
        bigBlind: 100,
        bigBlindAnte: 0,
        durationMs: 600_000,
      },
    ],
    actions: [
      {
        request: {
          action: "raise",
          raiseTo: 300,
          decisionElapsedMs: 1250,
        },
        nowMs: 1_720_000_000_000,
      },
    ],
    ...overrides,
  };
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

describe("player-safe public replay artifact", () => {
  it("accepts the current engine replay contract", () => {
    const runner = createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero: { id: "hero", name: "Engine Player", rating: 1000 },
      mode: "normal",
      seed: "replay-export-engine-contract",
    });

    expect(
      replayExport.createPublicReplayArtifact(
        createTournamentRunnerReplay(runner),
        "0.1.0",
      ),
    ).toMatchObject({ ok: true });
  });

  it("allowlists public fields and strips hidden, identifying, path, and free-form data", () => {
    const source = replay({
      holeCards: ["As", "Ah"],
      opponentCards: ["Ks", "Kh"],
      deck: ["2c"],
      localPath: "C:\\Users\\Private\\save.json",
      userComment: "free form bug description",
      actions: [
        {
          request: {
            action: "raise",
            raiseTo: 300,
            decisionElapsedMs: 1250,
            hiddenCards: ["As"],
            freeFormNote: "private tell",
          },
          nowMs: 1_720_000_000_000,
        },
      ],
    });

    const result = replayExport.createPublicReplayArtifact(source, "0.1.0");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const artifact = JSON.parse(result.serialized) as Record<string, unknown>;
    expect(artifact).toMatchObject({
      format: "poker-training-pro-public-replay",
      version: 1,
      buildVersion: "0.1.0",
      tournament: {
        eventId: "local-qualifier",
        mode: "normal",
        heroRating: 1042,
      },
      actions: [
        {
          sequence: 0,
          action: "raise",
          raiseTo: 300,
          decisionElapsedMs: 1250,
        },
      ],
    });
    for (const secret of [
      "private-deterministic-seed",
      "hero-private-id",
      "Free Form Player Name",
      "holeCards",
      "opponentCards",
      "deck",
      "C:\\Users\\Private",
      "free form bug description",
      "private tell",
      "1720000000000",
    ]) {
      expect(result.serialized, secret).not.toContain(secret);
    }
  });

  it("rejects invalid schema and oversized inputs before opening a picker", async () => {
    expect(
      replayExport.createPublicReplayArtifact(
        replay({ policyVersion: "normal-rational-v2" }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-replay" },
    });
    expect(
      replayExport.createPublicReplayArtifact(
        replay({
          actions: [{ request: { action: "teleport" }, nowMs: 10 }],
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-replay" },
    });
    expect(
      replayExport.createPublicReplayArtifact(
        replay({
          ignoredOversizedField: "x".repeat(
            replayExport.MAX_REPLAY_EXPORT_BYTES + 1,
          ),
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "replay-too-large" },
    });

    const selectDestination = vi.fn();
    const controller = replayExport.createReplayExportController({
      selectDestination,
      isPackaged: false,
      isProduction: false,
      developerFlagEnabled: false,
      buildVersion: "0.1.0",
    });
    await expect(
      controller.exportPublicReplay({ format: "foreign" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-replay" },
    });
    expect(selectDestination).not.toHaveBeenCalled();
  });
});

describe("privileged deterministic developer replay", () => {
  it.each([
    { isPackaged: true, isProduction: false, developerFlagEnabled: true },
    { isPackaged: false, isProduction: true, developerFlagEnabled: true },
    { isPackaged: false, isProduction: false, developerFlagEnabled: false },
  ])("fails closed unless every development gate is satisfied", async (gate) => {
    const selectDestination = vi.fn();
    const controller = replayExport.createReplayExportController({
      selectDestination,
      ...gate,
      buildVersion: "0.1.0",
    });

    expect(controller.isDeveloperExportEnabled()).toBe(false);
    await expect(
      controller.exportDeveloperReplay(replay()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "developer-export-disabled" },
    });
    expect(selectDestination).not.toHaveBeenCalled();
  });

  it("exports canonical deterministic source only under the explicit development gate", async () => {
    const directory = tempDirectory();
    const destination = path.join(directory, "developer-replay.json");
    const selectDestination = vi.fn(async () => ({
      canceled: false,
      filePath: destination,
    }));
    const controller = replayExport.createReplayExportController({
      selectDestination,
      isPackaged: false,
      isProduction: false,
      developerFlagEnabled: true,
      buildVersion: "0.1.0",
    });

    await expect(
      controller.exportDeveloperReplay(replay()),
    ).resolves.toMatchObject({
      ok: true,
      fileName: "developer-replay.json",
      kind: "developer",
    });
    const artifact = JSON.parse(readFileSync(destination, "utf8")) as {
      format: string;
      replay: Record<string, unknown>;
    };
    expect(artifact.format).toBe(
      "poker-training-pro-developer-replay",
    );
    expect(artifact.replay).toMatchObject({
      seed: "private-deterministic-seed",
      hero: {
        id: "hero-private-id",
        name: "Free Form Player Name",
      },
      actions: [{ nowMs: 1_720_000_000_000 }],
    });
    const first = replayExport.createDeveloperReplayArtifact(
      replay(),
      "0.1.0",
    );
    const second = replayExport.createDeveloperReplayArtifact(
      replay(),
      "0.1.0",
    );
    expect(first).toEqual(second);
  });
});

describe("native replay destination and atomic write failures", () => {
  it("returns cancellation without writing", async () => {
    const writeArtifact = vi.fn();
    const controller = replayExport.createReplayExportController({
      selectDestination: async () => ({ canceled: true }),
      writeArtifact,
      isPackaged: false,
      isProduction: false,
      developerFlagEnabled: false,
      buildVersion: "0.1.0",
    });

    await expect(
      controller.exportPublicReplay(replay()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(writeArtifact).not.toHaveBeenCalled();
  });

  it("redacts write errors to a stable code without returning a path", async () => {
    const privatePath = "C:\\Users\\Private\\replay.json";
    const controller = replayExport.createReplayExportController({
      selectDestination: async () => ({
        canceled: false,
        filePath: privatePath,
      }),
      writeArtifact: () => {
        throw Object.assign(new Error(`ENOSPC at ${privatePath}`), {
          code: "ENOSPC",
        });
      },
      isPackaged: false,
      isProduction: false,
      developerFlagEnabled: false,
      buildVersion: "0.1.0",
    });

    const result = await controller.exportPublicReplay(replay());
    expect(result).toMatchObject({
      ok: false,
      error: { code: "disk-full", systemCode: "ENOSPC" },
    });
    expect(JSON.stringify(result)).not.toContain(privatePath);
  });

  it("atomically replaces an existing artifact without temporary residue", () => {
    const directory = tempDirectory();
    const destination = path.join(directory, "public-replay.json");
    writeFileSync(destination, "old", "utf8");
    const artifact = replayExport.createPublicReplayArtifact(
      replay(),
      "0.1.0",
    );
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;

    replayExport.writeArtifactAtomic(destination, artifact.serialized);

    expect(readFileSync(destination, "utf8")).toBe(artifact.serialized);
    expect(readdirSync(directory).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("keeps paths in main and enforces the development flag outside the renderer", () => {
    const main = readFileSync(
      path.resolve("electron/main.cjs"),
      "utf8",
    );
    const preload = readFileSync(
      path.resolve("electron/preload.cjs"),
      "utf8",
    );

    expect(main).toContain(
      'process.env.POKER_TRAINING_PRO_DEVELOPER_REPLAY_EXPORT === "1"',
    );
    expect(main).toContain("isPackaged: app.isPackaged");
    expect(main).toContain('process.env.NODE_ENV === "production"');
    expect(main).toContain('ipcMain.handle("replay:exportPublic"');
    expect(main).toContain('ipcMain.handle("replay:exportDeveloper"');
    expect(preload).toContain("exportPublicReplay: (replay)");
    expect(preload).toContain("exportDeveloperReplay: (replay)");
    expect(preload).not.toContain("replayDestination");
    expect(preload).not.toContain("replayPath");
  });
});
