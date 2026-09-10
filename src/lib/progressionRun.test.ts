import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  nextRunEvent,
  resolveProgressionRun,
  progressAfterTournamentResult,
} from "./progressionRun";
import { readCheckpointBank, rememberCheckpoint } from "./checkpointBank";
import { defaultProgress, defaultSettings } from "./storage";
import { createSaveEnvelope } from "./saveMigration";
import {
  createCareerTournamentRunner,
  createTournamentRunnerReplay,
  applyHeroTournamentActionOneStep,
  advanceTournamentRunnerToHero,
  restoreTournamentRunnerReplay,
  heroTournamentLegalActions,
} from "../modes/tournamentRunner";
import { listTournamentSessionEvents } from "../modes/tournamentSession";
const events = listTournamentSessionEvents([]);
const hero = { id: "hero", name: "Player", rating: 1000 };
const runner = () =>
  createCareerTournamentRunner({
    hero,
    mode: "normal",
    eventId: events[0].id,
    seed: "run-resume",
  });
it("starts at the configured first event and resumes only the active event", () => {
  expect(resolveProgressionRun().eventId).toBe(events[0].id);
  expect(
    resolveProgressionRun({ results: [], activeEventId: events[2].id }),
  ).toMatchObject({ label: "RESUME", eventId: events[2].id });
  expect(nextRunEvent(events[0].id, true)).toBe(events[1].id);
  expect(nextRunEvent(events[2].id, false)).toBeUndefined();
  expect(nextRunEvent(events.at(-1)!.id, true)).toBeUndefined();
});
it("a loss or full completion permits a new run from the beginning", () => {
  const results = events.map((e) => ({
    eventId: e.id,
    fieldSize: 6,
    sourceFieldSize: e.sourceFieldSize,
    finishPlace: 1,
    qualifyingPlaces: e.qualifyingPlaces,
    qualified: true,
    tournamentEloDelta: 1,
  }));
  expect(resolveProgressionRun({ results })).toMatchObject({
    status: "complete",
    label: "START",
    eventId: events[0].id,
  });
  results[2].qualified = false;
  expect(resolveProgressionRun({ results: results.slice(0, 3) })).toMatchObject(
    { status: "lost", label: "START", eventId: events[0].id },
  );
});
it("does not count interruption as a loss, preserves accepted actions through private save round trips", () => {
  const ready = advanceTournamentRunnerToHero(runner(), {
    policy: { simulations: 60 },
  });
  const legal = heroTournamentLegalActions(ready)!;
  const next = applyHeroTournamentActionOneStep(
    ready,
    { action: legal.check ? "check" : "call" },
    { nowMs: 1000, policy: { simulations: 60 } },
  ).runner;
  expect(progressAfterTournamentResult(defaultProgress, next)).toBe(
    defaultProgress,
  );
  const replay = createTournamentRunnerReplay(next, 60) as unknown as Record<
    string,
    unknown
  >;
  let bank = rememberCheckpoint(readCheckpointBank(), replay);
  bank = rememberCheckpoint(bank, {
    format: "poker-training-pro-training-checkpoint",
    scenarioId: "practice",
  });
  const require = createRequire(import.meta.url);
  const { createAutosaveRecord } = require("../../electron/save-store.cjs");
  const record = createAutosaveRecord(
    JSON.stringify(createSaveEnvelope(defaultSettings, defaultProgress)),
    { boundary: "action", replay: bank },
  );
  const restoredBank = readCheckpointBank(
    JSON.parse(JSON.stringify(record)).replay,
  );
  expect(restoredBank.current?.scenarioId).toBe("practice");
  const restored = restoreTournamentRunnerReplay(
    restoredBank.careers.normal as any,
  );
  expect(restored.replayActions).toEqual(next.replayActions);
  expect(restored.session.status).toBe("playing");
});
it("reads old single checkpoints without discarding them", () => {
  const replay = createTournamentRunnerReplay(
    runner(),
    60,
  ) as unknown as Record<string, unknown>;
  const bank = readCheckpointBank(replay);
  expect(bank.current).toBe(replay);
  expect(bank.careers.normal).toBe(replay);
});

it.each([true, false])(
  "persists event settlement and advancement before animations complete (qualified=%s)",
  (qualified) => {
    const completed = runner();
    const event = completed.session.event;
    completed.session = {
      ...completed.session,
      status: "complete",
      result: {
        eventId: event.id,
        finishPlace: qualified ? 1 : 6,
        fieldSize: 6,
        sourceFieldSize: event.sourceFieldSize,
        qualifyingPlaces: event.qualifyingPlaces,
        qualified,
        tournamentEloDelta: qualified ? 25 : -25,
      } as typeof completed.session.result,
    };
    const initial = {
      ...defaultProgress,
      career: {
        normal: { results: [], activeEventId: event.id },
        rational: { results: [] },
      },
    };
    const saved = progressAfterTournamentResult(initial, completed);
    expect(saved.tournamentElo).toBe(
      initial.tournamentElo + (qualified ? 25 : -25),
    );
    expect(saved.career?.normal.results).toHaveLength(1);
    expect(saved.career?.normal.activeEventId).toBe(
      qualified ? events[1].id : undefined,
    );
    expect(resolveProgressionRun(saved.career?.normal).status).toBe(
      qualified ? "active" : "lost",
    );
    // Re-saving a still-pending animation derives from the same committed UI state.
    expect(progressAfterTournamentResult(initial, completed)).toEqual(saved);
  },
);
