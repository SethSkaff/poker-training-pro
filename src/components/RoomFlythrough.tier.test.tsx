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

  it("grows the visible venue and crowd with event tier", () => {
    const local = renderToStaticMarkup(<RoomFlythrough eventName="Local" modeLabel="Normal" tier="local" settings={defaultSettings} onComplete={() => undefined} />);
    const world = renderToStaticMarkup(<RoomFlythrough eventName="World" modeLabel="Normal" tier="world" settings={defaultSettings} onComplete={() => undefined} />);
    expect(local.match(/class="venue-table"/g)).toHaveLength(3);
    expect(world.match(/class="venue-table"/g)).toHaveLength(8);
    expect(local.match(/venue-guest/g)?.length).toBeLessThan(world.match(/venue-guest/g)?.length ?? 0);
  });
});
