import { describe, expect, it, vi } from "vitest";
import {
  DurablePersistence,
  type DesktopPersistenceBridge,
  type DurableSaveReceipt,
  type RawGeneration,
} from "./durablePersistence";
import {
  SAVE_FORMAT,
  serializeSaveBackup,
} from "./saveMigration";
import { defaultProgress, defaultSettings } from "./storage";

const receipt: DurableSaveReceipt = {
  boundary: "action",
  savedAt: "2026-07-23T12:00:00.000Z",
  rotatedPrevious: false,
  ignoredCorruptCurrent: false,
};

function save(playerName = "Player"): string {
  return serializeSaveBackup(defaultSettings, {
    ...defaultProgress,
    playerName,
  });
}

function generation(
  source: RawGeneration["source"],
  payload = save(),
): RawGeneration {
  return {
    source,
    exists: true,
    record: {
      boundary: "hand",
      savedAt: "2026-07-23T11:00:00.000Z",
      payload,
    },
  };
}

function bridge(
  overrides: Partial<DesktopPersistenceBridge> = {},
): DesktopPersistenceBridge {
  return {
    loadAutosave: vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "no-valid-generation",
        generations: [
          { source: "current" as const, code: "missing" },
          { source: "previous" as const, code: "missing" },
        ],
      },
    })),
    probeAutosaves: vi.fn(async () => ({
      generations: [
        { source: "current", exists: false },
        { source: "previous", exists: false },
        { source: "last-known-good", exists: false },
      ] satisfies RawGeneration[],
    })),
    commitAutosave: vi.fn(async (_serializedSave, boundary) => ({
      ok: true as const,
      receipt: { ...receipt, boundary },
    })),
    ...overrides,
  };
}

function storage(values: Record<string, string>) {
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
  };
}

describe("durable startup loading", () => {
  it("loads and validates the authoritative current generation", async () => {
    const persistence = new DurablePersistence(
      bridge({
        probeAutosaves: async () => ({
          generations: [generation("current", save("Current Player"))],
        }),
      }),
    );

    await expect(persistence.loadStartup()).resolves.toMatchObject({
      kind: "ready",
      source: "current",
      save: {
        data: { progress: { playerName: "Current Player" } },
      },
    });
  });

  it("enters recovery instead of silently loading a previous generation", async () => {
    const persistence = new DurablePersistence(
      bridge({
        probeAutosaves: async () => ({
          generations: [
            {
              source: "current",
              exists: true,
              error: { code: "checksum-mismatch" },
            },
            generation("previous", save("Previous Player")),
          ],
        }),
      }),
    );

    await expect(persistence.loadStartup()).resolves.toMatchObject({
      kind: "recovery",
      attempts: [{ code: "checksum-mismatch", source: "current" }],
      recommended: {
        source: "previous",
        save: { data: { progress: { playerName: "Previous Player" } } },
      },
    });
  });

  it("blocks browser import when an authoritative future save exists", async () => {
    const browser = storage({
      "poker-training-pro:progress": JSON.stringify({
        ...defaultProgress,
        playerName: "Browser Player",
      }),
    });
    const future = JSON.stringify({
      format: SAVE_FORMAT,
      version: 99,
      data: { settings: defaultSettings, progress: defaultProgress },
    });
    const persistence = new DurablePersistence(
      bridge({
        probeAutosaves: async () => ({
          generations: [generation("current", future)],
        }),
      }),
      browser,
    );

    await expect(persistence.loadStartup()).resolves.toMatchObject({
      kind: "recovery",
      attempts: [{ code: "unsupported-save-version", source: "current" }],
    });
    expect(browser.getItem).not.toHaveBeenCalled();
  });

  it("does not import browser data when only archived save evidence remains", async () => {
    const browser = storage({
      "poker-training-pro:progress": JSON.stringify(defaultProgress),
    });
    const persistence = new DurablePersistence(
      bridge({
        probeAutosaves: async () => ({
          generations: [
            { source: "current", exists: false },
            { source: "previous", exists: false },
            { source: "last-known-good", exists: false },
          ],
          hasAuthoritativeEvidence: true,
        }),
      }),
      browser,
    );

    await expect(persistence.loadStartup()).resolves.toMatchObject({
      kind: "recovery",
      failure: { code: "no-valid-generation" },
    });
    expect(browser.getItem).not.toHaveBeenCalled();
  });
});

describe("one-time browser import", () => {
  it("prefers current keys, validates them, and returns a preview before writing", async () => {
    const browser = storage({
      "poker-training-pro:settings": JSON.stringify({
        ...defaultSettings,
        musicVolume: 17,
      }),
      "poker-training-pro:progress": JSON.stringify({
        ...defaultProgress,
        playerName: "Current Import",
        trainingCompleted: 12,
      }),
      "poker-math-academy:progress": JSON.stringify({
        ...defaultProgress,
        playerName: "Legacy Import",
      }),
    });
    const desktop = bridge();
    const persistence = new DurablePersistence(desktop, browser);

    const startup = await persistence.loadStartup();

    expect(startup).toMatchObject({
      kind: "import-ready",
      candidate: {
        sourceKeys: [
          "poker-training-pro:settings",
          "poker-training-pro:progress",
        ],
        preview: {
          playerName: "Current Import",
          trainingCompleted: 12,
        },
      },
    });
    expect(desktop.commitAutosave).not.toHaveBeenCalled();
  });

  it("commits a validated import exactly once before reporting it ready", async () => {
    const desktop = bridge();
    const persistence = new DurablePersistence(
      desktop,
      storage({
        "poker-math-academy:progress": JSON.stringify({
          ...defaultProgress,
          playerName: "Legacy Player",
        }),
      }),
    );
    const startup = await persistence.loadStartup();
    expect(startup.kind).toBe("import-ready");
    if (startup.kind !== "import-ready") return;

    await expect(
      persistence.confirmBrowserImport(startup.candidate),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        kind: "ready",
        source: "browser-import",
        save: { data: { progress: { playerName: "Legacy Player" } } },
      },
    });
    expect(desktop.commitAutosave).toHaveBeenCalledTimes(1);
    expect(desktop.commitAutosave).toHaveBeenCalledWith(
      startup.candidate.serializedSave,
      "lifecycle",
      undefined,
    );
  });

  it("treats malformed existing browser data as recovery evidence", async () => {
    const persistence = new DurablePersistence(
      bridge(),
      storage({ "poker-training-pro:progress": "{partial" }),
    );

    await expect(persistence.loadStartup()).resolves.toMatchObject({
      kind: "recovery",
      failure: {
        code: "invalid-json",
        source: "browser-import",
      },
    });
  });

  it("does not mark an import complete when its file commit fails", async () => {
    const desktop = bridge({
      commitAutosave: vi.fn(async () => ({
        ok: false as const,
        error: { code: "ENOSPC", systemCode: "ENOSPC" },
      })),
    });
    const browser = storage({
      "poker-training-pro:progress": JSON.stringify(defaultProgress),
    });
    const persistence = new DurablePersistence(desktop, browser);
    const startup = await persistence.loadStartup();
    expect(startup.kind).toBe("import-ready");
    if (startup.kind !== "import-ready") return;

    await expect(
      persistence.confirmBrowserImport(startup.candidate),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "disk-full", retryable: true },
    });
    expect(browser.getItem).toHaveBeenCalled();
  });
});

describe("action and hand boundary durability", () => {
  it("uses explicit action and hand IPC boundaries", async () => {
    const desktop = bridge();
    const persistence = new DurablePersistence(desktop);

    await persistence.commitAction(defaultSettings, defaultProgress, {
      publicActionLog: [{ type: "call" }],
    });
    await persistence.commitHand(defaultSettings, defaultProgress);

    expect(desktop.commitAutosave).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      "action",
      { publicActionLog: [{ type: "call" }] },
    );
    expect(desktop.commitAutosave).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      "hand",
      undefined,
    );
  });

  it("keeps failed writes retryable until Electron acknowledges durability", async () => {
    const commitAutosave = vi
      .fn<DesktopPersistenceBridge["commitAutosave"]>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "ENOSPC", systemCode: "ENOSPC" },
      })
      .mockResolvedValueOnce({ ok: true, receipt });
    const persistence = new DurablePersistence(
      bridge({ commitAutosave }),
    );

    await expect(
      persistence.commitAction(defaultSettings, defaultProgress),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "disk-full", retryable: true },
    });
    expect(persistence.hasPendingCommit()).toBe(true);

    await expect(persistence.retryPendingCommit()).resolves.toMatchObject({
      ok: true,
      value: receipt,
    });
    expect(persistence.hasPendingCommit()).toBe(false);
    expect(commitAutosave).toHaveBeenCalledTimes(2);
  });
});

describe("player-controlled save transfer facade", () => {
  it("keeps save import preview and confirmation as separate IPC calls", async () => {
    const prepareSaveImport = vi.fn(async () => ({
      ok: true as const,
      preview: {
        confirmationToken: "confirmation-token-123456",
        expiresAt: "2026-07-23T12:05:00.000Z",
        migratedFromVersion: 1 as const,
        trainingCompleted: 12,
        resultCount: 3,
        decisionElo: 1010,
        mathElo: 1020,
        tournamentElo: 1030,
        settingsWillBeReplaced: true as const,
        progressWillBeReplaced: true as const,
      },
    }));
    const confirmSaveImport = vi.fn(async () => ({
      ok: true as const,
      receipt: { ...receipt, boundary: "lifecycle" as const },
    }));
    const persistence = new DurablePersistence(
      bridge({ prepareSaveImport, confirmSaveImport }),
    );

    const preview = await persistence.prepareSaveImport();
    expect(preview).toMatchObject({
      ok: true,
      value: {
        trainingCompleted: 12,
        settingsWillBeReplaced: true,
      },
    });
    expect(confirmSaveImport).not.toHaveBeenCalled();
    if (!preview.ok) return;
    await expect(
      persistence.confirmSaveImport(preview.value.confirmationToken),
    ).resolves.toMatchObject({
      ok: true,
      value: { boundary: "lifecycle" },
    });
    expect(confirmSaveImport).toHaveBeenCalledWith(
      "confirmation-token-123456",
    );
  });

  it("maps stale import and reset confirmation failures without leaking detail", async () => {
    const persistence = new DurablePersistence(
      bridge({
        confirmSaveImport: async () => ({
          ok: false,
          error: { code: "import-changed" },
        }),
        confirmProgressReset: async () => ({
          ok: false,
          error: { code: "save-changed" },
        }),
      }),
    );

    await expect(
      persistence.confirmSaveImport("confirmation-token-123456"),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "import-changed", operation: "import" },
    });
    await expect(
      persistence.confirmProgressReset("confirmation-token-123456"),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "save-changed", operation: "reset" },
    });
  });

  it("keeps progress reset preview and confirmation as separate IPC calls", async () => {
    const prepareProgressReset = vi.fn(async () => ({
      ok: true as const,
      preview: {
        confirmationToken: "confirmation-token-123456",
        expiresAt: "2026-07-23T12:05:00.000Z",
        trainingCompleted: 20,
        resultCount: 8,
        settingsWillBePreserved: true as const,
        progressWillBeReset: true as const,
      },
    }));
    const confirmProgressReset = vi.fn(async () => ({
      ok: true as const,
      receipt: { ...receipt, boundary: "lifecycle" as const },
    }));
    const persistence = new DurablePersistence(
      bridge({ prepareProgressReset, confirmProgressReset }),
    );

    const preview = await persistence.prepareProgressReset();
    expect(preview).toMatchObject({
      ok: true,
      value: {
        trainingCompleted: 20,
        settingsWillBePreserved: true,
      },
    });
    expect(confirmProgressReset).not.toHaveBeenCalled();
    if (!preview.ok) return;
    await persistence.confirmProgressReset(
      preview.value.confirmationToken,
    );
    expect(confirmProgressReset).toHaveBeenCalledWith(
      "confirmation-token-123456",
    );
  });
});

describe("narrow replay export facade", () => {
  it("forwards public replay data without accepting a destination path", async () => {
    const exportPublicReplay = vi.fn(async () => ({
      ok: true as const,
      fileName: "public-replay.json",
      kind: "public" as const,
    }));
    const persistence = new DurablePersistence(
      bridge({ exportPublicReplay }),
    );
    const replay = {
      format: "poker-training-pro-tournament-replay",
      version: 1,
    };

    await expect(
      persistence.exportPublicReplay(replay),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        fileName: "public-replay.json",
        kind: "public",
      },
    });
    expect(exportPublicReplay).toHaveBeenCalledWith(replay);
  });

  it("maps production developer-export denial to a stable failure", async () => {
    const persistence = new DurablePersistence(
      bridge({
        exportDeveloperReplay: async () => ({
          ok: false,
          error: { code: "developer-export-disabled" },
        }),
      }),
    );

    await expect(
      persistence.exportDeveloperReplay({}),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "developer-export-disabled",
        operation: "replay-export",
        retryable: false,
      },
    });
  });
});
