import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TableViewSelect } from "./Dashboard";

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
  });
});
