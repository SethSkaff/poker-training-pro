import { describe, expect, it } from "vitest";
import {
  advanceTournamentSessionClock,
  createTournamentSession,
} from "./tournamentSession";

const hero = { id: "hero", name: "Player", rating: 1_000 };

function freshLocalQualifier() {
  return createTournamentSession({
    eventId: "local-qualifier",
    hero,
    mode: "normal",
    seed: "blind-schedule",
  });
}

/*
  The Local Qualifier runs four-minute levels, so 240_000 ms of real table time
  is the first boundary. These tests are about how that budget is *spent*: the
  table submits an elapsed figure with every hero action, and it used to submit
  the running per-hand total rather than the time since its last submission.
  Six decisions across three real minutes were reported as 10.5 minutes of
  tournament time, which is two and a half levels (E27-004).
*/
const LEVEL_MS = 240_000;

describe("the blind schedule advances by real time, not by action count", () => {
  it("starts a fresh event on level one with an empty clock", () => {
    const session = freshLocalQualifier();
    expect(session.tournament.levelIndex).toBe(0);
    expect(session.tournament.levelElapsedMs).toBe(0);
    expect(session.tournament.structure.levels[0].durationMs).toBe(LEVEL_MS);
  });

  it("does not raise blinds during a first hand of ordinary length", () => {
    // Six hero decisions, thirty seconds apart: three minutes of real time,
    // comfortably inside a four-minute level.
    let session = freshLocalQualifier();
    for (let decision = 0; decision < 6; decision += 1) {
      session = advanceTournamentSessionClock(session, 30_000);
    }
    expect(session.tournament.levelIndex).toBe(0);
    expect(session.tournament.levelElapsedMs).toBe(180_000);
  });

  it("reaches the same level for the same real time however it is divided", () => {
    // The invariant the regression violated. Ten seconds submitted eighteen
    // times must land exactly where three minutes submitted once lands.
    const asOneSubmission = advanceTournamentSessionClock(
      freshLocalQualifier(),
      180_000,
    );
    let asManySubmissions = freshLocalQualifier();
    for (let index = 0; index < 18; index += 1) {
      asManySubmissions = advanceTournamentSessionClock(
        asManySubmissions,
        10_000,
      );
    }

    expect(asManySubmissions.tournament.levelIndex).toBe(
      asOneSubmission.tournament.levelIndex,
    );
    expect(asManySubmissions.tournament.levelElapsedMs).toBe(
      asOneSubmission.tournament.levelElapsedMs,
    );
  });

  it("shows what the old cumulative feed did, so the fix is not theoretical", () => {
    // Reconstruct the defect: decisions at 30s intervals, each submitting the
    // whole running total (30, 60, 90, 120, 150, 180) instead of the delta.
    let broken = freshLocalQualifier();
    let cumulative = 0;
    for (let decision = 0; decision < 6; decision += 1) {
      cumulative += 30_000;
      broken = advanceTournamentSessionClock(broken, cumulative);
    }
    // 630 seconds of "tournament time" from 180 seconds of real time.
    expect(broken.tournament.levelIndex).toBeGreaterThan(0);

    // The corrected feed submits deltas and stays on level one.
    let fixed = freshLocalQualifier();
    for (let decision = 0; decision < 6; decision += 1) {
      fixed = advanceTournamentSessionClock(fixed, 30_000);
    }
    expect(fixed.tournament.levelIndex).toBe(0);
  });

  it("still raises blinds once the level's real time is genuinely spent", () => {
    // The fix must not freeze the schedule: crossing the boundary honestly
    // still advances the level.
    let session = freshLocalQualifier();
    for (let minute = 0; minute < 5; minute += 1) {
      session = advanceTournamentSessionClock(session, 60_000);
    }
    expect(session.tournament.levelIndex).toBe(1);
    expect(session.tournament.levelElapsedMs).toBe(60_000);
  });

  it("carries remaining time into the next level rather than discarding it", () => {
    const session = advanceTournamentSessionClock(
      freshLocalQualifier(),
      LEVEL_MS + 45_000,
    );
    expect(session.tournament.levelIndex).toBe(1);
    expect(session.tournament.levelElapsedMs).toBe(45_000);
  });
});
