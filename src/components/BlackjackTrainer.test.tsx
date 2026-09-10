import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableViewSelect } from "./Dashboard";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BlackjackTrainer, quickCountHoldMs } from "./BlackjackTrainer";

const trainerSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "BlackjackTrainer.tsx",
  ),
  "utf8",
);

/** The three pace choices Quick Count actually offers. */
const DEAL_SPEEDS = [1.5, 2.5, 4] as const;

describe("Blackjack training surface", () => {
  it("places the product selector directly before Poker's existing table choices", () => {
    const markup = renderToStaticMarkup(
      <TableViewSelect
        initialSpatialScene={false}
        initialProductMode="poker"
        onBack={() => undefined}
        onProductModeChange={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain('value="poker"');
    expect(markup).toContain('value="blackjack"');
    expect(markup.indexOf("Blackjack")).toBeLessThan(markup.indexOf("2D Table"));
    expect(markup.indexOf("Training system")).toBeLessThan(markup.indexOf("2D Table"));
  });

  it("exposes all four Blackjack training sections without changing Poker's route", () => {
    const markup = renderToStaticMarkup(
      <BlackjackTrainer
        onBack={() => undefined}
        onProductModeChange={() => undefined}
        reducedMotion={false}
      />,
    );

    expect(markup).toContain("Quick Count");
    expect(markup).toContain("Tables");
    expect(markup).toContain("Trainer");
    expect(markup).toContain("Guide");
    expect(markup).not.toContain("Blackjack training system</p>");
    expect(markup).not.toContain("Only the final running count is graded.");
    expect(markup).not.toContain("Start at running count 0.");
    expect(markup).not.toContain("no 3D Blackjack view");
  });
});

describe("Quick Count reduced-motion presentation", () => {
  it("keeps the full settle when reduced motion is off", () => {
    for (const speed of DEAL_SPEEDS) {
      expect(quickCountHoldMs(speed, false)).toBe(1_000);
    }
  });

  it("drops the presentational settle when reduced motion is on", () => {
    // The scripted second exists to let the sequence settle before the answer
    // form replaces the cards. Reduced motion reaches that same stable state
    // without waiting it out.
    for (const speed of DEAL_SPEEDS) {
      expect(quickCountHoldMs(speed, true)).toBeLessThan(1_000);
    }
  });

  it("still gives the final card the exposure every other card got", () => {
    // The dealing effect flips to `holding` the moment the last card appears,
    // so this hold is that card's only display time. Shortening it below one
    // deal interval would make the drill unreadable at pace, which is the one
    // thing reduced motion must never do.
    for (const speed of DEAL_SPEEDS) {
      const dealIntervalMs = Math.round(1_000 / speed);
      expect(quickCountHoldMs(speed, true)).toBe(dealIntervalMs);
    }
  });

  it("never lengthens the hold, whatever the pace", () => {
    for (const speed of [0.25, 0.5, 1, 1.5, 2.5, 4, 12]) {
      expect(quickCountHoldMs(speed, true)).toBeLessThanOrEqual(
        quickCountHoldMs(speed, false),
      );
      expect(quickCountHoldMs(speed, true)).toBeGreaterThan(0);
    }
  });

  it("survives a nonsense pace without producing an infinite or negative wait", () => {
    for (const speed of [0, -3, Number.EPSILON]) {
      const held = quickCountHoldMs(speed, true);
      expect(Number.isFinite(held)).toBe(true);
      expect(held).toBeGreaterThan(0);
      expect(held).toBeLessThanOrEqual(1_000);
    }
  });

  it("re-derives the hold so a preference change while mounted takes effect", () => {
    // `holdMs` is recomputed on render and is an effect dependency, so flipping
    // the setting mid-drill re-runs the effect. React runs the cleanup first,
    // so the superseded timeout is cleared and cannot advance the phase behind
    // the replacement.
    expect(trainerSource).toContain(
      "const holdMs = quickCountHoldMs(speed, reducedMotion);",
    );
    expect(trainerSource).toContain(
      'const timer = window.setTimeout(() => setPhase("answer"), holdMs);',
    );
    expect(trainerSource).toContain("return () => window.clearTimeout(timer);");
    expect(trainerSource).toContain("}, [phase, holdMs]);");
  });

  it("leaves the dealing cadence, shuffle, tags and grading untouched", () => {
    // Reduced motion must not change the exercise. The deal interval is still
    // driven only by the chosen speed, and nothing about the count depends on
    // the motion setting.
    expect(trainerSource).toContain("1000 / speed");
    expect(trainerSource).toMatch(
      /setVisibleCount\(\(current\) => current \+ 1\),\s*1000 \/ speed,/,
    );
    const gradingWindow = trainerSource.slice(
      trainerSource.indexOf("const submit ="),
      trainerSource.indexOf("const recentAccuracy"),
    );
    expect(gradingWindow).toContain("getRunningCount(sequence)");
    expect(gradingWindow).not.toContain("reducedMotion");
    // Sequence construction is independent of presentation too.
    const startWindow = trainerSource.slice(
      trainerSource.indexOf("const startRound ="),
      trainerSource.indexOf("const submit ="),
    );
    expect(startWindow).not.toContain("reducedMotion");
  });

  it("routes the app-resolved setting in rather than reading the media query itself", () => {
    // App.tsx resolves saved choice, live OS preference and Safe Mode before
    // this screen sees it; re-reading `prefers-reduced-motion` here would
    // override an explicit in-app "full motion" choice.
    const app = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "App.tsx",
      ),
      "utf8",
    );
    expect(app).toContain(
      "reducedMotion={effectiveSettings.reducedMotion}",
    );
    expect(trainerSource).not.toContain("matchMedia");
    expect(trainerSource).not.toContain("prefers-reduced-motion");
  });
});
