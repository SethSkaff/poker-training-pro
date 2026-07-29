import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const styles = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");
const table = readFileSync(path.join(sourceRoot, "components", "PokerTable.tsx"), "utf8");

describe("scene-ready table composition", () => {
  it("reveals the ready WebGL furniture without unmounting the DOM surface", () => {
    const readyContract = styles.match(/\.poker-scene\[data-spatial-scene="ready"\] \.poker-table \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(readyContract).toContain("border-color: transparent");
    expect(readyContract).toContain("background: transparent");
    expect(readyContract).toContain("box-shadow: none");
    // The readiness attribute is published only after the renderer reports a
    // successful scene; absent/lost readiness naturally restores the DOM.
    expect(table).toContain('className="poker-scene motion-vestibular"');
    expect(table).toContain('"data-spatial-scene": "ready"');
    expect(table).toContain('sceneAvailability.status === "ready"');
  });

  it("fades only duplicate decorative furniture, preserving readable DOM facts", () => {
    const decorationFade = styles.match(/\.poker-scene\[data-spatial-scene="ready"\] \.poker-table::before,([\s\S]*?)\n\}/)?.[1] ?? "";
    for (const duplicate of [".seat-figure", ".seat-chip-stack", ".center-pot"]) {
      expect(decorationFade).toContain(duplicate);
    }
    for (const requiredHud of [".seat-label", ".seat-bet", ".opponent-cards", ".dealer-button", ".seat-position-marker"]) {
      expect(decorationFade).not.toContain(requiredHud);
    }
    // The ring is a layout parent of board cards and pot/readout facts, so it
    // may lose only its border. Parent opacity would dim every child.
    expect(decorationFade).not.toContain(".felt-ring");
    const feltRingReadyRule = styles.match(/\.poker-scene\[data-spatial-scene="ready"\] \.felt-ring \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(feltRingReadyRule).toContain("border-color: transparent");
    expect(feltRingReadyRule).not.toContain("opacity");
  });
});
