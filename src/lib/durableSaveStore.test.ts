import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeSaveBackup } from "./saveMigration";
import { defaultProgress, defaultSettings } from "./storage";

const require = createRequire(import.meta.url);
const saveStore = require("../../electron/save-store.cjs") as {
  CURRENT_FILENAME: string;
  LAST_KNOWN_GOOD_FILENAME: string;
  PREVIOUS_FILENAME: string;
  createAutosaveRecord(
    serializedSave: string,
    options: Record<string, unknown>,
  ): Record<string, unknown>;
  createDiagnosticExport(directory: string): string;
  loadAutosaveGeneration(directory: string): {
    ok: boolean;
    source?: string;
    record?: { payload: string };
  };
  probeAutosaveGenerations(directory: string): {
    generations: Array<{
      source: string;
      exists: boolean;
      record?: { payload: string };
    }>;
  };
  restoreAutosaveGeneration(
    directory: string,
    source: "previous" | "last-known-good",
  ): { ok: boolean };
  startFreshAutosave(
    directory: string,
    serializedSave: string,
  ): { ok: boolean };
  writeAutosaveGeneration(
    directory: string,
    serializedSave: string,
    options: Record<string, unknown>,
  ): { lastKnownGoodUpdated: boolean };
};

const temporaryDirectories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), "poker-training-pro-durable-store-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function save(playerName: string): string {
  return serializeSaveBackup(defaultSettings, {
    ...defaultProgress,
    playerName,
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

describe("durable recovery store operations", () => {
  it("maintains a separately probed last-known-good generation", () => {
    const directory = tempDirectory();
    const written = saveStore.writeAutosaveGeneration(
      directory,
      save("Protected Player"),
      { boundary: "action" },
    );

    expect(written.lastKnownGoodUpdated).toBe(true);
    expect(
      saveStore.probeAutosaveGenerations(directory).generations,
    ).toMatchObject([
      { source: "current", exists: true },
      { source: "previous", exists: false },
      {
        source: "last-known-good",
        exists: true,
        record: { payload: save("Protected Player") },
      },
    ]);
  });

  it("archives a damaged current generation before restoring previous", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Previous Player"), {
      boundary: "action",
    });
    saveStore.writeAutosaveGeneration(directory, save("Current Player"), {
      boundary: "hand",
    });
    writeFileSync(
      path.join(directory, saveStore.CURRENT_FILENAME),
      "{partial",
      "utf8",
    );

    expect(
      saveStore.restoreAutosaveGeneration(directory, "previous"),
    ).toMatchObject({ ok: true });
    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      source: "current",
      record: { payload: save("Previous Player") },
    });
    expect(
      readdirSync(directory).some((fileName) =>
        fileName.startsWith("archive.restore.current."),
      ),
    ).toBe(true);
  });

  it("archives every named generation before an explicit fresh start", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Old Player"), {
      boundary: "action",
    });
    saveStore.writeAutosaveGeneration(directory, save("Latest Player"), {
      boundary: "hand",
    });

    expect(
      saveStore.startFreshAutosave(directory, save("Fresh Player")),
    ).toMatchObject({ ok: true });
    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      source: "current",
      record: { payload: save("Fresh Player") },
    });
    expect(
      readdirSync(directory).filter((fileName) =>
        fileName.startsWith("archive.fresh-start."),
      ),
    ).toHaveLength(3);
  });

  it("exports diagnostics without raw save payload or private-card fields", () => {
    const directory = tempDirectory();
    const sensitiveSave = JSON.stringify({
      format: "poker-training-pro-save",
      version: 1,
      data: {
        settings: defaultSettings,
        progress: defaultProgress,
        holeCards: ["As", "Ah"],
        futureDeck: ["Kd"],
      },
    });
    const record = saveStore.createAutosaveRecord(sensitiveSave, {
      boundary: "hand",
    });
    writeFileSync(
      path.join(directory, saveStore.CURRENT_FILENAME),
      JSON.stringify(record),
      "utf8",
    );

    const diagnostic = saveStore.createDiagnosticExport(directory);

    expect(diagnostic).not.toContain("holeCards");
    expect(diagnostic).not.toContain("futureDeck");
    expect(diagnostic).not.toContain("As");
    expect(diagnostic).not.toContain("Ada");
    const parsedDiagnostic = JSON.parse(diagnostic) as {
      format: string;
      generations: unknown[];
    };
    expect(parsedDiagnostic.format).toBe(
      "poker-training-pro-save-diagnostics",
    );
    expect(parsedDiagnostic.generations[0]).toMatchObject({
      source: "current",
      valid: true,
      payload: { format: "poker-training-pro-save", version: 1 },
    });
    expect(
      readFileSync(
        path.join(directory, saveStore.CURRENT_FILENAME),
        "utf8",
      ),
    ).toContain("holeCards");
  });
});
