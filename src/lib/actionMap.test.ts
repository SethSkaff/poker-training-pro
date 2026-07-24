import { describe, expect, it } from "vitest";
import {
  ACTION_DEFINITIONS,
  ACTION_MAP_VERSION,
  defaultBindingsForDevice,
  describeGamepadToken,
  describeKeyToken,
  detectConflicts,
  detectReservedWarnings,
  emptyOverrides,
  isReservedKeyToken,
  keyEventToken,
  normalizeControlBindingOverrides,
  resetDeviceToDefaults,
  resolveBindings,
  resolveGamepadAction,
  resolveKeyboardAction,
  setBinding,
  type ControlBindingOverrides,
} from "./actionMap";

describe("action map defaults", () => {
  it("reproduces the shipped keyboard hotkeys exactly", () => {
    const resolved = resolveBindings();
    const expected: Record<string, string> = {
      "game.fold": "f",
      "game.checkCall": "c",
      "game.raiseCustom": "r",
      "game.raiseDouble": "2",
      "game.raiseTwoFive": "5",
      "game.raiseTriple": "3",
      "game.pot": "p",
      "game.allIn": "a",
      "game.peek": "space",
      "game.history": "h",
      "game.pause": "escape",
      "camera.left": "q",
      "camera.right": "e",
      "camera.center": "x",
    };
    for (const [id, token] of Object.entries(expected)) {
      expect(resolved[id as keyof typeof resolved].keyboard).toContain(token);
    }
    // Speed keeps its multi-key defaults.
    expect(resolved["speed.down"].keyboard).toEqual(["[", "-"]);
    expect(resolved["speed.up"].keyboard).toEqual(["]", "=", "+"]);
  });

  it("gives every action a unique id and per-device default arrays", () => {
    const ids = ACTION_DEFINITIONS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of ACTION_DEFINITIONS) {
      expect(Array.isArray(definition.defaults.keyboard)).toBe(true);
      expect(Array.isArray(definition.defaults.gamepad)).toBe(true);
      expect(definition.pointerHint.length).toBeGreaterThan(0);
    }
  });

  it("exposes default bindings per device without aliasing the registry", () => {
    const keyboard = defaultBindingsForDevice("keyboard");
    keyboard["game.fold"].push("z");
    expect(resolveBindings()["game.fold"].keyboard).toEqual(["f"]);
  });
});

describe("keyboard routing", () => {
  const resolved = resolveBindings();

  it("routes space to peek in game context but activate in menu context", () => {
    expect(resolveKeyboardAction(resolved, "game", { key: " " })).toBe(
      "game.peek",
    );
    expect(resolveKeyboardAction(resolved, "menu", { key: " " })).toBe(
      "menu.activate",
    );
  });

  it("routes gameplay letters case-insensitively", () => {
    expect(resolveKeyboardAction(resolved, "game", { key: "F" })).toBe(
      "game.fold",
    );
    expect(resolveKeyboardAction(resolved, "game", { key: "c" })).toBe(
      "game.checkCall",
    );
  });

  it("keeps Escape mapped to pause in game and back in menu", () => {
    expect(resolveKeyboardAction(resolved, "game", { key: "Escape" })).toBe(
      "game.pause",
    );
    expect(resolveKeyboardAction(resolved, "menu", { key: "Escape" })).toBe(
      "menu.back",
    );
  });

  it("returns null for an unbound key", () => {
    expect(resolveKeyboardAction(resolved, "game", { key: "z" })).toBeNull();
  });

  it("normalizes the space token from key or code", () => {
    expect(keyEventToken({ key: " " })).toBe("space");
    expect(keyEventToken({ key: "Unidentified", code: "Space" })).toBe("space");
    expect(keyEventToken({ key: "Q" })).toBe("q");
  });
});

describe("gamepad routing", () => {
  const resolved = resolveBindings();

  it("maps the A button to activate in menus and check/call in game", () => {
    expect(resolveGamepadAction(resolved, "menu", "button:0")).toBe(
      "menu.activate",
    );
    expect(resolveGamepadAction(resolved, "game", "button:0")).toBe(
      "game.checkCall",
    );
  });

  it("maps the B button to back in menus", () => {
    expect(resolveGamepadAction(resolved, "menu", "button:1")).toBe("menu.back");
  });
});

describe("reserved keys", () => {
  it("flags Escape, F11, Tab and modifiers as reserved", () => {
    for (const token of ["escape", "f11", "tab", "meta", "control", "alt"]) {
      expect(isReservedKeyToken(token)).toBe(true);
    }
    expect(isReservedKeyToken("f")).toBe(false);
  });

  it("does not warn about the reserved default of Back/Pause", () => {
    const warnings = detectReservedWarnings(resolveBindings());
    expect(warnings).toEqual([]);
  });

  it("warns when an ordinary action is bound onto a reserved key", () => {
    const overrides = setBinding(null, "keyboard", "game.fold", ["escape"]);
    const warnings = detectReservedWarnings(resolveBindings(overrides));
    expect(warnings).toContainEqual({ actionId: "game.fold", token: "escape" });
  });
});

describe("conflict detection", () => {
  it("reports no conflicts for defaults", () => {
    expect(detectConflicts(resolveBindings(), "keyboard")).toEqual([]);
  });

  it("detects a same-context duplicate binding", () => {
    const overrides = setBinding(null, "keyboard", "game.fold", ["c"]);
    const conflicts = detectConflicts(resolveBindings(overrides), "keyboard");
    const call = conflicts.find((conflict) => conflict.token === "c");
    expect(call).toBeDefined();
    expect(call?.actions.sort()).toEqual(["game.checkCall", "game.fold"]);
  });

  it("does not treat cross-context reuse as a conflict", () => {
    // Space is peek (game) and activate (menu) by default — not a conflict.
    const conflicts = detectConflicts(resolveBindings(), "keyboard");
    expect(conflicts.some((conflict) => conflict.token === "space")).toBe(false);
  });
});

describe("remap mutations", () => {
  it("stores an override and drops it when reset to the default value", () => {
    let overrides: ControlBindingOverrides = setBinding(
      null,
      "keyboard",
      "game.fold",
      ["g"],
    );
    expect(overrides.keyboard["game.fold"]).toEqual(["g"]);
    overrides = setBinding(overrides, "keyboard", "game.fold", ["f"]);
    expect(overrides.keyboard["game.fold"]).toBeUndefined();
  });

  it("reset to defaults clears only the requested device", () => {
    let overrides = setBinding(null, "keyboard", "game.fold", ["g"]);
    overrides = setBinding(overrides, "gamepad", "game.fold", ["button:9"]);
    const cleared = resetDeviceToDefaults(overrides, "keyboard");
    expect(cleared.keyboard).toEqual({});
    expect(cleared.gamepad["game.fold"]).toEqual(["button:9"]);
  });

  it("does not mutate the source overrides", () => {
    const source = emptyOverrides();
    const next = setBinding(source, "keyboard", "game.fold", ["g"]);
    expect(source.keyboard["game.fold"]).toBeUndefined();
    expect(next).not.toBe(source);
  });
});

describe("persistence normalization", () => {
  it("returns undefined for empty or invalid input", () => {
    expect(normalizeControlBindingOverrides(undefined)).toBeUndefined();
    expect(normalizeControlBindingOverrides(null)).toBeUndefined();
    expect(normalizeControlBindingOverrides({})).toBeUndefined();
    expect(
      normalizeControlBindingOverrides({ keyboard: { "game.fold": [] } }),
    ).toBeUndefined();
  });

  it("round-trips a valid override and discards unknown ids/non-strings", () => {
    const raw = {
      version: 99,
      keyboard: {
        "game.fold": ["G", "g"],
        "not.a.real.action": ["z"],
        "game.peek": [1, "space"],
      },
      gamepad: { "game.allIn": ["button:5"] },
    };
    const normalized = normalizeControlBindingOverrides(raw);
    expect(normalized).toBeDefined();
    expect(normalized?.version).toBe(ACTION_MAP_VERSION);
    // Lowercased and de-duplicated.
    expect(normalized?.keyboard["game.fold"]).toEqual(["g"]);
    // Unknown action id dropped.
    expect(
      (normalized?.keyboard as Record<string, unknown>)["not.a.real.action"],
    ).toBeUndefined();
    // Non-string token filtered out.
    expect(normalized?.keyboard["game.peek"]).toEqual(["space"]);
    expect(normalized?.gamepad["game.allIn"]).toEqual(["button:5"]);
  });

  it("survives a full set → persist → resolve cycle", () => {
    const overrides = setBinding(null, "keyboard", "game.fold", ["g"]);
    const persisted = JSON.parse(JSON.stringify(overrides));
    const restored = normalizeControlBindingOverrides(persisted);
    expect(resolveBindings(restored)["game.fold"].keyboard).toEqual(["g"]);
  });
});

describe("token descriptions", () => {
  it("labels keyboard and gamepad tokens for display", () => {
    expect(describeKeyToken("space")).toBe("Space");
    expect(describeKeyToken("escape")).toBe("Esc");
    expect(describeKeyToken("f")).toBe("F");
    expect(describeGamepadToken("button:0")).toBe("A");
    expect(describeGamepadToken("button:12")).toBe("D-pad ↑");
  });
});
