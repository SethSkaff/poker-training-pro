import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../lib/storage";
import { HomeView, ModeSelect } from "./Dashboard";
import {
  RecoveryScreen,
  type RecoveryScreenActions,
} from "./RecoveryScreen";
import { RoomFlythrough } from "./RoomFlythrough";
import { SettingsPanel } from "./SettingsPanel";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const unusedRecoveryActions: RecoveryScreenActions = {
  restore: async () => {
    throw new Error("not called during server render");
  },
  exportSave: async () => {
    throw new Error("not called during server render");
  },
  exportDiagnostics: async () => {
    throw new Error("not called during server render");
  },
  startFresh: async () => {
    throw new Error("not called during server render");
  },
  cancel: () => undefined,
};

describe("non-gameplay desktop accessibility", () => {
  it("names the main menu and preserves logical Play then Settings order", () => {
    const markup = renderToStaticMarkup(
      <HomeView onPlay={() => undefined} onSettings={() => undefined} />,
    );

    expect(markup).toContain('aria-labelledby="main-menu-title"');
    expect(markup).toContain("Poker Training Pro main menu");
    expect(markup.indexOf('aria-label="Play"')).toBeLessThan(
      markup.indexOf('aria-label="Settings"'),
    );
    expect(markup).toContain('aria-label="Main menu"');
  });

  it("exposes mode choices in the same order as their visible cards", () => {
    const markup = renderToStaticMarkup(
      <ModeSelect onBack={() => undefined} onSelect={() => undefined} />,
    );

    expect(markup).toContain('aria-labelledby="mode-select-title"');
    const labels = ["Tutorial", "Normal", "Rational", "Training", "Timed Table"];
    for (let index = 1; index < labels.length; index += 1) {
      expect(markup.indexOf(`>${labels[index - 1]}<`)).toBeLessThan(
        markup.indexOf(`>${labels[index]}<`),
      );
    }
  });

  it("publishes deal-speed selection independently of color", () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={{ ...defaultSettings, dealSpeed: "standard" }}
        onBack={() => undefined}
        onChange={() => undefined}
        onFullscreenChange={() => undefined}
      />,
    );

    expect(markup).toContain(
      'role="group" aria-labelledby="deal-speed-heading"',
    );
    expect(markup).toMatch(
      /<button[^>]*aria-pressed="true"[^>]*>standard<\/button>/,
    );
    expect(markup.match(/aria-pressed="false"/g)).toHaveLength(2);
  });

  it("keeps recovery confirmation adjacent to its disclosure control", () => {
    const markup = renderToStaticMarkup(
      <RecoveryScreen
        message="A protected recovery copy is available."
        actions={unusedRecoveryActions}
        onRecovered={() => undefined}
      />,
    );

    expect(markup).toContain('aria-busy="false"');
    expect(markup).toContain(
      'aria-expanded="false" aria-controls="start-fresh-confirmation"',
    );
    expect(markup).toContain('id="start-fresh-confirmation"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(markup.indexOf(">Start fresh<")).toBeLessThan(
      markup.indexOf('id="start-fresh-confirmation"'),
    );
    expect(markup.indexOf('id="start-fresh-confirmation"')).toBeLessThan(
      markup.indexOf(">Cancel without changes<"),
    );
  });

  it("hides changing flythrough phases while retaining event context and skip control", () => {
    const markup = renderToStaticMarkup(
      <RoomFlythrough
        eventName="Qualifier"
        modeLabel="Normal"
        settings={defaultSettings}
        onComplete={() => undefined}
      />,
    );

    expect(markup).toContain('aria-labelledby="room-flight-title"');
    expect(markup).toContain('aria-describedby="room-flight-mode"');
    expect(markup).toMatch(
      /class="room-flight__status" aria-hidden="true"/,
    );
    expect(markup).not.toContain(
      'class="room-flight__status" aria-live="polite"',
    );
    expect(markup).toContain(">Skip arrival");
  });

  it("retains visible focus and 44px minimum targets in owned screens", () => {
    const sharedCss = readFileSync(
      path.join(sourceRoot, "styles.css"),
      "utf8",
    );
    const recoveryCss = readFileSync(
      path.join(sourceRoot, "components", "RecoveryScreen.module.css"),
      "utf8",
    );

    expect(sharedCss).toMatch(
      /\.home-reference__hit:focus-visible\s*{[^}]*outline:\s*4px solid #ffd13f/s,
    );
    for (const selector of [
      "\\.night-back",
      "\\.night-setting--volume button",
      "\\.night-setting--volume input\\[type=\"range\"\\]",
      "\\.night-speed button",
      "\\.night-reset",
      "\\.room-flight__skip",
    ]) {
      expect(sharedCss).toMatch(
        new RegExp(`${selector}\\s*{[^}]*min-height:\\s*44px`, "s"),
      );
    }
    expect(recoveryCss).toMatch(
      /\.confirmActions button\s*{[^}]*min-height:\s*44px/s,
    );
  });
});
