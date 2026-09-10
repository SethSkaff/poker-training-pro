import {
  advanceTournamentRunnerOneStep,
  heroTournamentLegalActions,
  type TournamentRunner,
  type TournamentPresentationStep,
} from "../modes/tournamentRunner";
/** Fast-forward engine transitions, then retain the real result/reveals and its exact table source. */
export function skipToOutcome(
  source: TournamentRunner,
  step: TournamentPresentationStep,
  nowMs = Date.now(),
) {
  for (let count = 0; count < 2000; count += 1) {
    const resultIndex = step.events.findIndex(
      (e) => e.kind === "showdown" || e.kind === "hand-result",
    );
    if (resultIndex >= 0)
      return {
        source,
        step: { ...step, events: step.events.slice(resultIndex) },
      };
    source = step.runner;
    if (
      source.session.status === "complete" ||
      heroTournamentLegalActions(source)
    )
      return {
        source,
        step: {
          runner: source,
          events: [],
          awaitingHero: Boolean(heroTournamentLegalActions(source)),
        },
      };
    step = advanceTournamentRunnerOneStep(source, {
      nowMs,
      policy: { simulations: 60 },
    });
  }
  throw new Error("Skip exceeded the tournament transition limit");
}
