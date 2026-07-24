import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTournamentRunnerReplay,
  heroTournamentLegalActions,
  restoreTournamentRunnerReplay,
} from "../modes/tournamentRunner";

const require = createRequire(import.meta.url);
const replayExport = require("../../electron/replay-export.cjs") as {
  createPublicReplayArtifact(
    source: unknown,
    buildVersion?: string,
  ): { ok: true; serialized: string } | { ok: false; error: { code: string } };
};

const hero = { id: "hero-private-id", name: "Player One", rating: 1000 };
const SEED = "public-replay-completed-event-seed";

function completeEventReplay(): Record<string, unknown> {
  let runner = advanceTournamentRunnerToHero(
    createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "normal",
      seed: SEED,
    }),
    { policy: { simulations: 50 } },
  );
  for (let step = 0; step < 500 && !runner.session.result; step += 1) {
    const legal = heroTournamentLegalActions(runner);
    if (!legal) {
      runner = advanceTournamentRunnerToHero(runner, {
        policy: { simulations: 50 },
      });
      continue;
    }
    const action = legal.allIn
      ? "all-in"
      : legal.call
        ? "call"
        : legal.check
          ? "check"
          : "fold";
    runner = applyHeroTournamentAction(
      runner,
      { action, decisionElapsedMs: 800 },
      { policy: { simulations: 50 } },
    );
  }
  return createTournamentRunnerReplay(runner, 50) as unknown as Record<
    string,
    unknown
  >;
}

describe("public replay export from a completed event", () => {
  it("keeps a completed runner replay restorable for post-restart export", () => {
    const source = completeEventReplay();
    const restored = restoreTournamentRunnerReplay(source as never);

    expect(restored.session.status).toBe("complete");
    expect(restored.session.result).toBeDefined();
  }, 15_000);

  it("produces a redacted artifact that omits the seed and any hidden cards", () => {
    const source = completeEventReplay();
    // The source checkpoint intentionally carries the deterministic seed so the
    // event can be reproduced privately; the public artifact must not.
    expect(source.seed).toBe(SEED);

    const result = replayExport.createPublicReplayArtifact(source, "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const artifact = JSON.parse(result.serialized) as Record<string, unknown>;
    expect(artifact.format).toBe("poker-training-pro-public-replay");
    const tournament = artifact.tournament as Record<string, unknown>;
    expect(tournament.eventId).toBe("local-qualifier");
    expect(Array.isArray(tournament.blindSchedule)).toBe(true);
    expect(Array.isArray(artifact.actions)).toBe(true);
    expect((artifact.actions as unknown[]).length).toBeGreaterThan(0);

    // Strict-allowlist review: no seed, hero private id, hole cards, deck, or
    // per-action wall-clock timestamps leak into the shareable artifact.
    for (const secret of [
      SEED,
      "hero-private-id",
      "holeCards",
      "opponentCards",
      "deck",
      "nowMs",
      "seed",
    ]) {
      expect(result.serialized, secret).not.toContain(secret);
    }
    // Only the allowlisted action shape (sequence/action/raiseTo/elapsed).
    for (const entry of artifact.actions as Array<Record<string, unknown>>) {
      expect(Object.keys(entry).sort()).toEqual(
        expect.arrayContaining(["action", "sequence"]),
      );
      expect(entry).not.toHaveProperty("nowMs");
    }
  });
});
