/**
 * Browserless iOS adapter around the desktop tournament runner. This is built
 * into an IIFE for JavaScriptCore; Swift receives only a hero-safe table
 * snapshot and an opaque replay checkpoint, never opponents' hole cards.
 */
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTimedTournamentRunner,
  createTournamentRunnerReplay,
  heroTournamentLegalActions,
  restoreTournamentRunnerReplay,
  type TournamentRunner,
  type TournamentRunnerReplay,
} from "../src/modes/tournamentRunner";
import { createPokerTableSnapshot } from "../src/modes/tournamentSession";

type Request = { operation: string; payload?: Record<string, unknown> };

const simulations = 60;

// JavaScriptCore cannot be assumed to expose structuredClone on every iOS 17
// runtime. Tournament state is deliberately JSON-only, so this fallback is
// safe and keeps the shared desktop engine browserless/on-device.
if (typeof globalThis.structuredClone !== "function") {
  Object.defineProperty(globalThis, "structuredClone", {
    value: <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value,
    configurable: true,
  });
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tournament request payload must be an object");
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function careerResults(value: unknown) {
  // Only public completion fields are supplied by Swift. The runner owns
  // validation and career progression; no hidden tournament state is rebuilt.
  return Array.isArray(value) ? value : [];
}

function runnerResponse(runner: TournamentRunner) {
  const replay = createTournamentRunnerReplay(runner, simulations);
  const complete = runner.session.status === "complete";
  return {
    replay,
    complete,
    ...(complete ? { result: runner.session.result } : {}),
    ...(!complete && runner.session.activeHand
      ? {
          table: createPokerTableSnapshot(runner.session),
          legalActions: heroTournamentLegalActions(runner),
        }
      : {}),
  };
}

function create(payload: Record<string, unknown>) {
  const hero = asObject(payload.hero);
  const seed = String(payload.seed ?? "ios-session");
  const nowMs = number(payload.nowMs, 0);
  const runner = payload.kind === "timed"
    ? createTimedTournamentRunner({
        minutes: Math.max(5, Math.min(180, Math.trunc(number(payload.minutes, 30)))),
        hero: { id: String(hero.id), name: String(hero.name), rating: number(hero.rating, 1200) },
        seed,
        nowMs,
      })
    : createCareerTournamentRunner({
        eventId: String(payload.eventId ?? "local-qualifier"),
        hero: { id: String(hero.id), name: String(hero.name), rating: number(hero.rating, 1200) },
        mode: payload.mode === "rational" ? "rational" : "normal",
        seed,
        careerResults: careerResults(payload.careerResults),
      });
  return runnerResponse(advanceTournamentRunnerToHero(runner, { nowMs, policy: { simulations } }));
}

function act(payload: Record<string, unknown>) {
  const replay = payload.replay as TournamentRunnerReplay;
  const action = String(payload.action);
  const runner = restoreTournamentRunnerReplay(replay);
  const next = applyHeroTournamentAction(runner, {
    action: action as "fold" | "check" | "call" | "raise" | "all-in",
    ...(typeof payload.raiseTo === "number" ? { raiseTo: payload.raiseTo } : {}),
    decisionElapsedMs: Math.max(0, Math.trunc(number(payload.decisionElapsedMs, 0))),
  }, { nowMs: number(payload.nowMs, 0), policy: { simulations } });
  return runnerResponse(next);
}

function invoke(request: Request) {
  const payload = request.payload ?? {};
  if (request.operation === "createTournament") return create(payload);
  if (request.operation === "actTournament") return act(payload);
  throw new Error(`Unsupported tournament operation: ${request.operation}`);
}

(globalThis as typeof globalThis & { PokerTrainingProTournamentEngine?: { invoke(request: Request): unknown } }).PokerTrainingProTournamentEngine = { invoke };
