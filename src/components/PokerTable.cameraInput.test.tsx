import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(process.cwd(), "src");
const tableSource = () => readFileSync(path.join(sourceRoot, "components", "PokerTable.tsx"), "utf8");
const css = () => readFileSync(path.join(sourceRoot, "styles.css"), "utf8");

describe("table camera input contract", () => {
  it("captures an open lower-table pointer drag before DOM overlays can stop it", () => {
    const source = tableSource();
    expect(source).toContain("onPointerDownCapture={beginCameraDrag}");
    expect(source).toContain("onPointerMoveCapture={updateCameraDrag}");
    expect(source).toContain("event.currentTarget.setPointerCapture(event.pointerId)");
    expect(source).toContain("event.preventDefault();");
  });

  it("captures wheel zoom on the whole scene and suppresses native page behaviour", () => {
    const source = tableSource();
    expect(source).toContain("onWheelCapture={handleCameraWheel}");
    expect(source).toContain("cameraZoomFromWheel(current, event.deltaY, event.deltaMode)");
    expect(source).toContain("event.preventDefault();");
  });

  it("prevents HUD selection while retaining editable text controls", () => {
    const styles = css();
    expect(styles).toMatch(/\.table-screen\s*\{[\s\S]*?user-select:\s*none/);
    expect(styles).toContain('.table-screen input:not([type="range"])');
    expect(styles).toContain(".table-screen textarea");
    expect(styles).toContain("user-select: text");
  });
});
