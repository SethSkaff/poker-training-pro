import {
  getLegalActions,
  nextToAct,
  type BettingActionCommand,
  type DeckSeed,
  type LegalActionSet,
} from "../engine";
import type { PokerAction } from "../types/poker";
import {
  advanceTournamentSessionClock,
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  chooseTournamentSessionPolicyAction,
  createTournamentSession,
  progressTournamentSessionHand,
  type CreateTournamentSessionOptions,
  type SessionPolicyOptions,
  type TournamentSession,
  type TournamentSessionEntrant,
} from "./tournamentSession";
import {
  directTimedBlinds,
  type TimedBlindDecision,
} from "./timedBlindDirector";

export type TournamentRunnerKind = "career" | "timed";

export interface TimedRunnerConfig {
  durationMinutes: number;
  startedAtMs: number;
  startingTotalChips: number;
  lastBlindDecision?: TimedBlindDecision;
}

export interface TournamentReplayAction {
  request: HeroTournamentAction;
  nowMs: number;
}

export interface TournamentRunnerDecision {
  sequence: number;
  handId: string;
  playerId: string;
  command: BettingActionCommand;
  policy: "normal" | "rational";
}

export interface TournamentRunner {
  kind: TournamentRunnerKind;
  session: TournamentSession;
  sequence: number;
  decisions: TournamentRunnerDecision[];
  replayActions: TournamentReplayAction[];
  timed?: TimedRunnerConfig;
}

export interface AdvanceTournamentRunnerOptions {
  nowMs?: number;
  maxSteps?: number;
  policy?: SessionPolicyOptions;
}

export interface CreateTimedRunnerOptions {
  minutes: number;
  hero: TournamentSessionEntrant;
  seed: DeckSeed;
  nowMs?: number;
  opponents?: readonly TournamentSessionEntrant[];
}

export interface HeroTournamentAction {
  action: PokerAction;
  raiseTo?: number;
  decisionElapsedMs?: number;
}

function timedStartingTotal(session: TournamentSession) {
  return session.tournament.players.reduce(
    (sum, player) => sum + player.stack,
    0,
  );
}

export function createCareerTournamentRunner(
  options: CreateTournamentSessionOptions,
): TournamentRunner {
  return {
    kind: "career",
    session: createTournamentSession(options),
    sequence: 0,
    decisions: [],
    replayActions: [],
  };
}

export function createTimedTournamentRunner(
  options: CreateTimedRunnerOptions,
): TournamentRunner {
  const session = createTournamentSession({
    eventId: "local-qualifier",
    hero: options.hero,
    mode: "normal",
    seed: options.seed,
    opponents: options.opponents,
    careerResults: [],
  });
  const renamed: TournamentSession = {
    ...session,
    event: {
      ...session.event,
      name: `${options.minutes}-Minute Timed Table`,
      qualificationLabel: "One table · No career progression",
      prerequisites: [],
    },
    careerResults: [],
  };
  return {
    kind: "timed",
    session: renamed,
    sequence: 0,
    decisions: [],
    replayActions: [],
    timed: {
      durationMinutes: options.minutes,
      startedAtMs: options.nowMs ?? Date.now(),
      startingTotalChips: timedStartingTotal(renamed),
    },
  };
}

function sanitizeTimedCompletion(runner: TournamentRunner): TournamentRunner {
  if (
    runner.kind !== "timed" ||
    runner.session.status !== "complete" ||
    !runner.session.result
  ) {
    return runner;
  }
  const result = runner.session.result;
  return {
    ...runner,
    session: {
      ...runner.session,
      careerResults: [],
      result: {
        ...result,
        eventName: `${runner.timed?.durationMinutes ?? 0}-Minute Timed Table`,
        qualified: result.finishPlace === 1,
        qualificationLabel:
          result.finishPlace === 1
            ? "Timed table won"
            : "Timed table complete",
        unlockedEventIds: [],
        newlyUnlockedEventIds: [],
        nextEventId: undefined,
      },
    },
  };
}

function applyTimedBlindLevel(
  runner: TournamentRunner,
  nowMs: number,
): TournamentRunner {
  if (runner.kind !== "timed" || !runner.timed || runner.session.activeHand) {
    return runner;
  }
  const current =
    runner.session.tournament.structure.levels[
      runner.session.tournament.levelIndex
    ];
  const decision = directTimedBlinds({
    durationMinutes: runner.timed.durationMinutes,
    elapsedMs: Math.max(0, nowMs - runner.timed.startedAtMs),
    current: {
      smallBlind: current.smallBlind,
      bigBlind: current.bigBlind,
      bigBlindAnte: current.bigBlindAnte,
    },
    players: runner.session.tournament.players.map((player) => ({
      id: player.id,
      stack: player.stack,
      eliminated: player.status === "eliminated",
    })),
    startingTotalChips: runner.timed.startingTotalChips,
  });
  const levels = runner.session.tournament.structure.levels.map(
    (level, index) =>
      index === runner.session.tournament.levelIndex
        ? {
            ...level,
            smallBlind: decision.smallBlind,
            bigBlind: decision.bigBlind,
            bigBlindAnte: decision.bigBlindAnte,
          }
        : { ...level },
  );
  return {
    ...runner,
    timed: { ...runner.timed, lastBlindDecision: decision },
    session: {
      ...runner.session,
      tournament: {
        ...runner.session.tournament,
        structure: {
          ...runner.session.tournament.structure,
          levels,
        },
      },
    },
  };
}

export function heroTournamentLegalActions(
  runner: TournamentRunner,
): LegalActionSet | null {
  const hand = runner.session.activeHand;
  if (!hand || hand.betting.complete) return null;
  if (nextToAct(hand.betting) !== runner.session.heroId) return null;
  return getLegalActions(hand.betting, runner.session.heroId);
}

export function tournamentCommandForHeroAction(
  legal: LegalActionSet,
  request: HeroTournamentAction,
): BettingActionCommand {
  switch (request.action) {
    case "fold":
      if (!legal.fold) throw new Error("Fold is not legal");
      return { type: "fold" };
    case "check":
      if (!legal.check) throw new Error("Check is not legal");
      return { type: "check" };
    case "call":
      if (!legal.call) throw new Error("Call is not legal");
      return { type: "call" };
    case "all-in":
      if (!legal.allIn) throw new Error("All-in is not legal");
      return { type: "all-in" };
    case "raise": {
      const requested = request.raiseTo;
      if (typeof requested !== "number" || !Number.isSafeInteger(requested)) {
        throw new Error("A raise requires an integer raiseTo amount");
      }
      if (legal.raise) {
        if (requested < legal.raise.minTo || requested > legal.raise.maxTo) {
          throw new Error("Raise amount is outside the legal range");
        }
        return { type: "raise", to: requested };
      }
      if (legal.bet) {
        if (requested < legal.bet.min || requested > legal.bet.max) {
          throw new Error("Bet amount is outside the legal range");
        }
        return { type: "bet", to: requested };
      }
      throw new Error("Raise is not legal");
    }
  }
}

export function advanceTournamentRunnerToHero(
  source: TournamentRunner,
  options: AdvanceTournamentRunnerOptions = {},
): TournamentRunner {
  const maxSteps = options.maxSteps ?? 2_500;
  const nowMs = options.nowMs ?? Date.now();
  let runner = source;

  for (let step = 0; step < maxSteps; step += 1) {
    runner = sanitizeTimedCompletion(runner);
    if (runner.session.status === "complete") return runner;

    if (!runner.session.activeHand) {
      runner = applyTimedBlindLevel(runner, nowMs);
      runner = {
        ...runner,
        session: beginTournamentSessionHand(runner.session),
      };
      continue;
    }

    const hand = runner.session.activeHand;
    if (hand.betting.complete) {
      runner = {
        ...runner,
        session: progressTournamentSessionHand(runner.session),
      };
      continue;
    }

    const actor = nextToAct(hand.betting);
    if (!actor) {
      throw new Error("Incomplete betting round has no actor");
    }
    if (actor === runner.session.heroId) return runner;

    const policy = chooseTournamentSessionPolicyAction(
      runner.session,
      actor,
      options.policy,
    );
    const nextSession = applyTournamentSessionAction(
      runner.session,
      actor,
      policy.command,
    );
    const elapsed = 1_500 + ((runner.sequence * 977) % 2_750);
    runner = {
      ...runner,
      sequence: runner.sequence + 1,
      session: advanceTournamentSessionClock(nextSession, elapsed),
      decisions: [
        ...runner.decisions.slice(-79),
        {
          sequence: runner.sequence,
          handId: hand.handId,
          playerId: actor,
          command: { ...policy.command },
          policy: policy.mode,
        },
      ],
    };
  }

  throw new Error(`Tournament runner exceeded ${maxSteps} automatic steps`);
}

export function applyHeroTournamentAction(
  source: TournamentRunner,
  request: HeroTournamentAction,
  options: AdvanceTournamentRunnerOptions = {},
): TournamentRunner {
  const legal = heroTournamentLegalActions(source);
  if (!legal) throw new Error("The tournament is not waiting for the hero");
  const nowMs = options.nowMs ?? Date.now();
  const command = tournamentCommandForHeroAction(legal, request);
  const handId = source.session.activeHand?.handId;
  if (!handId) throw new Error("The tournament hand is missing");
  const acted = applyTournamentSessionAction(
    source.session,
    source.session.heroId,
    command,
  );
  const elapsed = Math.max(0, request.decisionElapsedMs ?? 0);
  const runner: TournamentRunner = {
    ...source,
    sequence: source.sequence + 1,
    session: advanceTournamentSessionClock(acted, elapsed),
    decisions: [
      ...source.decisions.slice(-79),
      {
        sequence: source.sequence,
        handId,
        playerId: source.session.heroId,
        command,
        policy: source.session.mode,
      },
    ],
    replayActions: [
      ...source.replayActions,
      { request: { ...request }, nowMs },
    ],
  };
  return advanceTournamentRunnerToHero(runner, { ...options, nowMs });
}

export interface TournamentRunnerReplay {
  format: "poker-training-pro-tournament-replay";
  version: 1;
  engineVersion: "tournament-session-v1";
  contentVersion: "career-events-v1";
  policyVersion: "normal-rational-v1";
  policySimulations: number;
  kind: TournamentRunnerKind;
  eventId: string;
  mode: TournamentSession["mode"];
  seed: string | number;
  hero: TournamentSessionEntrant;
  careerResults: TournamentSession["careerResults"];
  blindSchedule: TournamentSession["tournament"]["structure"]["levels"];
  actions: TournamentReplayAction[];
  timed?: {
    durationMinutes: number;
    startedAtMs: number;
  };
}

export function createTournamentRunnerReplay(
  runner: TournamentRunner,
  policySimulations = 60,
): TournamentRunnerReplay {
  const hero = runner.session.entrants.find(
    (entrant) => entrant.id === runner.session.heroId,
  );
  if (!hero) throw new Error("Tournament replay is missing the hero entrant");
  return {
    format: "poker-training-pro-tournament-replay",
    version: 1,
    engineVersion: "tournament-session-v1",
    contentVersion: "career-events-v1",
    policyVersion: "normal-rational-v1",
    policySimulations,
    kind: runner.kind,
    eventId: runner.session.event.id,
    mode: runner.session.mode,
    seed: runner.session.seed,
    hero: { ...hero },
    careerResults: runner.session.careerResults.map((result) => ({ ...result })),
    blindSchedule: runner.session.tournament.structure.levels.map((level) => ({
      ...level,
    })),
    actions: runner.replayActions.map((entry) => ({
      request: { ...entry.request },
      nowMs: entry.nowMs,
    })),
    ...(runner.kind === "timed" && runner.timed
      ? {
          timed: {
            durationMinutes: runner.timed.durationMinutes,
            startedAtMs: runner.timed.startedAtMs,
          },
        }
      : {}),
  };
}

export function restoreTournamentRunnerReplay(
  replay: TournamentRunnerReplay,
): TournamentRunner {
  if (
    replay.format !== "poker-training-pro-tournament-replay" ||
    replay.version !== 1 ||
    !Number.isInteger(replay.policySimulations) ||
    replay.policySimulations < 1
  ) {
    throw new Error("Unsupported tournament replay");
  }
  const firstNowMs =
    replay.timed?.startedAtMs ?? replay.actions[0]?.nowMs ?? Date.now();
  let runner =
    replay.kind === "timed"
      ? createTimedTournamentRunner({
          minutes: replay.timed?.durationMinutes ?? 30,
          hero: { ...replay.hero },
          seed: replay.seed,
          nowMs: replay.timed?.startedAtMs ?? firstNowMs,
        })
      : createCareerTournamentRunner({
          eventId: replay.eventId,
          hero: { ...replay.hero },
          mode: replay.mode,
          seed: replay.seed,
          careerResults: replay.careerResults,
        });
  runner = advanceTournamentRunnerToHero(runner, {
    nowMs: firstNowMs,
    policy: { simulations: replay.policySimulations },
  });
  for (const entry of replay.actions) {
    if (runner.session.status === "complete") break;
    runner = applyHeroTournamentAction(runner, entry.request, {
      nowMs: entry.nowMs,
      policy: { simulations: replay.policySimulations },
    });
  }
  return runner;
}
