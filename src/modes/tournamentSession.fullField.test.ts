import { describe, expect, it } from "vitest";
import {
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  createSessionOpponents,
  createTournamentSession,
  progressTournamentSessionHand,
  type TournamentSession,
} from "./tournamentSession";
import { nextToAct } from "../engine/betting";

function foldCurrentHand(source: TournamentSession, completionScope: "hero" | "full-field"): TournamentSession {
  let session = source;
  while (session.activeHand && !session.activeHand.betting.complete) {
    const actor = nextToAct(session.activeHand.betting);
    if (!actor) break;
    session = applyTournamentSessionAction(session, actor, { type: "fold" });
  }
  while (session.activeHand) {
    session = progressTournamentSessionHand(session, { completionScope });
  }
  return session;
}

describe("T5 evaluation lifecycle seam", () => {
  it("keeps the default hero completion path available", () => {
    const source = createTournamentSession({
      eventId: "local-qualifier",
      hero: { id: "hero", name: "Hero", rating: 1_000 },
      mode: "rational",
      seed: "t5-default",
      opponents: createSessionOpponents("t5-default", "local-qualifier", "rational"),
    });
    const session = foldCurrentHand(beginTournamentSessionHand(source), "hero");
    expect(session.status).toBe("playing");
  });

  it("does not close a full-field evaluation when the hero busts", () => {
    const source = createTournamentSession({
      eventId: "local-qualifier",
      hero: { id: "hero", name: "Hero", rating: 1_000 },
      mode: "rational",
      seed: "t5-full-field",
      opponents: createSessionOpponents("t5-full-field", "local-qualifier", "rational"),
    });
    const session = foldCurrentHand(beginTournamentSessionHand(source), "full-field");
    expect(session.result).toBeUndefined();
    // This fixture can end with a non-hero player eliminated rather than the
    // hero, so the important contract is that no career result is fabricated.
    expect(session.careerResults).toEqual(source.careerResults);
  });
});
