import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreditsScreen } from "./CreditsScreen";

describe("CreditsScreen", () => {
  it("keeps offline font and runtime notices reachable from the desktop UI", () => {
    const markup = renderToStaticMarkup(
      <CreditsScreen onBack={() => undefined} />,
    );

    expect(markup).toContain('aria-labelledby="credits-title"');
    expect(markup).toContain("Credits &amp; licenses");
    expect(markup).toContain("Inter — SIL Open Font License 1.1");
    expect(markup).toContain("Barlow Condensed — SIL Open Font License 1.1");
    expect(markup).toContain("npm package notices");
    expect(markup).toContain("Bundled runtime notices");
    expect(markup).toContain("No licensed music ships in this build.");
  });
});
