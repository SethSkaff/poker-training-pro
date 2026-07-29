import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTION_DEFINITIONS } from "../lib/actionMap";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const table = readFileSync(
  path.join(sourceRoot, "components", "PokerTable.tsx"),
  "utf8",
);
const settingsPanel = readFileSync(
  path.join(sourceRoot, "components", "SettingsPanel.tsx"),
  "utf8",
);

const cameraActions = ACTION_DEFINITIONS.filter(
  (action) => action.category === "camera",
);

describe("seated camera controls", () => {
  it("offers left, right, and recenter on every input device", () => {
    expect(cameraActions.map((action) => action.id).sort()).toEqual([
      "camera.center",
      "camera.left",
      "camera.right",
    ]);
    for (const action of cameraActions) {
      expect(action.defaults.keyboard.length).toBeGreaterThan(0);
      expect(action.defaults.gamepad.length).toBeGreaterThan(0);
      expect(action.remappable).toBe(true);
      expect(action.pointerHint).toBeTruthy();
    }
  });

  it("makes recenter discoverable to a pointer player, not keyboard-only", () => {
    // Recenter was previously bound to X with no on-screen affordance.
    expect(table).toContain('className="camera-controls__center"');
    expect(table).toContain("onClick={() => setCameraPan(0)}");
    // It doubles as the readout of where the camera is pointing.
    expect(table).toContain("table.camera.centered");
    expect(table).toContain("table.camera.offset");
    expect(table).toContain("disabled={cameraPan === 0}");
  });

  it("bounds the pan on every path, so normal play has no free camera", () => {
    const clamps = table.match(/setCameraPan\(\(value\) =>[^)]*\)/g) ?? [];
    expect(clamps.length).toBeGreaterThanOrEqual(4);
    for (const clamp of clamps) {
      expect(clamp).toMatch(/Math\.(max|min)\(-?2,/);
    }
  });

  it("exposes sensitivity, zoom, and an automatic-camera-motion switch", () => {
    expect(settingsPanel).toContain("cameraSensitivity: value");
    expect(settingsPanel).toContain("cameraView: value");
    expect(settingsPanel).toContain("patchSettings({ cameraMotion })");
    // The pan step is what sensitivity actually changes.
    expect(table).toContain('settings.cameraSensitivity === "low"');
    expect(table).toContain('settings.cameraView === "close"');
    expect(table).toContain("cameraMotion: settings.cameraMotion");
    expect(table).not.toContain('settings.reducedMotion || settings.cameraMotion === "off"');
  });
});
