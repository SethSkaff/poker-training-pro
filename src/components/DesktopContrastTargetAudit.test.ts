import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/.{2}/g)
      ?.map((component) => Number.parseInt(component, 16) / 255);
    if (!rgb || rgb.length !== 3) throw new Error(`Expected #RRGGBB, got ${hex}`);

    const [red, green, blue] = rgb.map((component) =>
      component <= 0.04045
        ? component / 12.92
        : ((component + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function expectRule(selector: string, properties: string[]) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  const declarations = css.slice(start, end);
  for (const property of properties) {
    expect(declarations, `Expected ${selector} to declare ${property}`).toContain(
      property,
    );
  }
}

describe("desktop CSS contrast and target-size regression contract", () => {
  it("keeps opaque foreground/background pairs at WCAG AA contrast", () => {
    // These are direct, opaque combinations used by menu utility controls and
    // selected settings. Gradients and supplied artwork are intentionally not
    // included: source inspection cannot prove their rendered luminance.
    const aaPairs: Array<[string, string, string]> = [
      ["#fffaf0", "#07100f", "night shell copy"],
      ["#ffd13f", "#07100f", "selected menu/focus accent"],
      ["#f6e9ca", "#0a100e", "title audio control"],
      ["#fff8df", "#071d18", "loading gate copy"],
      ["#20180b", "#e1ae4c", "selected speed control"],
      ["#f5fbf4", "#0c211f", "remap dialog copy"],
    ];

    for (const [foreground, background, label] of aaPairs) {
      expect(contrastRatio(foreground, background), label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps visible keyboard focus on the main menu and its utility link", () => {
    expect(css).toMatch(
      /\.home-reference__hit:focus-visible\s*{[^}]*outline:\s*4px solid #ffd13f[^}]*outline-offset:\s*4px/s,
    );
    expect(css).toMatch(
      /\.home-reference__credits-link:hover,\s*\.home-reference__credits-link:focus-visible\s*{[^}]*outline:\s*3px solid #ffd13f/s,
    );
  });

  it("keeps major desktop controls at their documented minimum target sizes", () => {
    expectRule(".home-reference__profile,\n.home-reference__quit", [
      "min-width: 44px",
      "min-height: 44px",
    ]);
    expectRule(".title-sound", ["width: 44px", "height: 44px"]);
    expectRule(".home-reference__credits-link", [
      "min-width: 24px",
      "min-height: 24px",
    ]);
    for (const selector of [
      ".night-back",
      ".night-setting--volume button",
      ".night-speed button",
      ".tutorial-topbar > button",
      ".action-button",
      ".scene-loading__actions button",
    ]) {
      expectRule(selector, ["min-height: 44px"]);
    }
  });
});
