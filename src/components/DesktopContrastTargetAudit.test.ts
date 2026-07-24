import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");

// The one-time save-recovery screen is styled with a CSS module rather than
// the shared stylesheet. Reading it here lets "recovery screen choices" get
// the same source-level verification as every other audited surface, even
// though it lives in a different file.
const recoveryCss = readFileSync(
  path.join(sourceRoot, "components", "RecoveryScreen.module.css"),
  "utf8",
);

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

// styles.css is edited by tooling that leaves mixed CRLF/LF line endings in
// place (verified: most of the file is CRLF, some ranges are LF-only). Any
// lookup that spans a line break has to tolerate both, or it silently
// stops finding rules it used to find.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function crlfTolerant(value: string): string {
  return escapeRegExp(value).replace(/\n/g, "\\r?\\n");
}

function ruleDeclarations(source: string, selector: string): string {
  const pattern = new RegExp(crlfTolerant(`${selector} {`));
  const match = pattern.exec(source);
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  const start = match!.index;
  const end = source.indexOf("}", start);
  expect(end, `Unterminated CSS rule for ${selector}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Extracts a declared `property: <number>px` value from a rule body. */
function pxValue(declarations: string, property: string): number {
  const pattern = new RegExp(`${property}\\s*:\\s*([\\d.]+)px`);
  const match = declarations.match(pattern);
  expect(
    match,
    `Expected ${property} to be declared in px within: ${declarations.slice(0, 120)}`,
  ).not.toBeNull();
  return Number.parseFloat(match![1]);
}

/**
 * Parses each requested property's declared px value out of the selector's
 * rule and asserts it meets (or exceeds) the documented minimum. This is
 * intentionally a "declared value must be at least the minimum" check, not a
 * literal string match — a control that declares a larger, safer value (e.g.
 * `min-height: 66px` against a 44px documented floor) must PASS, not fail.
 */
function expectMinSize(
  source: string,
  selector: string,
  requirements: Array<[property: string, minimumPx: number]>,
) {
  const declarations = ruleDeclarations(source, selector);
  for (const [property, minimum] of requirements) {
    const value = pxValue(declarations, property);
    expect(
      value,
      `${selector} declares ${property}: ${value}px, expected >= ${minimum}px`,
    ).toBeGreaterThanOrEqual(minimum);
  }
}

/** Resolves a `--custom-property: #rrggbb;` declared inside :root. */
function cssVar(name: string): string {
  const rootMatch = css.match(/:root\s*{([\s\S]*?)}/);
  expect(rootMatch, "Expected a :root block in styles.css").not.toBeNull();
  const pattern = new RegExp(`${escapeRegExp(name)}:\\s*(#[0-9a-fA-F]{6})`);
  const match = rootMatch![1].match(pattern);
  expect(match, `Expected ${name} to resolve to a hex color in :root`).not.toBeNull();
  return match![1];
}

/**
 * A hex literal used in a contrast pair should still be traceable to the
 * source it was transcribed from (directly, or via its 3-digit shorthand),
 * so a future palette edit that silently drifts the color trips this test
 * instead of leaving a stale, unverified pair behind.
 */
function containsColor(source: string, hex: string): boolean {
  const haystack = source.toLowerCase();
  const needle = hex.toLowerCase();
  if (haystack.includes(needle)) return true;
  const digits = needle.slice(1);
  if (
    digits.length === 6 &&
    digits[0] === digits[1] &&
    digits[2] === digits[3] &&
    digits[4] === digits[5]
  ) {
    return haystack.includes(`#${digits[0]}${digits[2]}${digits[4]}`);
  }
  return false;
}

describe("desktop CSS contrast and target-size regression contract", () => {
  it("keeps opaque foreground/background pairs at WCAG AA contrast", () => {
    // These are direct, opaque combinations used by menu utility controls,
    // selected settings, tutorial/coaching, pause-menu, remap, and the
    // play-chip and save-recovery gates. Gradients and translucent panels
    // are intentionally not included: source inspection cannot prove their
    // rendered luminance over whatever sits behind them.
    const aaPairs: Array<[string, string, string, string]> = [
      ["#fffaf0", "#07100f", "night shell copy", css],
      ["#ffd13f", "#07100f", "selected menu/focus accent", css],
      ["#f6e9ca", "#0a100e", "title audio control", css],
      ["#fff8df", "#071d18", "loading gate copy", css],
      ["#20180b", "#e1ae4c", "selected speed control", css],
      ["#f5fbf4", "#0c211f", "remap dialog copy", css],
      [
        "#07100d",
        cssVar("--gold-soft"),
        "pause menu primary action (.pause-menu__actions > .primary-button)",
        css,
      ],
      [
        "#171006",
        "#ffd13f",
        "play-chip acknowledgment primary button (.startup-gate__actions button:first-child)",
        css,
      ],
      [
        "#ffffff",
        "#a41f26",
        "play-chip acknowledgment secondary button (.startup-gate__actions button)",
        css,
      ],
      [
        "#04100c",
        "#6dd9b1",
        "recovery screen primary restore action (.actions .primary)",
        recoveryCss,
      ],
    ];

    for (const [foreground, background, label, source] of aaPairs) {
      expect(contrastRatio(foreground, background), label).toBeGreaterThanOrEqual(4.5);
      expect(
        containsColor(source, foreground) && containsColor(source, background),
        `${label}: both colors should still be traceable to their source`,
      ).toBe(true);
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
    expectMinSize(css, ".home-reference__profile,\n.home-reference__quit", [
      ["min-width", 44],
      ["min-height", 44],
    ]);
    expectMinSize(css, ".title-sound", [
      ["width", 44],
      ["height", 44],
    ]);
    expectMinSize(css, ".home-reference__credits-link", [
      ["min-width", 24],
      ["min-height", 24],
    ]);
    for (const selector of [
      ".night-back",
      ".night-setting--volume button",
      ".night-speed button",
      ".tutorial-topbar > button",
      ".action-button",
      ".scene-loading__actions button",
    ]) {
      expectMinSize(css, selector, [["min-height", 44]]);
    }
  });

  it("keeps primary poker-action controls at the documented 44px minimum", () => {
    // Documented standard: the general WCAG 2.2 AA target-size minimum is
    // 24x24 CSS px, but this project holds its primary poker-action controls
    // (fold/check/call/raise/bet equivalents, and their tutorial mirrors) to
    // a larger 44px floor. `.tutorial-actions > button` is aria-labeled
    // "Legal poker actions" and renders the tutorial's Fold/Check/Raise
    // controls; the bet/showdown/continue/finish group renders the
    // tutorial's Bet/Deal-turn/Deal-river actions.
    for (const selector of [
      ".tutorial-actions > button",
      ".tutorial-bet > button,\n.tutorial-showdown > button,\n.tutorial-continue,\n.tutorial-finish > button",
      ".pause-menu__actions > button",
      ".controls-remap__tabs button",
      ".controls-remap__reset,\n.controls-remap__back",
      ".controls-remap__group li > button",
      ".remap-capture button",
      ".startup-gate__actions button",
    ]) {
      expectMinSize(css, selector, [["min-height", 44]]);
    }
  });

  it("keeps extended utility, coaching, and settings controls at the WCAG 24px minimum target size", () => {
    // These are not primary poker actions, so the general WCAG 2.2 AA 24x24
    // CSS-pixel minimum applies rather than this project's stricter 44px
    // poker-action floor.
    for (const selector of [
      ".context-coach > div > button",
      ".resume-recap > button",
      ".credits-doc > summary",
      ".save-data-controls__buttons button",
    ]) {
      expectMinSize(css, selector, [["min-height", 24]]);
    }
    expectMinSize(css, ".about-support__links button,\n.about-support__paths button", [
      ["min-width", 24],
      ["min-height", 24],
    ]);
  });

  it("keeps the save-recovery screen's choices at the WCAG 24px minimum (44px where they mirror primary actions)", () => {
    // RecoveryScreen.module.css, not styles.css — recovery is the one screen
    // styled with a CSS module. Its "Restore" action mirrors a primary
    // action, and both its own and general recovery buttons already declare
    // 44px+, so this is captured at the stricter tier rather than 24px.
    expectMinSize(recoveryCss, ".actions button", [["min-height", 44]]);
    expectMinSize(recoveryCss, ".confirmActions button", [["min-height", 44]]);
  });
});
