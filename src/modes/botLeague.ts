import type { LegalActionSet, PlayerInformationSet } from "../engine";
import { nextToAct } from "../engine";
import type { BettingActionCommand } from "../engine/betting";
import type { Card, PokerAction, Street } from "../types/poker";
import { calculateAiDecisionTiming } from "./decisionTiming";
import {
  NORMAL_OPPONENT_PROFILES,
  decideNormalAction,
  type NormalActionEvaluation,
} from "./normal";
import { decideRationalAction, type RationalDecision } from "./rational";
import {
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  chooseTournamentSessionPolicyAction,
  createTournamentSession,
  progressTournamentSessionHand,
  type TournamentPolicyMode,
  type TournamentSession,
  type TournamentSessionEntrant,
} from "./tournamentSession";

export const BOT_LEAGUE_HARNESS_VERSION = "bot-league-v1";
export const BOT_LEAGUE_BASELINE_ID = "policy-baseline-2026-07-23";

const BIG_BLIND = 100;
const MATRIX_SEEDS_PER_PROFILE = 12;
const EQUITY_SIMULATIONS = 60;
const TOURNAMENT_EQUITY_SIMULATIONS = 50;
const TOURNAMENT_SEEDS = [
  "league-tournament-01",
  "league-tournament-02",
  "league-tournament-03",
  "league-tournament-04",
  "league-tournament-05",
  "league-tournament-06",
] as const;

type PositionBucket = "early" | "middle" | "late";
type StackBucket = "short" | "medium" | "deep";
type ActionBucket = PokerAction;
type NormalProfileKey = keyof typeof NORMAL_OPPONENT_PROFILES;

interface MatrixFixture {
  id: string;
  position: PositionBucket;
  stack: StackBucket;
  stackBigBlinds: number;
  street: Street;
  informationSet: PlayerInformationSet;
  legalActions: LegalActionSet;
}

interface Distribution {
  fold: number;
  check: number;
  call: number;
  raise: number;
  "all-in": number;
}

interface RationalSlice {
  decisions: number;
  meanEquity: number;
  meanRequiredEquity: number;
  meanPositionScore: number;
  meanEffectiveStackBigBlinds: number;
  meanStackToPotRatio: number;
  chosenActions: Distribution;
  expectedActions: Distribution;
}

interface NormalProfileReport {
  profileId: string;
  decisions: number;
  selectedBestRate: number;
  deviationRate: number;
  meanEvLossBigBlinds: number;
  maxEvLossBigBlinds: number;
  evBudgetBreaches: number;
  chosenActions: Distribution;
}

interface TournamentModeReport {
  completed: number;
  meanFinish: number;
  finishDistribution: Record<"1" | "2" | "3" | "4" | "5" | "6", number>;
  meanHands: number;
  meanDecisions: number;
  maxDecisions: number;
}

export interface BotLeagueReport {
  schemaVersion: 1;
  harnessVersion: string;
  baselineId: string;
  frozenInputs: {
    matrixFixtures: number;
    matrixSeedsPerProfile: number;
    equitySimulations: number;
    tournamentEquitySimulations: number;
    tournamentSeeds: readonly string[];
  };
  policies: {
    rationalPolicyVersion: string;
    normalPolicyVersion: string;
    rational: {
      overall: RationalSlice;
      byPosition: Record<PositionBucket, RationalSlice>;
      byStack: Record<StackBucket, RationalSlice>;
      byStreet: Record<Street, RationalSlice>;
    };
    normalProfiles: Record<string, NormalProfileReport>;
  };
  timingLeakage: {
    samples: number;
    cutoffDelayCorrelation: number;
    uncertaintyDelayCorrelation: number;
    actionClassDelayCorrelation: number;
    minDelayMs: number;
    maxDelayMs: number;
  };
  tournaments: Record<TournamentPolicyMode, TournamentModeReport>;
  runtimeBounds: {
    matrixPolicyCalls: number;
    tournamentCount: number;
    tournamentDecisionCap: number;
  };
}

function card(token: string): Card {
  const rank = token[0] as Card["rank"];
  const suit = (
    { s: "spades", h: "hearts", d: "diamonds", c: "clubs" } as const
  )[token[1] as "s" | "h" | "d" | "c"];
  return { rank, suit };
}

function boardFor(street: Street): Card[] {
  const flop = ["Qs", "Jh", "2c"].map(card);
  if (street === "preflop") return [];
  if (street === "flop") return flop;
  if (street === "turn") return [...flop, card("7d")];
  return [...flop, card("7d"), card("3h")];
}

function buttonSeatFor(position: PositionBucket): number {
  if (position === "early") return 0;
  if (position === "middle") return 3;
  return 1;
}

function stackBigBlinds(stack: StackBucket): number {
  if (stack === "short") return 8;
  if (stack === "medium") return 30;
  return 100;
}

function makeFixture(
  position: PositionBucket,
  stack: StackBucket,
  street: Street,
): MatrixFixture {
  const depth = stackBigBlinds(stack);
  const chips = depth * BIG_BLIND;
  const pot = street === "preflop" ? 400 : 800;
  const toCall = BIG_BLIND;
  const currentBet = BIG_BLIND;
  const informationSet: PlayerInformationSet = {
    handId: `league-${position}-${stack}-${street}`,
    viewerId: "hero",
    street,
    board: boardFor(street),
    pot,
    currentBet,
    actingPlayerId: "hero",
    buttonSeat: buttonSeatFor(position),
    players: [
      {
        id: "hero",
        name: "Hero",
        seat: 1,
        stack: chips,
        status: "active",
        streetCommitted: 0,
        totalCommitted: BIG_BLIND,
        holeCards: [card("As"), card("Ks")],
      },
      {
        id: "villain-a",
        name: "Villain A",
        seat: 3,
        stack: chips,
        status: "active",
        streetCommitted: currentBet,
        totalCommitted: BIG_BLIND * 2,
      },
      {
        id: "villain-b",
        name: "Villain B",
        seat: 5,
        stack: chips,
        status: "active",
        streetCommitted: 0,
        totalCommitted: BIG_BLIND,
      },
    ],
    actions: [
      { playerId: "villain-a", type: "bet", amount: currentBet },
      { playerId: "hero", type: "pending" },
    ],
  };
  return {
    id: `${position}/${stack}/${street}`,
    position,
    stack,
    stackBigBlinds: depth,
    street,
    informationSet,
    legalActions: {
      playerId: "hero",
      toCall,
      check: false,
      fold: true,
      call: true,
      callAmount: toCall,
      raise:
        chips > BIG_BLIND * 3
          ? { minTo: BIG_BLIND * 3, maxTo: chips }
          : undefined,
      allIn: true,
      allInTo: chips,
      raisingReopened: true,
    },
  };
}

function matrixFixtures(): MatrixFixture[] {
  const fixtures: MatrixFixture[] = [];
  for (const position of ["early", "middle", "late"] as const) {
    for (const stack of ["short", "medium", "deep"] as const) {
      for (const street of ["preflop", "flop", "turn", "river"] as const) {
        fixtures.push(makeFixture(position, stack, street));
      }
    }
  }
  return fixtures;
}

function emptyDistribution(): Distribution {
  return { fold: 0, check: 0, call: 0, raise: 0, "all-in": 0 };
}

function actionBucket(command: BettingActionCommand): ActionBucket {
  if (command.type === "bet") return "raise";
  return command.type;
}

function incrementDistribution(
  target: Distribution,
  command: BettingActionCommand,
  amount = 1,
): void {
  target[actionBucket(command)] += amount;
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function normalizeDistribution(
  distribution: Distribution,
  divisor: number,
): Distribution {
  return {
    fold: round(distribution.fold / divisor),
    check: round(distribution.check / divisor),
    call: round(distribution.call / divisor),
    raise: round(distribution.raise / divisor),
    "all-in": round(distribution["all-in"] / divisor),
  };
}

function rationalSlice(decisions: readonly RationalDecision[]): RationalSlice {
  const chosen = emptyDistribution();
  const expected = emptyDistribution();
  for (const decision of decisions) {
    incrementDistribution(chosen, decision.chosen.command);
    for (const option of decision.distribution) {
      incrementDistribution(expected, option.command, option.probability);
    }
  }
  const count = decisions.length;
  const mean = (selector: (decision: RationalDecision) => number) =>
    round(decisions.reduce((sum, decision) => sum + selector(decision), 0) / count);
  return {
    decisions: count,
    meanEquity: mean((decision) => decision.audit.metrics.equity),
    meanRequiredEquity: mean(
      (decision) => decision.audit.metrics.requiredEquity,
    ),
    meanPositionScore: mean(
      (decision) => decision.audit.metrics.positionScore,
    ),
    meanEffectiveStackBigBlinds: mean(
      (decision) => decision.audit.metrics.effectiveStackBigBlinds,
    ),
    meanStackToPotRatio: mean(
      (decision) => decision.audit.metrics.stackToPotRatio,
    ),
    chosenActions: normalizeDistribution(chosen, count),
    expectedActions: normalizeDistribution(expected, count),
  };
}

function normalEvaluations(decision: RationalDecision): NormalActionEvaluation[] {
  return decision.distribution.map((option) => ({
    command: { ...option.command },
    estimatedEv: option.utilityBigBlinds * BIG_BLIND,
    purpose:
      option.role === "showdown"
        ? "defense"
        : option.role === "fold"
          ? "neutral"
          : option.role,
  }));
}

function normalProfileReport(
  profile: NormalProfileKey,
  fixtures: readonly MatrixFixture[],
  baselines: ReadonlyMap<string, RationalDecision>,
): NormalProfileReport {
  const actions = emptyDistribution();
  let selectedBest = 0;
  let deviations = 0;
  let totalEvLossBb = 0;
  let maxEvLossBb = 0;
  let breaches = 0;
  let decisions = 0;
  for (const fixture of fixtures) {
    const rational = baselines.get(fixture.id);
    if (!rational) throw new Error(`Missing rational baseline for ${fixture.id}`);
    for (let seedIndex = 0; seedIndex < MATRIX_SEEDS_PER_PROFILE; seedIndex += 1) {
      const decision = decideNormalAction({
        informationSet: fixture.informationSet,
        legalActions: fixture.legalActions,
        evaluations: normalEvaluations(rational),
        profile,
        bigBlind: BIG_BLIND,
        seed: `${BOT_LEAGUE_BASELINE_ID}|${fixture.id}|${profile}|${seedIndex}`,
        decisionIndex: seedIndex,
      });
      const lossBb = decision.evLoss / BIG_BLIND;
      decisions += 1;
      selectedBest += decision.selectedBestAction ? 1 : 0;
      deviations += decision.usedPersonalityDeviation ? 1 : 0;
      totalEvLossBb += lossBb;
      maxEvLossBb = Math.max(maxEvLossBb, lossBb);
      if (decision.evLoss > decision.evLossBudget + Number.EPSILON) breaches += 1;
      incrementDistribution(actions, decision.command);
    }
  }
  return {
    profileId: NORMAL_OPPONENT_PROFILES[profile].id,
    decisions,
    selectedBestRate: round(selectedBest / decisions),
    deviationRate: round(deviations / decisions),
    meanEvLossBigBlinds: round(totalEvLossBb / decisions),
    maxEvLossBigBlinds: round(maxEvLossBb),
    evBudgetBreaches: breaches,
    chosenActions: normalizeDistribution(actions, decisions),
  };
}

function correlation(samples: ReadonlyArray<readonly [number, number]>): number {
  const meanX = samples.reduce((sum, [x]) => sum + x, 0) / samples.length;
  const meanY = samples.reduce((sum, [, y]) => sum + y, 0) / samples.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of samples) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
}

function timingLeakageReport(): BotLeagueReport["timingLeakage"] {
  const actionClasses: Record<PokerAction, number> = {
    fold: 0,
    check: 0.25,
    call: 0.5,
    raise: 0.75,
    "all-in": 1,
  };
  const actions = Object.keys(actionClasses) as PokerAction[];
  const cutoff: Array<readonly [number, number]> = [];
  const uncertainty: Array<readonly [number, number]> = [];
  const actionClass: Array<readonly [number, number]> = [];
  const delays: number[] = [];
  for (let index = 0; index < 1_200; index += 1) {
    const cutoffValue = ((index * 977) % 1_201) / 1_200;
    const uncertaintyValue = ((index * 541) % 1_201) / 1_200;
    const action = actions[(index * 7 + 3) % actions.length];
    const timing = calculateAiDecisionTiming({
      seed: `${BOT_LEAGUE_BASELINE_ID}|timing|${index * 37 + 11}`,
      decisionId: `decision-${index * 101 + 3}`,
      street: (["preflop", "flop", "turn", "river"] as const)[index % 4],
      action,
      cutoffCloseness: cutoffValue,
      uncertainty: uncertaintyValue,
      tempo: ((index * 61) % 201) / 100 - 1,
      presentationRate: 1,
    });
    delays.push(timing.delayMs);
    cutoff.push([cutoffValue, timing.delayMs]);
    uncertainty.push([uncertaintyValue, timing.delayMs]);
    actionClass.push([actionClasses[action], timing.delayMs]);
  }
  return {
    samples: delays.length,
    cutoffDelayCorrelation: round(correlation(cutoff)),
    uncertaintyDelayCorrelation: round(correlation(uncertainty)),
    actionClassDelayCorrelation: round(correlation(actionClass)),
    minDelayMs: Math.min(...delays),
    maxDelayMs: Math.max(...delays),
  };
}

function leagueEntrants(): TournamentSessionEntrant[] {
  const profiles = Object.keys(NORMAL_OPPONENT_PROFILES) as NormalProfileKey[];
  return Array.from({ length: 6 }, (_, index) => ({
    id: index === 0 ? "league-hero" : `league-bot-${index}`,
    name: index === 0 ? "League Hero" : `League Bot ${index}`,
    rating: 1_500,
    normalProfile: profiles[index % profiles.length],
  }));
}

function shallowTournament(
  mode: TournamentPolicyMode,
  seed: string,
): TournamentSession {
  const [hero, ...opponents] = leagueEntrants();
  const session = createTournamentSession({
    eventId: "local-qualifier",
    hero,
    opponents,
    mode,
    seed,
  });
  const startingStack = 600;
  const levels = session.tournament.structure.levels.map((level) => ({
    ...level,
    smallBlind: 50,
    bigBlind: 100,
    bigBlindAnte: 0,
  }));
  return {
    ...session,
    event: {
      ...session.event,
      structure: { ...session.event.structure, startingStack, levels },
    },
    tournament: {
      ...session.tournament,
      structure: { ...session.tournament.structure, startingStack, levels },
      players: session.tournament.players.map((player) => ({
        ...player,
        stack: startingStack,
      })),
    },
  };
}

const TOURNAMENT_DECISION_CAP = 2_500;

function playTournament(
  mode: TournamentPolicyMode,
  seed: string,
): { finish: number; hands: number; decisions: number } {
  let session = shallowTournament(mode, seed);
  let decisions = 0;
  while (session.status !== "complete") {
    if (decisions > TOURNAMENT_DECISION_CAP) {
      throw new Error(
        `${mode}/${seed} exceeded ${TOURNAMENT_DECISION_CAP} policy decisions`,
      );
    }
    if (!session.activeHand) {
      session = beginTournamentSessionHand(session);
      continue;
    }
    if (session.activeHand.betting.complete) {
      session = progressTournamentSessionHand(session);
      continue;
    }
    const actor = nextToAct(session.activeHand.betting);
    if (!actor) throw new Error(`${mode}/${seed} has no actor`);
    const decision = chooseTournamentSessionPolicyAction(session, actor, {
      simulations: TOURNAMENT_EQUITY_SIMULATIONS,
      temperature: 0.48,
    });
    session = applyTournamentSessionAction(session, actor, decision.command);
    decisions += 1;
  }
  if (!session.result) throw new Error(`${mode}/${seed} completed without result`);
  return {
    finish: session.result.finishPlace,
    hands: session.result.handNumber,
    decisions,
  };
}

function tournamentReport(mode: TournamentPolicyMode): TournamentModeReport {
  const results = TOURNAMENT_SEEDS.map((seed) => playTournament(mode, seed));
  const finishes: TournamentModeReport["finishDistribution"] = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    "6": 0,
  };
  for (const result of results) {
    finishes[String(result.finish) as keyof typeof finishes] += 1;
  }
  return {
    completed: results.length,
    meanFinish: round(
      results.reduce((sum, result) => sum + result.finish, 0) / results.length,
    ),
    finishDistribution: finishes,
    meanHands: round(
      results.reduce((sum, result) => sum + result.hands, 0) / results.length,
    ),
    meanDecisions: round(
      results.reduce((sum, result) => sum + result.decisions, 0) /
        results.length,
    ),
    maxDecisions: Math.max(...results.map((result) => result.decisions)),
  };
}

export function runBotLeague(): BotLeagueReport {
  const fixtures = matrixFixtures();
  const decisions = new Map<string, RationalDecision>();
  for (const fixture of fixtures) {
    decisions.set(
      fixture.id,
      decideRationalAction({
        informationSet: fixture.informationSet,
        legalActions: fixture.legalActions,
        bigBlind: BIG_BLIND,
        seed: `${BOT_LEAGUE_BASELINE_ID}|${fixture.id}|rational`,
        simulations: EQUITY_SIMULATIONS,
        temperature: 0.48,
      }),
    );
  }
  const all = fixtures.map((fixture) => decisions.get(fixture.id) as RationalDecision);
  const slice = <K extends string>(
    keys: readonly K[],
    selector: (fixture: MatrixFixture) => K,
  ): Record<K, RationalSlice> =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        rationalSlice(
          fixtures
            .filter((fixture) => selector(fixture) === key)
            .map((fixture) => decisions.get(fixture.id) as RationalDecision),
        ),
      ]),
    ) as Record<K, RationalSlice>;
  const profiles = Object.keys(NORMAL_OPPONENT_PROFILES) as NormalProfileKey[];
  const normalProfiles = Object.fromEntries(
    profiles.map((profile) => [
      profile,
      normalProfileReport(profile, fixtures, decisions),
    ]),
  );
  const rationalPolicyVersion = all[0]?.audit.policyVersion;
  if (
    !rationalPolicyVersion ||
    all.some((decision) => decision.audit.policyVersion !== rationalPolicyVersion)
  ) {
    throw new Error("Rational policy version is missing or inconsistent");
  }
  return {
    schemaVersion: 1,
    harnessVersion: BOT_LEAGUE_HARNESS_VERSION,
    baselineId: BOT_LEAGUE_BASELINE_ID,
    frozenInputs: {
      matrixFixtures: fixtures.length,
      matrixSeedsPerProfile: MATRIX_SEEDS_PER_PROFILE,
      equitySimulations: EQUITY_SIMULATIONS,
      tournamentEquitySimulations: TOURNAMENT_EQUITY_SIMULATIONS,
      tournamentSeeds: TOURNAMENT_SEEDS,
    },
    policies: {
      rationalPolicyVersion,
      // Kept in sync with Normal's public decision-seed namespace.
      normalPolicyVersion: "normal-policy-v1",
      rational: {
        overall: rationalSlice(all),
        byPosition: slice(["early", "middle", "late"], (fixture) => fixture.position),
        byStack: slice(["short", "medium", "deep"], (fixture) => fixture.stack),
        byStreet: slice(
          ["preflop", "flop", "turn", "river"],
          (fixture) => fixture.street,
        ),
      },
      normalProfiles,
    },
    timingLeakage: timingLeakageReport(),
    tournaments: {
      rational: tournamentReport("rational"),
      normal: tournamentReport("normal"),
    },
    runtimeBounds: {
      matrixPolicyCalls:
        fixtures.length * (1 + profiles.length * MATRIX_SEEDS_PER_PROFILE),
      tournamentCount: TOURNAMENT_SEEDS.length * 2,
      tournamentDecisionCap: TOURNAMENT_DECISION_CAP,
    },
  };
}

export function serializeBotLeagueReport(report: BotLeagueReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
