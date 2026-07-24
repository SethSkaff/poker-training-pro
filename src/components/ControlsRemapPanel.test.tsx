import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setBinding } from "../lib/actionMap";
import { ControlsRemapPanel } from "./ControlsRemapPanel";

describe("ControlsRemapPanel", () => {
  it("exposes keyboard/controller tabs and a per-device reset", () => {
    const markup = renderToStaticMarkup(
      <ControlsRemapPanel onChange={() => undefined} />,
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    // Keyboard is the default active device tab.
    expect(markup).toMatch(/role="tab" aria-selected="true"[^>]*>.*Keyboard/s);
    expect(markup).toContain("Reset keyboard to defaults");
  });

  it("renders a rebind control and current binding for every action", () => {
    const markup = renderToStaticMarkup(
      <ControlsRemapPanel onChange={() => undefined} />,
    );
    // Default fold key surfaces as F, with an accessible rebind control.
    expect(markup).toContain('aria-label="Rebind Fold for keyboard"');
    expect(markup).toMatch(/<kbd[^>]*>F<\/kbd>/);
    // Camera + speed groups are present.
    expect(markup).toContain("Camera");
    expect(markup).toContain("Opponent speed");
  });

  it("highlights a same-device conflict", () => {
    const overrides = setBinding(null, "keyboard", "game.fold", ["c"]);
    const markup = renderToStaticMarkup(
      <ControlsRemapPanel controlBindings={overrides} onChange={() => undefined} />,
    );
    expect(markup).toMatch(/<kbd class="is-conflict">C<\/kbd>/);
    expect(markup).toContain("share a binding");
  });

  it("marks a reserved-key binding", () => {
    const overrides = setBinding(null, "keyboard", "game.fold", ["escape"]);
    const markup = renderToStaticMarkup(
      <ControlsRemapPanel controlBindings={overrides} onChange={() => undefined} />,
    );
    expect(markup).toContain("controls-remap__reserved");
  });

  it("shows a Back control only when onClose is provided", () => {
    const withClose = renderToStaticMarkup(
      <ControlsRemapPanel onChange={() => undefined} onClose={() => undefined} />,
    );
    expect(withClose).toContain("controls-remap__back");
    const withoutClose = renderToStaticMarkup(
      <ControlsRemapPanel onChange={() => undefined} />,
    );
    expect(withoutClose).not.toContain("controls-remap__back");
  });
});
