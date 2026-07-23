import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  restoreSaveBackup,
  SAVE_FORMAT,
  serializeSaveBackup,
} from "./saveMigration";
import { defaultProgress, defaultSettings } from "./storage";

const require = createRequire(import.meta.url);
const saveStore = require("../../electron/save-store.cjs") as {
  CURRENT_FILENAME: string;
  PREVIOUS_FILENAME: string;
  createAutosaveRecord(
    serializedSave: string,
    options: Record<string, unknown>,
  ): Record<string, unknown>;
  loadAutosaveGeneration(directory: string):
    | {
        ok: true;
        source: "current" | "previous";
        record: { payload: string };
        errors: Array<{ source: string; code: string }>;
      }
    | {
        ok: false;
        error: {
          code: string;
          generations: Array<{ source: string; code: string }>;
        };
      };
  parseAutosaveRecord(serialized: string):
    | { ok: true; record: { payload: string } }
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
    path.join(tmpdir(), "poker-training-pro-recovery-"),
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

describe("implemented save recovery policy paths", () => {
  it("falls back after a checksum mismatch and reports the rejected current generation", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Previous"), {
      boundary: "action",
    });
    saveStore.writeAutosaveGeneration(directory, save("Current"), {
      boundary: "hand",
    });

    const currentPath = path.join(directory, saveStore.CURRENT_FILENAME);
    const currentRecord = JSON.parse(readFileSync(currentPath, "utf8")) as {
      payload: string;
    };
    writeFileSync(
      currentPath,
      JSON.stringify({ ...currentRecord, payload: save("Tampered") }),
      "utf8",
    );

    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      source: "previous",
      record: { payload: save("Previous") },
      errors: [{ source: "current", code: "checksum-mismatch" }],
    });
  });

  it("preserves the previous generation when replacing a corrupt current save", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Previous"), {
      boundary: "action",
    });
    saveStore.writeAutosaveGeneration(directory, save("Soon corrupt"), {
      boundary: "hand",
    });
    writeFileSync(
      path.join(directory, saveStore.CURRENT_FILENAME),
      "{partial",
      "utf8",
    );

    const result = saveStore.writeAutosaveGeneration(
      directory,
      save("Recovered current"),
      { boundary: "action" },
    );

    expect(result).toMatchObject({
      ignoredCorruptCurrent: true,
      rotatedPrevious: false,
    });
    expect(
      saveStore.parseAutosaveRecord(
        readFileSync(
          path.join(directory, saveStore.PREVIOUS_FILENAME),
          "utf8",
        ),
      ),
    ).toMatchObject({
      ok: true,
      record: { payload: save("Previous") },
    });
    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      source: "current",
      record: { payload: save("Recovered current") },
    });
  });

  it("ignores an orphan partial temporary file when a named generation is valid", () => {
    const directory = tempDirectory();
    saveStore.writeAutosaveGeneration(directory, save("Named generation"), {
      boundary: "hand",
    });
    writeFileSync(
      path.join(
        directory,
        `.${saveStore.CURRENT_FILENAME}.interrupted.tmp`,
      ),
      '{"partial":',
      "utf8",
    );

    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: true,
      source: "current",
      record: { payload: save("Named generation") },
    });
  });

  it("returns ordered generation diagnostics when neither generation is valid", () => {
    const directory = tempDirectory();
    writeFileSync(
      path.join(directory, saveStore.CURRENT_FILENAME),
      "{partial",
      "utf8",
    );
    const previous = saveStore.createAutosaveRecord(save("Original"), {
      boundary: "action",
    });
    writeFileSync(
      path.join(directory, saveStore.PREVIOUS_FILENAME),
      JSON.stringify({ ...previous, payload: save("Changed") }),
      "utf8",
    );

    expect(saveStore.loadAutosaveGeneration(directory)).toMatchObject({
      ok: false,
      error: {
        code: "no-valid-generation",
        generations: [
          { source: "current", code: "invalid-json" },
          { source: "previous", code: "checksum-mismatch" },
        ],
      },
    });
  });

  it("keeps journal integrity separate from payload-version compatibility", () => {
    const futurePayload = JSON.stringify({
      format: SAVE_FORMAT,
      version: 2,
      data: {
        settings: defaultSettings,
        progress: defaultProgress,
        futureField: "must not be rewritten by v1",
      },
    });
    const journal = saveStore.createAutosaveRecord(futurePayload, {
      boundary: "hand",
    });
    const parsed = saveStore.parseAutosaveRecord(JSON.stringify(journal));

    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(restoreSaveBackup(parsed.record.payload)).toMatchObject({
      ok: false,
      error: { code: "unsupported-version" },
    });
  });
});
