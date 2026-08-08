import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "./storage";
import { createSaveEnvelope } from "./saveMigration";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/*
  Settings are normalized twice: once in the renderer (`saveMigration.ts`) and
  once in the Electron main process (`electron/save-transfer.cjs`), which
  validates an imported save before it is written. The two lists are maintained
  by hand and nothing connected them.

  Adding `spatialScene` exposed the consequence: the renderer emitted it, the
  main process silently dropped it, and an imported save came back missing a
  setting. That failure surfaced only as a byte-comparison mismatch in an
  unrelated transfer test, which is a poor way to learn about data loss.

  These tests fail loudly instead, and they fail on the *next* setting too.
*/
describe("both settings normalizers know about every setting", () => {
  const transferSource = readFileSync(
    path.join(projectRoot, "electron", "save-transfer.cjs"),
    "utf8",
  );

  it("normalizes every default setting on the renderer side", () => {
    const envelope = createSaveEnvelope(defaultSettings, {});
    for (const key of Object.keys(defaultSettings)) {
      expect(
        Object.prototype.hasOwnProperty.call(envelope.data.settings, key),
      ).toBe(true);
    }
  });

  it("mentions every persisted setting in the main-process validator", () => {
    // `controlBindings` is optional and handled by its own validator, so it is
    // allowed to be absent from the flat field list.
    const optional = new Set(["controlBindings"]);
    const missing = Object.keys(defaultSettings)
      .filter((key) => !optional.has(key))
      .filter((key) => !transferSource.includes(key));

    expect(
      missing,
      `electron/save-transfer.cjs does not handle: ${missing.join(", ")}. An imported save would lose these fields.`,
    ).toEqual([]);
  });

  it("round-trips a save without losing a setting", () => {
    const envelope = createSaveEnvelope(
      { ...defaultSettings, spatialScene: true },
      {},
    );
    expect(envelope.data.settings.spatialScene).toBe(true);
    // And a save that predates the field gets the default rather than undefined.
    const legacy = { ...defaultSettings } as Record<string, unknown>;
    delete legacy.spatialScene;
    expect(createSaveEnvelope(legacy, {}).data.settings.spatialScene).toBe(
      defaultSettings.spatialScene,
    );
  });
});
