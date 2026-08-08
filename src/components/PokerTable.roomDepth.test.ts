import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");
const table = readFileSync(
  path.join(sourceRoot, "components", "PokerTable.tsx"),
  "utf8",
);

/**
 * Every rule body whose selector list mentions `selector`. A depth plane
 * appears twice — once in a shared layout rule, once in its own rule carrying
 * the parallax factor — so callers get all of them rather than whichever
 * happened to come first.
 */
function ruleBodies(selector: string): string[] {
  const bodies: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].includes(selector)) bodies.push(match[2]);
  }
  if (!bodies.length) throw new Error(`Missing CSS rule for ${selector}`);
  return bodies;
}

function ruleBody(selector: string): string {
  return ruleBodies(selector).join("\n");
}

function panFactor(selector: string): number {
  const match = ruleBody(selector).match(
    /translateX\(calc\(var\(--camera-pan[^)]*\)\s*\*\s*(-?[\d.]+)\)\)/,
  );
  if (!match) throw new Error(`${selector} does not translate with --camera-pan`);
  return Math.abs(Number.parseFloat(match[1]));
}

describe("room depth parallax", () => {
  it("renders the depth planes behind the table, hidden from assistive tech", () => {
    expect(table).toContain('<div className="room-depth" aria-hidden="true">');
    expect(table).toContain('className="room-depth__far"');
    expect(table).toContain('className="room-depth__mid"');
    // The depth group must precede the scene's own content so it never covers
    // table state.
    expect(table.indexOf('className="room-depth"')).toBeLessThan(
      table.indexOf('className="camera-controls"'),
    );
  });

  it("moves each plane at a different fraction of the camera pan", () => {
    const far = panFactor(".room-depth__far");
    const mid = panFactor(".room-depth__mid");

    // Distant things shift least. If these were equal the pan would be a flat
    // slide rather than a look, which is the defect E09-003 describes.
    expect(far).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
    // Both stay below the table plane's own 1x, so nothing overtakes the felt.
    expect(far).toBeLessThan(1);
  });

  it("comes to rest when the player turns camera motion off", () => {
    const body = ruleBody('[data-camera-motion="off"] .room-depth__far');
    expect(body).toContain("transform: none");
    expect(body).toContain("transition: none");
  });

  it("keeps the felt a lit surface rather than one flat fill", () => {
    const felt = ruleBody(".poker-table");
    // A single `background: #164938` was the original flatness complaint.
    expect(felt).toContain("radial-gradient");
    expect(felt).toContain("repeating-linear-gradient");
    expect(felt).toMatch(/inset 0 -?\d+px \d+px/);
  });
});
