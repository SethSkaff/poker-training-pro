import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultProgress,
  defaultSettings,
  loadProgress,
  loadSettings,
  saveProgress,
  saveSettings,
} from "./storage";

function memoryStorage(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("browser persistence normalization", () => {
  it("fully validates hostile legacy settings and progress", () => {
    const storage = memoryStorage({
      "poker-math-academy:settings":
        '{"musicVolume":999,"muted":"yes","dealSpeed":"warp","__proto__":{"polluted":true},"controlBindings":{"keyboard":{"game.fold":["F","\\u0000bad"],"evil":["x"]}}}',
      "poker-math-academy:progress": JSON.stringify({
        playerName: "A".repeat(100),
        decisionElo: "elite",
        currentStreak: -4,
        results: [
          { scenarioId: "broken", action: "teleport" },
          {
            scenarioId: "ok",
            completedAt: "2026-08-23T00:00:00.000Z",
            action: "call",
            actionCorrect: true,
            mathCorrect: true,
            elapsedMs: 5,
            eloDelta: 1,
          },
        ],
        career: { normal: { results: "not-an-array" } },
        privileged: true,
      }),
    });
    vi.stubGlobal("localStorage", storage);

    expect(loadSettings()).toMatchObject({
      musicVolume: 100,
      muted: defaultSettings.muted,
      dealSpeed: defaultSettings.dealSpeed,
      controlBindings: { keyboard: { "game.fold": ["f"] } },
    });
    expect(loadProgress()).toMatchObject({
      playerName: "A".repeat(48),
      decisionElo: defaultProgress.decisionElo,
      currentStreak: 0,
      results: [{ scenarioId: "ok" }],
      career: { normal: { results: [] } },
    });
    expect("privileged" in loadProgress()).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("normalizes values again before browser writes", () => {
    const storage = memoryStorage({});
    vi.stubGlobal("localStorage", storage);
    saveSettings({ ...defaultSettings, musicVolume: 999 } as never);
    saveProgress({ ...defaultProgress, results: [{ action: "evil" }] } as never);

    expect(
      JSON.parse(storage.values.get("poker-training-pro:settings") ?? "{}"),
    ).toMatchObject({ musicVolume: 100 });
    expect(
      JSON.parse(storage.values.get("poker-training-pro:progress") ?? "{}"),
    ).toMatchObject({ results: [] });
  });
});
