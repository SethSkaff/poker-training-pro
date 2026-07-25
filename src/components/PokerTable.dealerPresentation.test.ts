import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentDirectory = path.dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(path.join(componentDirectory, "..", "styles.css"), "utf8");

describe("dealer button presentation", () => {
  it("animates between table-relative seat coordinates instead of button-relative translation", () => {
    const travelRule = styles.match(/\.dealer-button-travel\s*\{([\s\S]*?)\n\}/)?.[1];
    const keyframeStart = styles.indexOf("@keyframes dealer-button-travel");
    const keyframeEnd = styles.indexOf(".board-card-entering", keyframeStart);
    const keyframes = styles.slice(keyframeStart, keyframeEnd);

    expect(travelRule).toMatch(/top:\s*var\(--dealer-from-y\)/);
    expect(travelRule).toMatch(/left:\s*var\(--dealer-from-x\)/);
    expect(keyframes).toContain("top: var(--dealer-to-y)");
    expect(keyframes).toContain("left: var(--dealer-to-x)");
    expect(keyframes).not.toContain("calc(var(--dealer-to-x) - 50%)");
  });

  it("keeps the movement perceptible when table motion is reduced or off", () => {
    expect(styles).toContain(':root[data-motion-table="off"] .dealer-button-travel');
    expect(styles).toContain(':root[data-motion-table="reduced"] .dealer-button-travel');
  });
});
