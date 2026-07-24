import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../lib/storage";
import { HomeView, ModeSelect, TourLobby } from "./Dashboard";
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
    // The supplied reference starts with Play selected in the artwork, not a
    // browser-style focus rectangle. Keyboard focus remains visible after Tab.
    expect(markup).not.toContain("autofocus");
  });

  it("keeps the four game modes primary and the tutorial secondary", () => {
    const markup = renderToStaticMarkup(
      <ModeSelect onBack={() => undefined} onSelect={() => undefined} />,
    );

    expect(markup).toContain('aria-labelledby="mode-select-title"');
    expect(markup.match(/class="mode-stage__choice /g)).toHaveLength(4);
    const labels = ["Normal", "Rational", "Training", "Timed Table"];
    for (let index = 1; index < labels.length; index += 1) {
      expect(markup.indexOf(`>${labels[index - 1]}<`)).toBeLessThan(
        markup.indexOf(`>${labels[index]}<`),
      );
    }
    expect(markup).toContain("New to the table?");
    expect(markup.indexOf(">Timed Table<")).toBeLessThan(
      markup.indexOf("New to the table?"),
    );
  });

  it("uses labels, text, and current state instead of color alone for route selection", () => {
    const markup = renderToStaticMarkup(
      <TourLobby
        mode="normal"
        careerResults={[]}
        onBack={() => undefined}
        onStartEvent={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Tournament events"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("Available");
    expect(markup).toContain("Starting stack");
    expect(markup).toContain("Opening blinds");
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
    const dealSpeedGroup = markup.slice(
      markup.indexOf('aria-labelledby="deal-speed-heading"'),
      markup.indexOf("</div>", markup.indexOf('aria-labelledby="deal-speed-heading"')),
    );
    expect(dealSpeedGroup).toMatch(
      /<button[^>]*aria-pressed="true"[^>]*>standard<\/button>/,
    );
    expect(dealSpeedGroup.match(/aria-pressed="false"/g)).toHaveLength(2);
  });

  it("offers independent camera comfort choices", () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={{ ...defaultSettings, cameraSensitivity: "high", cameraView: "wide" }}
        onBack={() => undefined}
        onChange={() => undefined}
        onFullscreenChange={() => undefined}
      />,
    );

    expect(markup).toContain("Automatic camera movement");
    expect(markup).toContain('aria-labelledby="camera-sensitivity-heading"');
    expect(markup).toContain('aria-labelledby="camera-view-heading"');
    expect(markup).toMatch(/aria-pressed="true"[^>]*>high<\/button>/);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>wide<\/button>/);
  });

  it("lets players quiet each animated surface independently", () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={{
          ...defaultSettings,
          menuMotion: "off",
          roomMotion: "reduced",
          cameraMotion: "off",
          tableMotion: "reduced",
          transitionMotion: "off",
        }}
        onBack={() => undefined}
        onChange={() => undefined}
        onFullscreenChange={() => undefined}
      />,
    );

    for (const heading of [
      "menu-motion-heading",
      "room-motion-heading",
      "camera-motion-heading",
      "table-motion-heading",
      "transition-motion-heading",
    ]) {
      expect(markup).toContain(`aria-labelledby="${heading}"`);
    }
    expect(markup).toContain("one-click safety override");
  });

  it("offers a persistent whole-interface scale rather than shrinking only text", () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={{ ...defaultSettings, interfaceScale: "extra-large" }}
        onBack={() => undefined}
        onChange={() => undefined}
        onFullscreenChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-labelledby="interface-scale-heading"');
    expect(markup).toMatch(
      /aria-pressed="true"[^>]*>Extra large<\/button>/,
    );
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
    expect(sharedCss).toMatch(
      /\.home-reference__media img,[\s\S]*animation:\s*home-reference-drift 2s ease-in-out infinite alternate/s,
    );
    expect(sharedCss).toMatch(
      /\.reduced-motion \.home-reference__media img,[\s\S]*animation:\s*none !important/s,
    );
    expect(sharedCss).toMatch(
      /:root\[data-interface-scale="extra-large"\] #root\s*{[^}]*zoom:\s*1\.4/s,
    );
    expect(sharedCss).toMatch(
      /:root\[data-safe-mode="true"\] \*\s*,[\s\S]*animation:\s*none !important/s,
    );
    expect(sharedCss).toMatch(
      /\.context-coach\s*{[^}]*right:\s*28px;[^}]*width:\s*min\(300px/s,
    );
    expect(sharedCss).toContain(".seat-action-hand--bet");
    expect(sharedCss).toContain(".seat-action-hand--fold");
    expect(sharedCss).toContain(".seat-action-hand--all-in");
    expect(sharedCss).toContain(".seat-action-hand--win");
    expect(sharedCss).toContain(".seat-action-hand--check");
    expect(sharedCss).toContain(".seat-action-hand--call");
    expect(sharedCss).toContain(".opponent-card-hand");
    expect(sharedCss).toContain(".player-seat.is-out .seat-avatar");
    expect(sharedCss).toContain("@keyframes opponent-chip-hand");
    expect(sharedCss).toContain("@keyframes opponent-fold-hand");
    expect(sharedCss).toContain("@keyframes opponent-all-in-hand");
    expect(sharedCss).toContain("@keyframes opponent-pot-gather");
    expect(sharedCss).toContain("@keyframes opponent-leave-table");
    expect(sharedCss).toContain("@keyframes opponent-check-felt");
    expect(sharedCss).toContain("@keyframes opponent-call-hand");
    expect(sharedCss).toMatch(
      /\.opponent-cards\s*{[^}]*gap:\s*4px/s,
    );
    expect(sharedCss).toMatch(
      /\.opponent-cards \.playing-card:last-child\s*{[^}]*margin-left:\s*0/s,
    );
    for (const surface of ["menu", "room", "camera", "table", "transition"]) {
      expect(sharedCss).toContain(`data-motion-${surface}="off"`);
    }
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
