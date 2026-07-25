import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../lib/storage";
import { RoomFlythrough } from "./RoomFlythrough";

describe("room tier presentation", () => {
  it("exposes the event tier as a local scene styling hook", () => {
    const markup = renderToStaticMarkup(
      <RoomFlythrough eventName="World" modeLabel="Normal" tier="world" settings={defaultSettings} onComplete={() => undefined} />,
    );
    expect(markup).toContain('data-event-tier="world"');
  });
});
