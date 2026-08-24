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
const styles = readFileSync(
  path.join(sourceRoot, "styles.css"),
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

  it("keeps camera controls accessible while removing the painted HUD", () => {
    expect(table).toContain('className="camera-controls__center"');
    expect(table).toContain("onClick={() => setCameraPan(0)}");
    expect(table).toContain("disabled={effectiveCameraPan === 0}");
    expect(table).not.toContain("table.camera.centered");
    expect(table).not.toContain("table.camera.offset");
    const cameraRule = styles.match(/\.camera-controls\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(cameraRule).toContain("clip-path: inset(50%)");
    expect(cameraRule).toContain("white-space: nowrap");
  });

  it("bounds the pan on every path, so normal play has no free camera", () => {
    const clamps = table.match(/setCameraPan\(\(value\) =>[^)]*\)/g) ?? [];
    expect(clamps.length).toBeGreaterThanOrEqual(4);
    for (const clamp of clamps) {
      expect(clamp).toMatch(/Math\.(max|min)\(-?2,/);
    }
  });

  it("keeps direct player look available when automatic camera motion is disabled", () => {
    expect(table).toContain('const cameraMotionSuppressed =');
    expect(table).toContain("const effectiveCameraPan = cameraPan");
    expect(table).toContain("cameraPan: effectiveCameraPan");
    expect(table).toContain('cameraMotion: cameraMotionSuppressed ? "off" : settings.cameraMotion');
    expect(table).not.toContain("if (cameraFixed && cameraPan !== 0)");
  });

  it("does not rerender the React table for unchanged renderer camera frames", () => {
    expect(table).toContain("setActiveCameraFrame((current) =>");
    expect(table).toContain("current.position.every");
    expect(table).toContain("current.target.every");
    expect(table).toContain("current.viewportWidth === frame.viewportWidth");
    expect(table).toContain("current.viewportHeight === frame.viewportHeight");
    expect(table).toContain("? current");
  });

  it("exposes sensitivity, zoom, and an automatic-camera-motion switch", () => {
    expect(settingsPanel).toContain("cameraSensitivity: value");
    expect(settingsPanel).toContain("cameraView: value");
    expect(settingsPanel).toContain("patchSettings({ cameraMotion })");
    // The pan step is what sensitivity actually changes.
    expect(table).toContain('settings.cameraSensitivity === "low"');
    expect(table).toContain('settings.cameraView === "close"');
    expect(table).toContain('cameraMotion: cameraMotionSuppressed ? "off" : settings.cameraMotion');
    // Automatic camera motion remains independent from table-action motion.
    expect(table).toContain('reducedMotion: settings.reducedMotion || settings.transitionMotion === "off"');
  });
});
