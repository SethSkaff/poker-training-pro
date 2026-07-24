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
import { afterEach, describe, expect, it } from "vitest";
import { restoreSaveBackup, serializeSaveBackup } from "./saveMigration";
import { defaultProgress, defaultSettings } from "./storage";

const require = createRequire(import.meta.url);
const transfer = require("../../electron/save-transfer.cjs") as {
  MAX_IMPORT_BYTES: number;
  createSaveTransferController(options: {
    saveDirectory(): string;
    clock?: () => number;
    tokenFactory?: () => string;
    confirmationTtlMs?: number;
  }): {
    prepareImportFromPath(filePath: string): TransferPreview;
    confirmImport(token: string): TransferCommit;
    prepareProgressReset(): TransferPreview;
    confirmProgressReset(token: string): TransferCommit;
  };
  migrateAndValidateSave(payload: unknown):
    | { ok: true }
    | { ok: false; error: { code: string } };
};
const saveStore = require("../../electron/save-store.cjs") as {
  CURRENT_FILENAME: string;
  LAST_KNOWN_GOOD_FILENAME: string;
  PREVIOUS_FILENAME: string;
  loadAutosaveGeneration(directory: string): {
    ok: boolean;
    record?: { payload: string };
  };
  writeAutosaveGeneration(
    directory: string,
    serializedSave: string,
    options: { boundary: string },
  ): unknown;
};

type TransferPreview =
  | { ok: true; preview: Record<string, unknown> & { confirmationToken: string } }
  | { ok: false; error: { code: string } };

type TransferCommit =
  | { ok: true; receipt: { boundary: string } }
  | { ok: false; error: { code: string } };

const temporaryDirectories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), "poker-training-pro-save-transfer-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function save(
  playerName: string,
  overrides: {
    settings?: Record<string, unknown>;
    progress?: Record<string, unknown>;
  } = {},
): string {
  return serializeSaveBackup(
    { ...defaultSettings, ...overrides.settings },
    { ...defaultProgress, playerName, ...overrides.progress },
  );
}

function controller(directory: string, options: Record<string, unknown> = {}) {
  return transfer.createSaveTransferController({
    saveDirectory: () => directory,
    tokenFactory: () => "fixed-confirmation-token-123456789",
    ...options,
  });
}

function token(result: TransferPreview): string {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected a preview");
  return result.preview.confirmationToken;
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

describe("two-phase save import", () => {
  it("previews a valid import without writing or exposing path and PII", () => {
    const directory = tempDirectory();
    const importPath = path.join(directory, "private-player-name.json");
    writeFileSync(
      importPath,
      save("Sensitive Name", {
        progress: {
          trainingCompleted: 14,
          decisionElo: 1123,
          mathElo: 1099,
          tournamentElo: 1050,
        },
      }),
      "utf8",
    );

    const preview = controller(directory).prepareImportFromPath(importPath);

    expect(preview).toMatchObject({
      ok: true,
      preview: {
        migratedFromVersion: 1,
        trainingCompleted: 14,
        decisionElo: 1123,
        mathElo: 1099,
        tournamentElo: 1050,
        settingsWillBeReplaced: true,
        progressWillBeReplaced: true,
      },
    });
    expect(JSON.stringify(preview)).not.toContain("Sensitive Name");
    expect(JSON.stringify(preview)).not.toContain(importPath);
    expect(
      readdirSync(directory).filter((file) => file.startsWith("autosave")),
    ).toEqual([]);
  });

  it("requires a one-use confirmation and keeps a valid prior generation", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Prior Player"), {
      boundary: "hand",
    });
    const importPath = path.join(directory, "incoming.json");
    writeFileSync(importPath, save("Imported Player"), "utf8");
    const subject = controller(directory);
    const confirmationToken = token(
      subject.prepareImportFromPath(importPath),
    );

    expect(subject.confirmImport(confirmationToken)).toMatchObject({
      ok: true,
      receipt: { boundary: "lifecycle" },
    });
    expect(subject.confirmImport(confirmationToken)).toMatchObject({
      ok: false,
      error: { code: "invalid-confirmation" },
    });
    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      record: { payload: save("Imported Player") },
    });
    const previous = JSON.parse(
      readFileSync(
        path.join(directory, saveStore.PREVIOUS_FILENAME),
        "utf8",
      ),
    ) as { payload: string };
    expect(previous.payload).toBe(save("Prior Player"));
  });

  it("rejects a TOCTOU change after preview without replacing progress", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Protected Player"), {
      boundary: "action",
    });
    const importPath = path.join(directory, "incoming.json");
    writeFileSync(importPath, save("Previewed Player"), "utf8");
    const subject = controller(directory);
    const confirmationToken = token(
      subject.prepareImportFromPath(importPath),
    );
    writeFileSync(importPath, save("Changed Player"), "utf8");

    expect(subject.confirmImport(confirmationToken)).toMatchObject({
      ok: false,
      error: { code: "import-changed" },
    });
    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      record: { payload: save("Protected Player") },
    });
  });

  it("rejects corrupt, foreign, future, oversized, and cyclic inputs", () => {
    const directory = tempDirectory();
    const subject = controller(directory);
    const cases: Array<[string, string, string]> = [
      ["corrupt.json", "{partial", "invalid-json"],
      [
        "foreign.json",
        JSON.stringify({ format: "other-game", version: 1, data: {} }),
        "foreign-save",
      ],
      [
        "future.json",
        JSON.stringify({
          format: "poker-training-pro-save",
          version: 99,
          data: { settings: defaultSettings, progress: defaultProgress },
        }),
        "future-save",
      ],
      [
        "corrupt-legacy.json",
        JSON.stringify({ settings: "not-settings", progress: {} }),
        "invalid-payload",
      ],
    ];
    for (const [name, contents, code] of cases) {
      const filePath = path.join(directory, name);
      writeFileSync(filePath, contents, "utf8");
      expect(subject.prepareImportFromPath(filePath)).toMatchObject({
        ok: false,
        error: { code },
      });
    }

    const oversized = path.join(directory, "oversized.json");
    writeFileSync(oversized, "x".repeat(transfer.MAX_IMPORT_BYTES + 1), "utf8");
    expect(subject.prepareImportFromPath(oversized)).toMatchObject({
      ok: false,
      error: { code: "import-too-large" },
    });

    const cyclic: Record<string, unknown> = {
      settings: defaultSettings,
      progress: defaultProgress,
    };
    cyclic.self = cyclic;
    expect(transfer.migrateAndValidateSave(cyclic)).toMatchObject({
      ok: false,
      error: { code: "cyclic-save" },
    });
  });

  it("migrates the original unversioned save shape before preview", () => {
    const directory = tempDirectory();
    const importPath = path.join(directory, "legacy.json");
    writeFileSync(
      importPath,
      JSON.stringify({
        settings: { ...defaultSettings, musicVolume: 19 },
        progress: {
          ...defaultProgress,
          playerName: "Legacy Player",
          trainingCompleted: 7,
        },
      }),
      "utf8",
    );

    expect(
      controller(directory).prepareImportFromPath(importPath),
    ).toMatchObject({
      ok: true,
      preview: {
        migratedFromVersion: 0,
        trainingCompleted: 7,
      },
    });
  });

  it("fills camera and motion comfort defaults for saves created before those controls", () => {
    const directory = tempDirectory();
    const importPath = path.join(directory, "pre-camera-controls.json");
    const legacyCurrent = JSON.parse(save("Existing Player")) as {
      data: { settings: Record<string, unknown> };
    };
    delete legacyCurrent.data.settings.cameraSensitivity;
    delete legacyCurrent.data.settings.cameraView;
    delete legacyCurrent.data.settings.autoCameraMovement;
    delete legacyCurrent.data.settings.menuMotion;
    delete legacyCurrent.data.settings.roomMotion;
    delete legacyCurrent.data.settings.cameraMotion;
    delete legacyCurrent.data.settings.tableMotion;
    delete legacyCurrent.data.settings.transitionMotion;
    delete legacyCurrent.data.settings.interfaceScale;
    writeFileSync(importPath, JSON.stringify(legacyCurrent), "utf8");

    const subject = controller(directory);
    const preview = subject.prepareImportFromPath(importPath);
    expect(preview).toMatchObject({
      ok: true,
      preview: { migratedFromVersion: 1 },
    });
    expect(subject.confirmImport(token(preview))).toMatchObject({ ok: true });
    const loaded = saveStore.loadAutosaveGeneration(directory);
    expect(loaded.ok).toBe(true);
    if (!loaded.record) throw new Error("Expected imported save");
    const savedSettings = (JSON.parse(loaded.record.payload) as {
      data: { settings: Record<string, unknown> };
    }).data.settings;
    expect(savedSettings).toMatchObject({
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
  });

  it("expires confirmation tokens without committing", () => {
    const directory = tempDirectory();
    const importPath = path.join(directory, "incoming.json");
    writeFileSync(importPath, save("Imported Player"), "utf8");
    let now = 1_000;
    const subject = controller(directory, {
      clock: () => now,
      confirmationTtlMs: 50,
    });
    const confirmationToken = token(
      subject.prepareImportFromPath(importPath),
    );
    now += 51;

    expect(subject.confirmImport(confirmationToken)).toMatchObject({
      ok: false,
      error: { code: "invalid-confirmation" },
    });
  });
});

describe("explicit progress-only reset", () => {
  it("archives valid generations, resets progress, and preserves settings", () => {
    const directory = tempDirectory();
    const settings = {
      musicVolume: 11,
      effectsVolume: 22,
      reducedMotion: true,
    };
    saveStore.writeAutosaveGeneration(
      directory,
      save("Progress To Reset", {
        settings,
        progress: {
          trainingCompleted: 41,
          decisionElo: 1444,
          results: [
            {
              scenarioId: "reset-me",
              completedAt: "2026-07-23T00:00:00.000Z",
              action: "call",
              actionCorrect: true,
              mathCorrect: true,
              elapsedMs: 500,
              eloDelta: 8,
            },
          ],
        },
      }),
      { boundary: "result" },
    );
    const subject = controller(directory);
    const preview = subject.prepareProgressReset();

    expect(preview).toMatchObject({
      ok: true,
      preview: {
        trainingCompleted: 41,
        resultCount: 1,
        settingsWillBePreserved: true,
        progressWillBeReset: true,
      },
    });
    expect(subject.confirmProgressReset(token(preview))).toMatchObject({
      ok: true,
      receipt: { boundary: "lifecycle" },
    });

    const loaded = saveStore.loadAutosaveGeneration(directory);
    expect(loaded.ok).toBe(true);
    if (!loaded.record) throw new Error("Expected reset save");
    const restored = restoreSaveBackup(loaded.record.payload);
    expect(restored).toMatchObject({
      ok: true,
      save: {
        data: {
          settings: {
            musicVolume: 11,
            effectsVolume: 22,
            reducedMotion: true,
          },
          progress: {
            playerName: "Player",
            trainingCompleted: 0,
            decisionElo: 1000,
            results: [],
          },
        },
      },
    });
    expect(
      readdirSync(directory).filter((file) =>
        file.startsWith("archive.progress-reset."),
      ),
    ).toHaveLength(2);
  });

  it("rejects reset confirmation when progress changes after preview", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Before Preview"), {
      boundary: "hand",
    });
    const subject = controller(directory);
    const confirmationToken = token(subject.prepareProgressReset());
    saveStore.writeAutosaveGeneration(directory, save("After Preview"), {
      boundary: "action",
    });

    expect(
      subject.confirmProgressReset(confirmationToken),
    ).toMatchObject({
      ok: false,
      error: { code: "save-changed" },
    });
    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      record: { payload: save("After Preview") },
    });
  });

  it("does not offer a reset when no valid save can preserve settings", () => {
    const directory = tempDirectory();
    writeFileSync(
      path.join(directory, saveStore.CURRENT_FILENAME),
      "{partial",
      "utf8",
    );

    expect(controller(directory).prepareProgressReset()).toMatchObject({
      ok: false,
      error: { code: "no-save" },
    });
  });
});
