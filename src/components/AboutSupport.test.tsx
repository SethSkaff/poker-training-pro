import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AboutSupport } from "./AboutSupport";

const componentsDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(componentsDir, "AboutSupport.tsx"), "utf8");

/**
 * Covers the TODOS item "Add visible in-app links for Privacy, Support,
 * Licenses/Credits, version, build identifier, save location, log location,
 * and diagnostic export" — all eight elements.
 *
 * There is no DOM/jsdom in the Vitest node environment (see
 * DialogFocusContract.test.tsx), so this test combines two techniques:
 *  - `renderToStaticMarkup` to prove every element is actually present and
 *    player-visible (labels, headings, conditional rendering), including the
 *    "no desktop bridge" state where hardcoded placeholders would otherwise
 *    be indistinguishable from real, unavailable data.
 *  - Source inspection to prove version/build id/paths/diagnostics genuinely
 *    come from the typed preload bridge (`window.desktop` via
 *    `useCreditsResources`) rather than being hardcoded literals in the
 *    component.
 */
describe("AboutSupport — in-app links panel (8-element audit)", () => {
  it("is wired to the real preload bridge, not hardcoded literals", () => {
    // Version and build identifier come from the fetched appInfo, not a
    // literal string baked into the component.
    expect(source).toContain("appInfo?.appVersion");
    expect(source).toContain("appInfo?.buildId");
    // Save/log locations come from the same fetched appInfo.paths.
    expect(source).toContain("appInfo?.paths.save");
    expect(source).toContain("appInfo?.paths.log");
    // Folder opening calls the narrow typed preload method, not a stub.
    expect(source).toContain("window.desktop.openFolder(target)");
    // Diagnostic export delegates to the parent-supplied callback, which
    // App.tsx wires to persistence.exportDiagnostics() ->
    // window.desktop.exportSaveDiagnostics() (electron/preload.cjs).
    expect(source).toContain("onExportDiagnostics()");
    // No hardcoded release-version-shaped literal (e.g. "0.1.0") anywhere in
    // the component; every numeral-bearing string here is UI chrome.
    expect(source).not.toMatch(/["'`]\d+\.\d+\.\d+["'`]/);
  });

  it("shows real-desktop-unavailable placeholders rather than fabricated values when no bridge exists", () => {
    const markup = renderToStaticMarkup(
      <AboutSupport onOpenCredits={() => undefined} />,
    );

    // 1. App version.
    expect(markup).toContain("Version");
    // 2. Build identifier.
    expect(markup).toContain("Build identifier");
    // Both show the same "unavailable" fallback because no window.desktop
    // exists in this render — proving they are not hardcoded to a fixed
    // value that would appear regardless of data availability.
    const versionSection = markup.match(/<dl[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? "";
    expect(versionSection).toContain("Unavailable");

    // 7 & 8. Save/log locations render their labels, but no "Open folder"
    // action when there is no resolvable path.
    expect(markup).toContain("Save location");
    expect(markup).toContain("Log location");
    expect(markup).not.toContain("Open folder");

    // 3. Link to Credits/Licenses.
    expect(markup).toContain("Credits &amp; licenses");

    // 8. Diagnostic export is omitted entirely when the caller has no
    // desktop-backed export to offer (App.tsx only supplies it when
    // `persistence` exists), rather than rendering a broken/no-op button.
    expect(markup).not.toContain("Export diagnostics");

    // Explains to the player why these are unavailable right now.
    expect(markup).toContain(
      "Version, folder, and bundled-document details are available in the desktop app.",
    );
  });

  it("wires the diagnostic export action when the caller provides it", () => {
    const onExportDiagnostics = vi.fn(async () => ({ ok: true }));
    const markup = renderToStaticMarkup(
      <AboutSupport
        onOpenCredits={() => undefined}
        onExportDiagnostics={onExportDiagnostics}
      />,
    );

    // 8. Diagnostic export action is visible and labeled.
    expect(markup).toContain(">Export diagnostics<");
  });

  it("presents privacy (bundled local copy + separately-blocked HTTPS notice) and a clearly pending support contact", () => {
    const markup = renderToStaticMarkup(
      <AboutSupport onOpenCredits={() => undefined} />,
    );

    // 4. Privacy: bundled local copy is offered (as unavailable in this
    // desktop-less render, but the section and disclosure element exist).
    expect(markup).toContain("Privacy");
    expect(markup).toContain("Privacy policy");
    expect(markup).toContain(
      "This build plays fully offline with no account, ads, analytics, or remote uploads.",
    );
    // The public HTTPS copy is explicitly called out as a separate, still
    // pending item — not silently omitted or implied to be live.
    expect(markup).toContain(
      "A stable public HTTPS copy of this policy is a separate item that is still blocked pending the publisher.",
    );

    // 5. Support contact: clearly marked as a placeholder pending the
    // publisher, not a fake/live address.
    expect(markup).toContain("Support");
    expect(markup).toContain(
      "Support contact: pending publisher assignment. No email or web address is published yet.",
    );
  });

  it("renders every one of the eight required elements in a single pass", () => {
    const markup = renderToStaticMarkup(
      <AboutSupport
        onOpenCredits={() => undefined}
        onExportDiagnostics={async () => ({ ok: true })}
      />,
    );

    const elements: Array<[string, string]> = [
      ["1. app version", "Version"],
      ["2. build identifier", "Build identifier"],
      ["3. Credits/Licenses link", "Credits &amp; licenses"],
      ["4. privacy policy section", "Privacy policy"],
      ["4b. privacy HTTPS pending notice", "still blocked pending the publisher"],
      ["5. support contact placeholder", "pending publisher assignment"],
      ["6. save location", "Save location"],
      ["7. log location", "Log location"],
      ["8. diagnostic export action", ">Export diagnostics<"],
    ];
    for (const [label, needle] of elements) {
      expect(markup, `missing ${label}`).toContain(needle);
    }
  });
});
