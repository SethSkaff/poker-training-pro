import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TableViewSelect } from "./Dashboard";
import { defaultSettings } from "../lib/storage";

describe("Play table-view choice", () => {
  it("offers 2D on the left and 3D on the right before mode selection", () => {
    const markup = renderToStaticMarkup(
      <TableViewSelect
        initialSpatialScene={false}
        onBack={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("Choose your table");
    expect(markup.indexOf("2D Table")).toBeLessThan(markup.indexOf("3D Table"));
    expect(markup).toContain('aria-label="Play at a 2D table"');
    expect(markup).toContain('aria-label="Play at a 3D table"');
    expect(markup).toContain("table-view-preview--2d");
    expect(markup).toContain("table-view-preview--3d");
    expect(markup).toContain('src="/table-view-preview-2d.png"');
    expect(markup).toContain('src="/table-view-preview-3d.png"');
    expect(markup).toContain('aria-describedby="table-view-2d-description"');
    expect(markup).toContain('aria-describedby="table-view-3d-description"');
    expect(markup).not.toContain("table-view-preview__felt");
    expect(markup).not.toContain("table-view-preview__dock");
  });

  it("keeps the Last used badge centered and native choices keyboard reachable", () => {
    const markup = renderToStaticMarkup(
      <TableViewSelect
        initialSpatialScene={false}
        onBack={() => undefined}
        onSelect={() => undefined}
      />,
    );
    const styles = readFileSync(path.resolve(process.cwd(), "src", "styles.css"), "utf8");

    expect(markup).toContain('class="table-view-choice__last-used"');
    expect((markup.match(/<button/g) ?? []).length).toBe(3);
    expect(styles).toMatch(
      /\.table-view-choice__last-used\s*\{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*justify-content: center;[\s\S]*text-align: center;/,
    );
  });

  it("defaults fullscreen on and requests it from the explicit mode gesture with fallback", () => {
    expect(defaultSettings.fullscreen).toBe(true);
    const app = readFileSync(path.resolve(process.cwd(), "src", "App.tsx"), "utf8");
    expect(app).toContain("settings.fullscreen\n              ? await setFullscreen(true)");
    expect(app).toContain("Fullscreen unavailable; continuing in a window.");
    expect(app).toContain("navigate(\"play\")");
  });
});
