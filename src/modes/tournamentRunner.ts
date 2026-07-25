import {
  getLegalActions,
  nextToAct,
  type BettingActionCommand,
  type DeckSeed,
  type LegalActionSet,
} from "../engine";
import type { Card, PokerAction } from "../types/poker";
import {
  advanceTournamentSessionClock,
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  chooseTournamentSessionPolicyAction,
  chooseTournamentSessionPolicyActionAsync,
  createTournamentSession,
  progressTournamentSessionHand,
  type CreateTournamentSessionOptions,
  type SessionPolicyOptions,
  type TournamentSession,
  type TournamentSessionEntrant,
} from "./tournamentSession";
import type { EquityEstimator } from "./rational";
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

/**
 * Public, renderer-safe milestones emitted while a hand is presented. These
 * deliberately contain no opponent hole-card data: visual consumers can pace
 * a hand without gaining access to information the player could not see.
 */
export type TournamentPresentationEvent =
  | {
      id: string;
      kind: "button-moved";
      handId: string;
      buttonSeat: number;
    }
  | {
      id: string;
      kind: "blinds-posted";
      handId: string;
      /** Public forced posts, kept separate from voluntary betting actions. */
      posts: readonly {
        playerId: string;
        type: "small-blind" | "big-blind" | "big-blind-ante";
        amount: number;
      }[];
    }
  | {
      id: string;
      kind: "hole-cards-dealt";
      handId: string;
      playerIds: readonly string[];
    }
  | {
      id: string;
      kind: "action";
      handId: string;
      playerId: string;
      command: BettingActionCommand;
    }
  | {
      id: string;
      kind: "board-card-dealt";
      handId: string;
      street: "flop" | "turn" | "river";
      cardIndex: number;
      card: Card;
    }
  | {
      id: string;
      kind: "bets-collected";
      handId: string;
      amount: number;
    }
  | {
      id: string;
      kind: "showdown";
      handId: string;
    }
  | {
      id: string;
      kind: "side-pot-formed";
      handId: string;
      amount: number;
    }
  | {
      id: string;
      kind: "pot-awarded";
      handId: string;
      playerId: string;
      amount: number;
    }
  | {
      id: string;
      kind: "eliminated";
      handId: string;
      playerId: string;
    };

/** One deterministic engine transition plus the public milestones it produced. */
export interface TournamentPresentationStep {
  runner: TournamentRunner;
  events: readonly TournamentPresentationEvent[];
  awaitingHero: boolean;
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

function presentationEventId(
  runner: TournamentRunner,
  handId: string,
  kind: TournamentPresentationEvent["kind"],
  index = 0,
): string {
  return `${runner.sequence}:${handId}:${kind}:${index}`;
}

function beginHandPresentationEvents(
  source: TournamentRunner,
  handId: string,
): readonly TournamentPresentationEvent[] {
  const hand = source.session.activeHand;
  if (!hand) return [];
  const activePlayerIds = hand.information.players
    .filter((player) => player.status !== "folded")
    .map((player) => player.id);
  const blindPosts = hand.information.actions
    .filter(
      (action) =>
        action.type === "small-blind" || action.type === "big-blind" ||
        action.type === "big-blind-ante",
    )
    .map((action) => ({
      playerId: action.playerId,
      type: action.type as "small-blind" | "big-blind" | "big-blind-ante",
      amount: action.amount ?? 0,
    }));
  return [
    {
      id: presentationEventId(source, handId, "button-moved"),
      kind: "button-moved",
      handId,
      buttonSeat: hand.buttonSeat,
    },
    {
      id: presentationEventId(source, handId, "blinds-posted"),
      kind: "blinds-posted",
      handId,
      posts: blindPosts,
    },
    {
      id: presentationEventId(source, handId, "hole-cards-dealt"),
      kind: "hole-cards-dealt",
      handId,
      playerIds: activePlayerIds,
    },
  ];
}

function progressHandPresentationEvents(
  source: TournamentRunner,
  next: TournamentRunner,
): readonly TournamentPresentationEvent[] {
  const previousHand = source.session.activeHand;
  if (!previousHand) return [];
  const nextHand = next.session.activeHand;
  if (nextHand) {
    const newlyDealt = nextHand.board.length - previousHand.board.length;
    if (newlyDealt <= 0) return [];
    return [
      {
        id: presentationEventId(
          source,
          previousHand.handId,
          "bets-collected",
          previousHand.board.length,
        ),
        kind: "bets-collected" as const,
        handId: previousHand.handId,
        amount: previousHand.information.pot,
      },
      ...Array.from({ length: newlyDealt }, (_, index) => ({
      id: presentationEventId(
        source,
        previousHand.handId,
        "board-card-dealt",
        previousHand.board.length + index,
      ),
      kind: "board-card-dealt" as const,
      handId: previousHand.handId,
      street: nextHand.street as "flop" | "turn" | "river",
      cardIndex: previousHand.board.length + index,
      card: { ...nextHand.board[previousHand.board.length + index] },
      })),
    ];
  }

  const result = next.session.lastHand;
  if (!result || result.handId !== previousHand.handId) return [];
  const events: TournamentPresentationEvent[] = [];
  events.push({
    id: presentationEventId(
      source,
      result.handId,
      "bets-collected",
      previousHand.board.length,
    ),
    kind: "bets-collected",
    handId: result.handId,
    amount: previousHand.information.pot,
  });
  if (!previousHand.betting.handComplete) {
    events.push({
      id: presentationEventId(source, result.handId, "showdown"),
      kind: "showdown",
      handId: result.handId,
    });
  }
  result.pots
    .filter((pot) => pot.kind === "side")
    .forEach((pot, index) => {
      events.push({
        id: presentationEventId(source, result.handId, "side-pot-formed", index),
        kind: "side-pot-formed",
        handId: result.handId,
        amount: pot.amount,
      });
    });
  result.awards.forEach((award, index) => {
    events.push({
      id: presentationEventId(source, result.handId, "pot-awarded", index),
      kind: "pot-awarded",
      handId: result.handId,
      playerId: award.playerId,
      amount: award.amount,
    });
  });
  result.eliminatedPlayerIds.forEach((playerId, index) => {
    events.push({
      id: presentationEventId(source, result.handId, "eliminated", index),
      kind: "eliminated",
      handId: result.handId,
      playerId,
    });
  });
  return events;
}

function recordedActionRunner(
  source: TournamentRunner,
  playerId: string,
  command: BettingActionCommand,
  policy: "normal" | "rational",
  elapsedMs: number,
  recordReplay?: TournamentReplayAction,
): TournamentRunner {
  const handId = source.session.activeHand?.handId;
  if (!handId) throw new Error("The tournament hand is missing");
  const nextSession = applyTournamentSessionAction(
    source.session,
    playerId,
    command,
  );
  return {
    ...source,
    sequence: source.sequence + 1,
    session: advanceTournamentSessionClock(nextSession, elapsedMs),
    decisions: [
      ...source.decisions.slice(-79),
      {
        sequence: source.sequence,
        handId,
        playerId,
        command: { ...command },
        policy,
      },
    ],
    ...(recordReplay
      ? { replayActions: [...source.replayActions, recordReplay] }
      : {}),
  };
}

/**
 * Advances exactly one engine transition. The caller owns presentation: it can
 * enqueue `events`, wait, pause, or skip them before committing `runner`.
 * Keeping this granular path separate preserves the established synchronous
 * run-to-hero API used by replay reconstruction and tests.
 */
export function advanceTournamentRunnerOneStep(
  source: TournamentRunner,
  options: AdvanceTournamentRunnerOptions = {},
): TournamentPresentationStep {
  const nowMs = options.nowMs ?? Date.now();
  let runner = sanitizeTimedCompletion(source);
  if (runner.session.status === "complete") {
    return { runner, events: [], awaitingHero: false };
  }
  if (!runner.session.activeHand) {
    runner = applyTimedBlindLevel(runner, nowMs);
    const next = {
      ...runner,
      session: beginTournamentSessionHand(runner.session),
    };
    const handId = next.session.activeHand?.handId;
    if (!handId) throw new Error("Started tournament hand is missing");
    return {
      runner: next,
      events: beginHandPresentationEvents(next, handId),
      awaitingHero: false,
    };
  }

  const hand = runner.session.activeHand;
  if (hand.betting.complete) {
    const next = sanitizeTimedCompletion({
      ...runner,
      session: progressTournamentSessionHand(runner.session),
    });
    return {
      runner: next,
      events: progressHandPresentationEvents(runner, next),
      awaitingHero: false,
    };
  }

  const actor = nextToAct(hand.betting);
  if (!actor) throw new Error("Incomplete betting round has no actor");
  if (actor === runner.session.heroId) {
    return { runner, events: [], awaitingHero: true };
  }
  const policy = chooseTournamentSessionPolicyAction(
    runner.session,
    actor,
    options.policy,
  );
  const elapsed = 1_500 + ((runner.sequence * 977) % 2_750);
  const next = recordedActionRunner(
    runner,
    actor,
    policy.command,
    policy.mode,
    elapsed,
  );
  return {
    runner: next,
    events: [
      {
        id: presentationEventId(runner, hand.handId, "action"),
        kind: "action",
        handId: hand.handId,
        playerId: actor,
        command: { ...policy.command },
      },
    ],
    awaitingHero: false,
  };
}

/** Applies one hero action but intentionally does not auto-run opponents. */
export function applyHeroTournamentActionOneStep(
  source: TournamentRunner,
  request: HeroTournamentAction,
  options: AdvanceTournamentRunnerOptions = {},
): TournamentPresentationStep {
  const legal = heroTournamentLegalActions(source);
  if (!legal) throw new Error("The tournament is not waiting for the hero");
  const nowMs = options.nowMs ?? Date.now();
  const command = tournamentCommandForHeroAction(legal, request);
  const handId = source.session.activeHand?.handId;
  if (!handId) throw new Error("The tournament hand is missing");
  const next = recordedActionRunner(
    source,
    source.session.heroId,
    command,
    source.session.mode,
    Math.max(0, request.decisionElapsedMs ?? 0),
    { request: { ...request }, nowMs },
  );
  return {
    runner: next,
    events: [
      {
        id: presentationEventId(source, handId, "action"),
        kind: "action",
        handId,
        playerId: source.session.heroId,
        command: { ...command },
      },
    ],
    awaitingHero: false,
  };
}

export function advanceTournamentRunnerToHero(
  source: TournamentRunner,
  options: AdvanceTournamentRunnerOptions = {},
): TournamentRunner {
  const maxSteps = options.maxSteps ?? 2_500;
  let runner = source;

  for (let step = 0; step < maxSteps; step += 1) {
    const transition = advanceTournamentRunnerOneStep(runner, options);
    runner = transition.runner;
    if (transition.awaitingHero || runner.session.status === "complete") {
      return sanitizeTimedCompletion(runner);
    }
  }

  throw new Error(`Tournament runner exceeded ${maxSteps} automatic steps`);
}

/** Thrown by the async advance loop when its abort signal fires. */
export class TournamentAdvanceAborted extends Error {
  constructor() {
    super("Tournament advance was aborted");
    this.name = "TournamentAdvanceAborted";
  }
}

export interface AsyncAdvanceTournamentRunnerOptions
  extends AdvanceTournamentRunnerOptions {
  /** Aborts the loop between steps; pair with an equity service cancel. */
  signal?: { readonly aborted: boolean };
}

/** Async one-transition counterpart used by the live presentation clock. */
export async function advanceTournamentRunnerOneStepAsync(
  source: TournamentRunner,
  estimateEquity: EquityEstimator,
  options: AsyncAdvanceTournamentRunnerOptions = {},
): Promise<TournamentPresentationStep> {
  if (options.signal?.aborted) throw new TournamentAdvanceAborted();
  const nowMs = options.nowMs ?? Date.now();
  let runner = sanitizeTimedCompletion(source);
  if (runner.session.status === "complete") {
    return { runner, events: [], awaitingHero: false };
  }
  if (!runner.session.activeHand) {
    runner = applyTimedBlindLevel(runner, nowMs);
    const next = {
      ...runner,
      session: beginTournamentSessionHand(runner.session),
    };
    const handId = next.session.activeHand?.handId;
    if (!handId) throw new Error("Started tournament hand is missing");
    return {
      runner: next,
      events: beginHandPresentationEvents(next, handId),
      awaitingHero: false,
    };
  }

  const hand = runner.session.activeHand;
  if (hand.betting.complete) {
    const next = sanitizeTimedCompletion({
      ...runner,
      session: progressTournamentSessionHand(runner.session),
    });
    return {
      runner: next,
      events: progressHandPresentationEvents(runner, next),
      awaitingHero: false,
    };
  }

  const actor = nextToAct(hand.betting);
  if (!actor) throw new Error("Incomplete betting round has no actor");
  if (actor === runner.session.heroId) {
    return { runner, events: [], awaitingHero: true };
  }
  const policy = await chooseTournamentSessionPolicyActionAsync(
    runner.session,
    actor,
    estimateEquity,
    options.policy,
  );
  if (options.signal?.aborted) throw new TournamentAdvanceAborted();
  const elapsed = 1_500 + ((runner.sequence * 977) % 2_750);
  const next = recordedActionRunner(
    runner,
    actor,
    policy.command,
    policy.mode,
    elapsed,
  );
  return {
    runner: next,
    events: [
      {
        id: presentationEventId(runner, hand.handId, "action"),
        kind: "action",
        handId: hand.handId,
        playerId: actor,
        command: { ...policy.command },
      },
    ],
    awaitingHero: false,
  };
}

/**
 * Deterministic async counterpart to {@link advanceTournamentRunnerToHero}. It
 * offloads the Rational equity Monte Carlo to `estimateEquity` (typically a
 * worker) so a large decision cannot block the UI thread. For a fixed seed and
 * work budget the resulting runner is bit-for-bit identical to the synchronous
 * loop. The sync loop is retained unchanged for replay, tests, and the iOS
 * bundle.
 */
export async function advanceTournamentRunnerToHeroAsync(
  source: TournamentRunner,
  estimateEquity: EquityEstimator,
  options: AsyncAdvanceTournamentRunnerOptions = {},
): Promise<TournamentRunner> {
  const maxSteps = options.maxSteps ?? 2_500;
  let runner = source;

  for (let step = 0; step < maxSteps; step += 1) {
    if (options.signal?.aborted) throw new TournamentAdvanceAborted();
    const transition = await advanceTournamentRunnerOneStepAsync(
      runner,
      estimateEquity,
      options,
    );
    runner = transition.runner;
    if (transition.awaitingHero || runner.session.status === "complete") {
      return sanitizeTimedCompletion(runner);
    }
  }

  throw new Error(`Tournament runner exceeded ${maxSteps} automatic steps`);
}

export function applyHeroTournamentAction(
  source: TournamentRunner,
  request: HeroTournamentAction,
  options: AdvanceTournamentRunnerOptions = {},
): TournamentRunner {
  const nowMs = options.nowMs ?? Date.now();
  const step = applyHeroTournamentActionOneStep(source, request, {
    ...options,
    nowMs,
  });
  return advanceTournamentRunnerToHero(step.runner, { ...options, nowMs });
}

/**
 * Async counterpart to {@link applyHeroTournamentAction}. It applies the hero's
 * committed action synchronously (no simulation), then advances through the
 * opponents off-thread via the equity worker. Deterministic and identical to
 * the synchronous path for a fixed seed.
 */
export async function applyHeroTournamentActionAsync(
  source: TournamentRunner,
  request: HeroTournamentAction,
  estimateEquity: EquityEstimator,
  options: AsyncAdvanceTournamentRunnerOptions = {},
): Promise<TournamentRunner> {
  const nowMs = options.nowMs ?? Date.now();
  const step = applyHeroTournamentActionOneStep(source, request, {
    ...options,
    nowMs,
  });
  return advanceTournamentRunnerToHeroAsync(step.runner, estimateEquity, {
    ...options,
    nowMs,
  });
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
