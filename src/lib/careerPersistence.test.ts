import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createSaveEnvelope,
  restoreSaveBackup,
  serializeSaveBackup,
} from "./saveMigration";
import { defaultProgress, defaultSettings } from "./storage";
import type { CareerEventResult, PlayerProgress } from "../types/poker";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const result = (eventId: string, qualified: boolean): CareerEventResult => ({
  eventId,
  finishPlace: qualified ? 1 : 4,
  fieldSize: 6,
  sourceFieldSize: 240,
  qualifyingPlaces: 2,
  qualified,
  tournamentEloDelta: qualified ? 18 : -7,
});

const progressWithCareer = (): PlayerProgress => ({
  ...defaultProgress,
  career: {
    normal: {
      results: [result("local-qualifier", true), result("regional-classic", false)],
      activeEventId: "regional-classic",
    },
    rational: { results: [] },
  },
});

describe("career persistence", () => {
  it("round-trips career progress through the save envelope", () => {
    const restored = restoreSaveBackup(
      serializeSaveBackup(defaultSettings, progressWithCareer()),
    );

    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const career = restored.save.data.progress.career;
    expect(career?.normal.results).toHaveLength(2);
    expect(career?.normal.activeEventId).toBe("regional-classic");
    expect(career?.normal.results[0]).toEqual(result("local-qualifier", true));
    expect(career?.rational.results).toEqual([]);
  });

  it("migrates a legacy save with no career field to empty tracks", () => {
    // The field is new, so every existing save on disk lacks it entirely.
    const legacy = { ...defaultProgress } as Record<string, unknown>;
    delete legacy.career;

    const envelope = createSaveEnvelope(defaultSettings, legacy);
    expect(envelope.data.progress.career).toEqual({
      normal: { results: [] },
      rational: { results: [] },
    });
  });

  it("discards malformed career entries without rejecting the save", () => {
    const envelope = createSaveEnvelope(defaultSettings, {
      ...defaultProgress,
      career: {
        normal: {
          results: [
            result("local-qualifier", true),
            { eventId: 42 },
            null,
            { notAnEvent: true },
          ],
          activeEventId: 17,
        },
        rational: "not a track",
      },
    });

    const career = envelope.data.progress.career;
    expect(career?.normal.results).toHaveLength(1);
    expect(career?.normal.results[0]?.eventId).toBe("local-qualifier");
    expect(career?.normal.activeEventId).toBeUndefined();
    expect(career?.rational.results).toEqual([]);
  });

  it("keeps one entry per event when an event is replayed", () => {
    const envelope = createSaveEnvelope(defaultSettings, {
      ...defaultProgress,
      career: {
        normal: {
          results: [
            result("local-qualifier", false),
            result("local-qualifier", true),
          ],
        },
        rational: { results: [] },
      },
    });

    const results = envelope.data.progress.career?.normal.results ?? [];
    expect(results).toHaveLength(1);
    // The later entry wins: a replay supersedes its earlier attempt.
    expect(results[0]?.qualified).toBe(true);
  });

  it("keeps Normal and Rational careers on separate tracks", () => {
    const envelope = createSaveEnvelope(defaultSettings, progressWithCareer());
    expect(envelope.data.progress.career?.normal.results).toHaveLength(2);
    expect(envelope.data.progress.career?.rational.results).toHaveLength(0);
  });

  it("writes career state through a real persist boundary, not ephemeral state", () => {
    // The original defect was `useState(emptyTourResults)` that never reached
    // disk. Guard the shape of the fix: career must be derived from `progress`
    // (which persistBoundary writes) and never held in component state.
    const app = readFileSync(path.join(sourceRoot, "App.tsx"), "utf8");
    expect(app).not.toContain("setTourResults");
    expect(app).toContain("progress.career?.normal.results");
    expect(app).toContain("careerWithCompletedEvent(");
    expect(app).toContain("careerWithActiveEvent(");
  });

  it("mirrors the career schema in the main-process save validator", () => {
    // The Electron import path validates against its own allowlist, so a field
    // added only on the renderer side is silently stripped on import.
    const transfer = readFileSync(
      path.join(sourceRoot, "..", "electron", "save-transfer.cjs"),
      "utf8",
    );
    expect(transfer).toContain("function validateCareer(");
    expect(transfer).toContain("function validateCareerTrack(");
    expect(transfer).toContain("function validateCareerResult(");
    expect(transfer).toContain("career: career.value");
  });
});

describe("review aggregates", () => {
  it("round-trips lifetime review totals", () => {
    const envelope = createSaveEnvelope(defaultSettings, {
      ...defaultProgress,
      reviewTotals: {
        roundsReviewed: 3,
        decisions: 47,
        bestDecisions: 31,
        totalRegretBigBlinds: 12.5,
      },
    });
    expect(envelope.data.progress.reviewTotals).toEqual({
      roundsReviewed: 3,
      decisions: 47,
      bestDecisions: 31,
      totalRegretBigBlinds: 12.5,
    });
  });

  it("migrates a save written before reviews existed", () => {
    const legacy = { ...defaultProgress } as Record<string, unknown>;
    delete legacy.reviewTotals;
    expect(
      createSaveEnvelope(defaultSettings, legacy).data.progress.reviewTotals,
    ).toEqual({
      roundsReviewed: 0,
      decisions: 0,
      bestDecisions: 0,
      totalRegretBigBlinds: 0,
    });
  });

  it("clamps totals that cannot be true", () => {
    // More "best" decisions than decisions is not a reason to reject a save,
    // but it must not be shown as an accuracy above 100%.
    const envelope = createSaveEnvelope(defaultSettings, {
      ...defaultProgress,
      reviewTotals: {
        roundsReviewed: 1,
        decisions: 10,
        bestDecisions: 999,
        totalRegretBigBlinds: -5,
      },
    });
    expect(envelope.data.progress.reviewTotals?.bestDecisions).toBe(10);
    expect(envelope.data.progress.reviewTotals?.totalRegretBigBlinds).toBe(0);
  });

  it("persists only aggregates, never per-decision annotations", () => {
    // The review recomputes annotations from the replay on demand; storing
    // them would be the second hand-history database E18-001 rules out.
    const review = readFileSync(
      path.join(sourceRoot, "modes", "handReview.ts"),
      "utf8",
    );
    expect(review).not.toContain("persistBoundary");
    expect(review).not.toContain("localStorage");
    const app = readFileSync(path.join(sourceRoot, "App.tsx"), "utf8");
    expect(app).toContain("reviewTotals:");
    expect(app).not.toContain("reviewDecisions:");
  });

  it("mirrors the review schema in the main-process validator", () => {
    const transfer = readFileSync(
      path.join(sourceRoot, "..", "electron", "save-transfer.cjs"),
      "utf8",
    );
    expect(transfer).toContain("function validateReviewTotals(");
    expect(transfer).toContain("reviewTotals: validateReviewTotals(");
  });
});
