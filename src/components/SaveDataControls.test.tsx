import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DurablePersistence } from "../lib/durablePersistence";
import { SaveDataControls } from "./SaveDataControls";

const stubPersistence = {} as unknown as DurablePersistence;

describe("SaveDataControls", () => {
  it("exposes export, import, reset, diagnostics, and replay actions", () => {
    const markup = renderToStaticMarkup(
      <SaveDataControls
        persistence={stubPersistence}
        replay={undefined}
        onAuthoritativeDataChanged={() => undefined}
      />,
    );
    expect(markup).toContain(">Export save</button>");
    expect(markup).toContain(">Import save…</button>");
    expect(markup).toContain(">Export diagnostics</button>");
    expect(markup).toContain(">Reset player progress…</button>");
  });

  it("keeps progress reset visibly separated as a destructive action", () => {
    const markup = renderToStaticMarkup(
      <SaveDataControls
        persistence={stubPersistence}
        replay={undefined}
        onAuthoritativeDataChanged={() => undefined}
      />,
    );
    expect(markup).toMatch(
      /class="save-data-controls__danger"[^>]*>Reset player progress/,
    );
  });

  it("disables public replay export until a replay is available", () => {
    const withoutReplay = renderToStaticMarkup(
      <SaveDataControls
        persistence={stubPersistence}
        replay={undefined}
        onAuthoritativeDataChanged={() => undefined}
      />,
    );
    expect(withoutReplay).toMatch(
      /<button[^>]*disabled=""[^>]*title="Complete or start a tournament first\."[^>]*>Export public replay<\/button>/,
    );

    const withReplay = renderToStaticMarkup(
      <SaveDataControls
        persistence={stubPersistence}
        replay={{ format: "poker-training-pro-tournament-replay" }}
        onAuthoritativeDataChanged={() => undefined}
      />,
    );
    expect(withReplay).toMatch(
      /<button[^>]*>Export public replay<\/button>/,
    );
    expect(withReplay).not.toMatch(
      /title="Complete or start a tournament first\."[^>]*>Export public replay/,
    );
  });

  it("starts without a pending confirmation and explains preview + confirmation", () => {
    const markup = renderToStaticMarkup(
      <SaveDataControls
        persistence={stubPersistence}
        replay={undefined}
        onAuthoritativeDataChanged={() => undefined}
      />,
    );
    // No confirmation section is shown until a preview is prepared.
    expect(markup).not.toContain("Confirm imported save");
    expect(markup).not.toContain("Confirm progress reset");
    expect(markup).toContain(
      "Import and reset always require a preview and confirmation.",
    );
  });
});
