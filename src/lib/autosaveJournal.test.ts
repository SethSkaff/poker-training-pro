import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { serializeSaveBackup } from "./saveMigration";
import { defaultProgress, defaultSettings } from "./storage";

const require = createRequire(import.meta.url);
const saveStore = require("../../electron/save-store.cjs") as {
  CURRENT_FILENAME: string;
  PREVIOUS_FILENAME: string;
  MAX_AUTOSAVE_PAYLOAD_BYTES: number;
  MAX_AUTOSAVE_REPLAY_BYTES: number;
  createAutosaveRecord(
    serializedSave: string,
    options: Record<string, unknown>,
  ): Record<string, unknown>;
  loadAutosaveGeneration(directory: string):
    | {
        ok: true;
        source: "current" | "previous";
        record: { boundary: "action" | "hand"; payload: string };
      }
    | { ok: false; error: { code: string } };
  parseAutosaveRecord(serialized: string):
    | { ok: true; record: Record<string, unknown> }
    | { ok: false; error: { code: string } };
  writeAutosaveGeneration(
    directory: string,
    serializedSave: string,
    options: Record<string, unknown>,
  ): {
    rotatedPrevious: boolean;
    ignoredCorruptCurrent: boolean;
  };
};

const temporaryDirectories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), "poker-training-pro-autosave-"),
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

describe("crash-safe tournament autosave generations", () => {
  it("rotates a valid current action save before committing a hand save", () => {
    const directory = tempDirectory();
    const first = saveStore.writeAutosaveGeneration(
      directory,
      save("Action boundary"),
      {
        boundary: "action",
        savedAt: "2026-07-23T01:00:00.000Z",
      },
    );
    const second = saveStore.writeAutosaveGeneration(
      directory,
      save("Hand boundary"),
      {
        boundary: "hand",
        savedAt: "2026-07-23T01:01:00.000Z",
      },
    );

    expect(first.rotatedPrevious).toBe(false);
    expect(second.rotatedPrevious).toBe(true);
    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      source: "current",
      record: { boundary: "hand", payload: save("Hand boundary") },
    });

    const previous = saveStore.parseAutosaveRecord(
      readFileSync(
        path.join(directory, saveStore.PREVIOUS_FILENAME),
        "utf8",
      ),
    );
    expect(previous).toMatchObject({
      ok: true,
      record: { boundary: "action", payload: save("Action boundary") },
    });
  });

  it("rejects an invalid save before replacing the last valid generation", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Still safe"), {
      boundary: "action",
    });

    expect(() =>
      saveStore.writeAutosaveGeneration(directory, '{"not":"a save"}', {
        boundary: "hand",
      }),
    ).toThrow(/not a Poker Training Pro save/i);
    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      source: "current",
      record: { payload: save("Still safe") },
    });
  });

  it("falls back to the previous generation when current is corrupt", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Previous valid"), {
      boundary: "action",
    });
    saveStore.writeAutosaveGeneration(directory, save("Current valid"), {
      boundary: "hand",
    });
    writeFileSync(
      path.join(directory, saveStore.CURRENT_FILENAME),
      "{partial",
      "utf8",
    );

    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      source: "previous",
      record: { payload: save("Previous valid") },
      errors: [{ source: "current", code: "invalid-json" }],
    });
  });

  it("detects payload tampering through the generation checksum", () => {
    const record = saveStore.createAutosaveRecord(save("Original"), {
      boundary: "hand",
      savedAt: "2026-07-23T01:02:00.000Z",
    });
    const tampered = JSON.stringify({
      ...record,
      payload: save("Tampered"),
    });

    expect(saveStore.parseAutosaveRecord(tampered)).toMatchObject({
      ok: false,
      error: { code: "checksum-mismatch" },
    });
  });

  it("stores reproducibility metadata but rejects hidden-state fields", () => {
    const record = saveStore.createAutosaveRecord(save("Replay safe"), {
      boundary: "action",
      replay: {
        engineVersion: "engine-1",
        contentVersion: "trainer-1.0",
        policyVersion: "rational-v1",
        prngSeed: "public-seed",
        publicActionLog: [{ playerId: "seat-2", type: "raise", amount: 600 }],
      },
    });

    expect(record).toMatchObject({
      replay: {
        engineVersion: "engine-1",
        publicActionLog: [{ type: "raise", amount: 600 }],
      },
    });
    expect(() =>
      saveStore.createAutosaveRecord(save("Hidden"), {
        boundary: "action",
        replay: { players: [{ holeCards: ["As", "Ah"] }] },
      }),
    ).toThrow(/cannot contain holeCards/i);
  });

  it("rejects oversized save and replay values at the main-process journal boundary", () => {
    const oversizedSave = JSON.stringify({
      format: "poker-training-pro-save",
      version: 1,
      data: { padding: "x".repeat(saveStore.MAX_AUTOSAVE_PAYLOAD_BYTES) },
    });
    expect(() =>
      saveStore.createAutosaveRecord(oversizedSave, { boundary: "action" }),
    ).toThrow(/payload is too large/i);

    expect(() =>
      saveStore.createAutosaveRecord(save("Replay bounded"), {
        boundary: "action",
        replay: {
          publicActionLog: [
            "x".repeat(saveStore.MAX_AUTOSAVE_REPLAY_BYTES),
          ],
        },
      }),
    ).toThrow(/replay metadata is too large/i);
  });
});
