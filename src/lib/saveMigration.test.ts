import { describe, expect, it } from "vitest";
import { defaultProgress, defaultSettings } from "./storage";
import {
  CURRENT_SAVE_VERSION,
  LAST_KNOWN_GOOD_KEY,
  SAVE_FORMAT,
  createSaveEnvelope,
  migrateSavePayload,
  readLastKnownGoodBackup,
  restoreSaveBackup,
  serializeSaveBackup,
  writeLastKnownGoodBackup,
  type KeyValueStorage,
} from "./saveMigration";

function progressFixture() {
  return {
    ...defaultProgress,
    playerName: "River",
    decisionElo: 1128,
    mathElo: 1096,
    tournamentElo: 1044,
    trainingCompleted: 7,
    currentStreak: 2,
    bestStreak: 5,
    totalDecisionMs: 12_345,
    unlockedCircuit: 2,
    results: [
      {
        scenarioId: "turn-pot-odds",
        completedAt: "2026-07-23T12:00:00.000Z",
        action: "call" as const,
        actionCorrect: true,
        mathAnswer: 25,
        mathCorrect: true,
        elapsedMs: 4321,
        eloDelta: 12,
      },
    ],
  };
}

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("versioned save migration", () => {
  it("preserves current settings, Elo, timing, unlocks, and results", () => {
    const settings = { ...defaultSettings, musicVolume: 18, colorAssist: true };
    const restored = restoreSaveBackup(
      serializeSaveBackup(settings, progressFixture()),
    );

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.save).toEqual({
      format: SAVE_FORMAT,
      version: CURRENT_SAVE_VERSION,
      data: { settings, progress: progressFixture() },
    });
    expect(restored.migratedFromVersion).toBe(1);
  });

  it("migrates the original unversioned settings/progress shape", () => {
    const migrated = migrateSavePayload({
      settings: { ...defaultSettings, dealSpeed: "quick" },
      progress: progressFixture(),
    });

    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.migratedFromVersion).toBe(0);
    expect(migrated.save.version).toBe(1);
    expect(migrated.save.data.settings.dealSpeed).toBe("quick");
    expect(migrated.save.data.progress.playerName).toBe("River");
  });

  it("supports an explicit version-zero data envelope", () => {
    const migrated = migrateSavePayload({
      version: 0,
      data: {
        settings: defaultSettings,
        progress: progressFixture(),
      },
    });

    expect(migrated.ok).toBe(true);
    if (migrated.ok) expect(migrated.migratedFromVersion).toBe(0);
  });

  it("rejects malformed JSON, primitives, unknown formats, and future versions", () => {
    expect(restoreSaveBackup("{nope").ok).toBe(false);
    expect(migrateSavePayload(null)).toMatchObject({
      ok: false,
      error: { code: "invalid-payload" },
    });
    expect(
      migrateSavePayload({ format: "another-game", version: 1, data: {} }),
    ).toMatchObject({
      ok: false,
      error: { code: "unknown-format" },
    });
    expect(
      migrateSavePayload({ format: SAVE_FORMAT, version: 99, data: {} }),
    ).toMatchObject({
      ok: false,
      error: { code: "unsupported-version" },
    });
    expect(
      migrateSavePayload({ format: SAVE_FORMAT, version: 1, data: {} }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-payload" },
    });
  });

  it("recovers safe fields while normalizing corrupt leaves", () => {
    const save = createSaveEnvelope(
      {
        ...defaultSettings,
        musicVolume: 800,
        effectsVolume: Number.NaN,
        reducedMotion: "yes",
        dealSpeed: "warp",
      },
      {
        ...progressFixture(),
        playerName: "",
        decisionElo: Number.POSITIVE_INFINITY,
        currentStreak: -4,
        bestStreak: 1,
        totalDecisionMs: -10,
        results: [
          ...progressFixture().results,
          { scenarioId: "broken", action: "teleport" },
        ],
      },
    );

    expect(save.data.settings).toMatchObject({
      musicVolume: 100,
      effectsVolume: defaultSettings.effectsVolume,
      reducedMotion: defaultSettings.reducedMotion,
      dealSpeed: defaultSettings.dealSpeed,
    });
    expect(save.data.progress).toMatchObject({
      playerName: defaultProgress.playerName,
      decisionElo: defaultProgress.decisionElo,
      currentStreak: 0,
      bestStreak: 1,
      totalDecisionMs: 0,
    });
    expect(save.data.progress.results).toEqual(progressFixture().results);
  });

  it("caps history without mutating the source progress", () => {
    const progress = progressFixture();
    progress.results = Array.from({ length: 300 }, (_, index) => ({
      ...progressFixture().results[0],
      scenarioId: `scenario-${index}`,
    }));

    const envelope = createSaveEnvelope(defaultSettings, progress);
    expect(envelope.data.progress.results).toHaveLength(250);
    expect(envelope.data.progress.results[0].scenarioId).toBe("scenario-50");
    expect(progress.results).toHaveLength(300);
  });
});

describe("deterministic last-known-good backups", () => {
  it("serializes equal values identically despite key insertion order", () => {
    const first = createSaveEnvelope(defaultSettings, progressFixture());
    const reordered = {
      version: 1,
      data: {
        progress: progressFixture(),
        settings: { ...defaultSettings },
      },
      format: SAVE_FORMAT,
    };

    expect(serializeSaveBackup(first)).toBe(serializeSaveBackup(reordered));
  });

  it("writes and restores a validated last-known-good snapshot", () => {
    const storage = new MemoryStorage();
    const written = writeLastKnownGoodBackup(
      storage,
      defaultSettings,
      progressFixture(),
    );
    const restored = readLastKnownGoodBackup(storage);

    expect(written.ok).toBe(true);
    expect(storage.values.has(LAST_KNOWN_GOOD_KEY)).toBe(true);
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.save.data.progress.playerName).toBe("River");
    }
  });

  it("reports missing or inaccessible storage without throwing", () => {
    const storage = new MemoryStorage();
    expect(readLastKnownGoodBackup(storage)).toMatchObject({
      ok: false,
      error: { code: "invalid-payload" },
    });

    const unavailable: KeyValueStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readLastKnownGoodBackup(unavailable)).toMatchObject({
      ok: false,
      error: { code: "storage-unavailable" },
    });
    expect(
      writeLastKnownGoodBackup(
        unavailable,
        defaultSettings,
        progressFixture(),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "storage-unavailable" },
    });
  });
});
