import { describe, expect, it } from "vitest";
import { createSaveEnvelope } from "./saveMigration";
import { defaultProgress, defaultSettings } from "./storage";
import { setBinding } from "./actionMap";

describe("control bindings persistence through the durable save path", () => {
  it("preserves a valid remap across save normalization", () => {
    const overrides = setBinding(null, "keyboard", "game.fold", ["g"]);
    const envelope = createSaveEnvelope(
      { ...defaultSettings, controlBindings: overrides },
      defaultProgress,
    );
    expect(envelope.data.settings.controlBindings?.keyboard["game.fold"]).toEqual(
      ["g"],
    );
  });

  it("drops an invalid/empty remap rather than persisting junk", () => {
    const envelope = createSaveEnvelope(
      {
        ...defaultSettings,
        controlBindings: {
          version: 1,
          keyboard: { "not.real": ["z"] },
          gamepad: {},
        },
      } as never,
      defaultProgress,
    );
    expect(envelope.data.settings.controlBindings).toBeUndefined();
  });

  it("omits control bindings entirely when none are set", () => {
    const envelope = createSaveEnvelope(defaultSettings, defaultProgress);
    expect(envelope.data.settings.controlBindings).toBeUndefined();
  });
});
