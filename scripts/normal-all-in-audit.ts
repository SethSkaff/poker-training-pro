/**
 * Reproducible, read-only audit of Normal-mode all-ins.
 *
 * This drives the same production tournament/session/policy adapters as the
 * live app and the E14-001 behavior gate. It deliberately records context for
 * every all-in while leaving policy decisions untouched.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  advanceTournamentSessionClock,
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  chooseTournamentSessionPolicyAction,
  createSessionOpponents,
  createTournamentSession,
  progressTournamentSessionHand,
  type SessionPolicyDecision,
  type TournamentSession,
} from "../src/modes/tournamentSession";
import {
  getLegalActions,
  nextToAct,
  type BettingActionCommand,
  type LegalActionSet,
} from "../src/engine/betting";
import type { Street } from "../src/types/poker";

export const NORMAL_ALL_IN_AUDIT_VERSION = "normal-all-in-audit-v1";
export const NORMAL_POLICY_VERSION = "normal-policy-v1";
export const POLICY_OPTIONS = { simulations: 60, temperature: 0.48 } as const;
export const MS_PER_LIVE_CLOCK_HAND = 75_000;

const MAX_ACTIONS_PER_HAND = 4_000;
const DEFAULT_MAX_HANDS_PER_TOURNAMENT = 400;
const ALL_STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];
const SOURCE_FILES = [
  "src/engine/betting.ts",
  "src/engine/tournament.ts",
  "src/modes/normal.ts",
  "src/modes/rational.ts",
  "src/modes/tournamentSession.ts",
] as const;

/** The release bounds and frozen historical reference documented in E14-001. */
export const DOCUMENTED_ALL_IN_REFERENCE = {
  source: "scripts/audit-ai-behavior-gates.ts and docs/bot-league-regression-harness.md",
  frozenBlindClock: true,
  historicalMeasurement: {
    date: "2026-07-25",
    seeds: 8,
    preflopAllInHandRate: 0.003,
  },
  releaseBounds: {
    preflopAllInHandRateMax: 0.1,
    postflopAllInHandRateMax: 0.2,
  },
  canonicalDecisionBaseline: {
    id: "policy-baseline-2026-07-23",
    normalPolicyVersion: "normal-policy-v1",
    normalProfileChosenAllInShare: 0,
  },
} as const;

export type AuditClock = "frozen" | "live";
export type EffectiveStackBucket =
  | "0-5 BB"
  | ">5-12 BB"
  | ">12-40 BB"
  | ">40-80 BB"
  | ">80 BB";

export interface NormalAllInAuditOptions {
  seeds: readonly string[];
  clocks: readonly AuditClock[];
  eventId?: string;
  maxHandsPerTournament?: number;
  auditDate?: string;
  sourceRevision?: string;
  reproductionCommand?: string;
}

interface CountAndRate {
  decisions: number;
  allInActions: number;
  allInActionRate: number;
}

export interface AllInEvent {
  clock: AuditClock;
  seed: string;
  handId: string;
  handNumber: number;
  street: Street;
  actorId: string;
  profileId: string;
  blindLevel: number;
  bigBlind: number;
  tournamentPlayersRemaining: number;
  playersDealtIn: number;
  activePlayersInHand: number;
  activeOpponents: number;
  kind: "open" | "raise" | "call";
  potBefore: number;
  potBigBlinds: number;
  toCall: number;
  toCallBigBlinds: number;
  stackBehind: number;
  stackBehindBigBlinds: number;
  handStartingStackBigBlinds: number;
  effectiveStackBigBlinds: number;
  effectiveStackBucket: EffectiveStackBucket;
  stackToPotRatio: number;
  allInTo: number;
  allInToBigBlinds: number;
  priorAggressiveActionsThisStreet: number;
  equity: number;
  requiredEquity: number;
  equityEdge: number;
  normalEstimatedEvBigBlinds: number;
  normalEvLossBigBlinds: number;
  selectedBestAction: boolean;
  usedPersonalityDeviation: boolean;
  rationalBaselineAction: string;
  legal: {
    allInAvailable: boolean;
    targetMatches: boolean;
    raisingReopened: boolean;
    zeroStackAfter: boolean;
    allInStatusAfter: boolean;
  };
}

interface TournamentAudit {
  clock: AuditClock;
  seed: string;
  hands: number;
  decisions: number;
  allInActions: number;
  handsWithPreflopAllIn: number;
  handsWithPostflopAllIn: number;
  completed: boolean;
  reachedHandCap: boolean;
  finalBlindLevel: number;
}

export interface ClockAudit {
  clock: AuditClock;
  tournaments: number;
  completedTournaments: number;
  cappedTournaments: number;
  hands: number;
  decisions: number;
  allInActions: number;
  allInActionRate: number;
  handsWithPreflopAllIn: number;
  preflopAllInHandRate: number;
  preflopAllInHandRateWilson95: { lower: number; upper: number };
  handsWithPostflopAllIn: number;
  postflopAllInHandRate: number;
  postflopAllInHandRateWilson95: { lower: number; upper: number };
  byStreet: Record<Street, CountAndRate>;
  byEffectiveStack: Record<EffectiveStackBucket, CountAndRate>;
  byKind: Record<AllInEvent["kind"], number>;
  personalityDeviationAllIns: number;
  legality: {
    decisionsVerified: number;
    allInsVerified: number;
    violations: number;
  };
  releaseGateComparison?: {
    preflop: { measured: number; maximum: number; pass: boolean };
    postflop: { measured: number; maximum: number; pass: boolean };
  };
}

export interface NormalAllInAuditReport {
  schemaVersion: 1;
  auditVersion: typeof NORMAL_ALL_IN_AUDIT_VERSION;
  status: "reproducible-measurement";
  scope: "normal-mode-all-in-frequency-and-context";
  auditDate: string;
  sourceRevision: string;
  versions: {
    package: string;
    normalPolicy: typeof NORMAL_POLICY_VERSION;
    rationalBaselinePolicy: string;
  };
  inputs: {
    eventId: string;
    seeds: readonly string[];
    clocks: readonly AuditClock[];
    maxHandsPerTournament: number;
    liveClockAdvanceMsPerHand: typeof MS_PER_LIVE_CLOCK_HAND;
    policy: typeof POLICY_OPTIONS;
  };
  reproductionCommand: string;
  relevantSourceSha256: Record<string, string>;
  documentedReference: typeof DOCUMENTED_ALL_IN_REFERENCE;
  summaries: Record<AuditClock, ClockAudit | null>;
  tournaments: TournamentAudit[];
  allIns: AllInEvent[];
}

interface MutableScope {
  clock: AuditClock;
  tournaments: TournamentAudit[];
  hands: number;
  decisions: number;
  handsWithPreflopAllIn: number;
  handsWithPostflopAllIn: number;
  streetDecisions: Record<Street, number>;
  depthDecisions: Record<EffectiveStackBucket, number>;
  rationalBaselinePolicies: Set<string>;
  allIns: AllInEvent[];
}

const round = (value: number, digits = 6): number =>
  Number(value.toFixed(digits));

export function classifyEffectiveStack(
  effectiveStackBigBlinds: number,
): EffectiveStackBucket {
  if (effectiveStackBigBlinds <= 5) return "0-5 BB";
  if (effectiveStackBigBlinds <= 12) return ">5-12 BB";
  if (effectiveStackBigBlinds <= 40) return ">12-40 BB";
  if (effectiveStackBigBlinds <= 80) return ">40-80 BB";
  return ">80 BB";
}

export function commandIsLegal(
  command: BettingActionCommand,
  legal: LegalActionSet,
): boolean {
  switch (command.type) {
    case "fold":
      return legal.fold;
    case "check":
      return legal.check;
    case "call":
      return legal.call;
    case "bet":
      return Boolean(
        legal.bet && command.to !== undefined &&
          command.to >= legal.bet.min && command.to <= legal.bet.max,
      );
    case "raise":
      return Boolean(
        legal.raise && command.to !== undefined &&
          command.to >= legal.raise.minTo && command.to <= legal.raise.maxTo,
      );
    case "all-in":
      return legal.allIn &&
        (command.to === undefined || command.to === legal.allInTo);
  }
}

function emptyStreetCounts(): Record<Street, number> {
  return { preflop: 0, flop: 0, turn: 0, river: 0 };
}

function emptyDepthCounts(): Record<EffectiveStackBucket, number> {
  return {
    "0-5 BB": 0,
    ">5-12 BB": 0,
    ">12-40 BB": 0,
    ">40-80 BB": 0,
    ">80 BB": 0,
  };
}

function wilson95(successes: number, trials: number): {
  lower: number;
  upper: number;
} {
  if (!trials) return { lower: 0, upper: 0 };
  const z = 1.959963984540054;
  const proportion = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = proportion + (z * z) / (2 * trials);
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) + (z * z) / (4 * trials)) / trials,
  );
  return {
    lower: round(Math.max(0, (centre - margin) / denominator)),
    upper: round(Math.min(1, (centre + margin) / denominator)),
  };
}

function allInKind(legal: LegalActionSet, currentBet: number): AllInEvent["kind"] {
  if (legal.allInTo <= currentBet) return "call";
  if (currentBet === 0) return "open";
  return "raise";
}

function sourceHashes(projectRoot: string): Record<string, string> {
  return Object.fromEntries(
    SOURCE_FILES.map((relativePath) => [
      relativePath,
      createHash("sha256")
        .update(readFileSync(path.join(projectRoot, relativePath)))
        .digest("hex"),
    ]),
  );
}

function packageVersion(projectRoot: string): string {
  const manifest = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  ) as { version?: string };
  return manifest.version ?? "unknown";
}

function rationalDecision(decision: SessionPolicyDecision) {
  return decision.mode === "normal"
    ? decision.rationalBaseline
    : decision.rational;
}

function recordAllIn(
  scope: MutableScope,
  sessionBefore: TournamentSession,
  sessionAfter: TournamentSession,
  actorId: string,
  decision: Extract<SessionPolicyDecision, { mode: "normal" }>,
  legal: LegalActionSet,
  handNumber: number,
  priorAggressiveActionsThisStreet: number,
): void {
  const hand = sessionBefore.activeHand!;
  const playerBefore = hand.betting.players.find((entry) => entry.id === actorId)!;
  const playerAfter = sessionAfter.activeHand?.betting.players.find(
    (entry) => entry.id === actorId,
  );
  const level = sessionBefore.tournament.structure.levels[
    sessionBefore.tournament.levelIndex
  ];
  const bigBlind = level?.bigBlind ?? 1;
  const metrics = decision.rationalBaseline.audit.metrics;
  const targetMatches = decision.command.to === undefined ||
    decision.command.to === legal.allInTo;

  scope.allIns.push({
    clock: scope.clock,
    seed: String(sessionBefore.seed),
    handId: hand.handId,
    handNumber,
    street: hand.street,
    actorId,
    profileId: decision.normal.profileId,
    blindLevel: level?.level ?? sessionBefore.tournament.levelIndex + 1,
    bigBlind,
    tournamentPlayersRemaining: sessionBefore.tournament.players.filter(
      (player) => player.status === "active",
    ).length,
    playersDealtIn: hand.betting.players.length,
    activePlayersInHand: hand.betting.players.filter(
      (player) => player.status === "active" || player.status === "all-in",
    ).length,
    activeOpponents: hand.betting.players.filter(
      (player) =>
        player.id !== actorId &&
        (player.status === "active" || player.status === "all-in"),
    ).length,
    kind: allInKind(legal, hand.betting.currentBet),
    potBefore: hand.information.pot,
    potBigBlinds: round(hand.information.pot / bigBlind),
    toCall: legal.toCall,
    toCallBigBlinds: round(legal.toCall / bigBlind),
    stackBehind: playerBefore.stack,
    stackBehindBigBlinds: round(playerBefore.stack / bigBlind),
    handStartingStackBigBlinds: round(
      (hand.startingStacks[actorId] ?? playerBefore.stack) / bigBlind,
    ),
    effectiveStackBigBlinds: round(metrics.effectiveStackBigBlinds),
    effectiveStackBucket: classifyEffectiveStack(metrics.effectiveStackBigBlinds),
    stackToPotRatio: round(metrics.stackToPotRatio),
    allInTo: legal.allInTo,
    allInToBigBlinds: round(legal.allInTo / bigBlind),
    priorAggressiveActionsThisStreet,
    equity: round(metrics.equity),
    requiredEquity: round(metrics.requiredEquity),
    equityEdge: round(metrics.equityEdge),
    normalEstimatedEvBigBlinds: round(decision.normal.estimatedEv / bigBlind),
    normalEvLossBigBlinds: round(decision.normal.evLoss / bigBlind),
    selectedBestAction: decision.normal.selectedBestAction,
    usedPersonalityDeviation: decision.normal.usedPersonalityDeviation,
    rationalBaselineAction: decision.rationalBaseline.chosen.command.type,
    legal: {
      allInAvailable: legal.allIn,
      targetMatches,
      raisingReopened: legal.raisingReopened,
      zeroStackAfter: playerAfter?.stack === 0,
      allInStatusAfter: playerAfter?.status === "all-in",
    },
  });
}

function playTournament(
  scope: MutableScope,
  seed: string,
  eventId: string,
  maxHands: number,
): TournamentAudit {
  const opponents = createSessionOpponents(seed, eventId, "normal");
  let session = createTournamentSession({
    eventId,
    hero: { id: "hero", name: "Player", rating: 1_000 },
    mode: "normal",
    seed,
    opponents,
  });

  let hands = 0;
  let decisions = 0;
  let allInActions = 0;
  let handsWithPreflopAllIn = 0;
  let handsWithPostflopAllIn = 0;

  while (session.status === "playing" && hands < maxHands) {
    session = beginTournamentSessionHand(session);
    hands += 1;
    scope.hands += 1;
    let sawPreflopAllIn = false;
    let sawPostflopAllIn = false;
    let actions = 0;
    let trackedStreet = session.activeHand?.street;
    let aggressiveActionsThisStreet = 0;

    while (session.activeHand && actions < MAX_ACTIONS_PER_HAND) {
      const hand = session.activeHand;
      if (hand.street !== trackedStreet) {
        trackedStreet = hand.street;
        aggressiveActionsThisStreet = 0;
      }
      if (hand.betting.complete) {
        session = progressTournamentSessionHand(session);
        continue;
      }
      const actorId = nextToAct(hand.betting);
      if (!actorId) {
        session = progressTournamentSessionHand(session);
        continue;
      }

      const legal = getLegalActions(hand.betting, actorId);
      const decision = chooseTournamentSessionPolicyAction(
        session,
        actorId,
        POLICY_OPTIONS,
      );
      if (decision.mode !== "normal") {
        throw new Error("Normal audit received a non-Normal policy decision");
      }
      if (!commandIsLegal(decision.command, legal)) {
        throw new Error(
          `Illegal ${decision.command.type} from ${actorId} in ${hand.handId}`,
        );
      }

      decisions += 1;
      scope.decisions += 1;
      scope.streetDecisions[hand.street] += 1;
      const rational = rationalDecision(decision);
      scope.rationalBaselinePolicies.add(rational.audit.policyVersion);
      scope.depthDecisions[
        classifyEffectiveStack(rational.audit.metrics.effectiveStackBigBlinds)
      ] += 1;

      const sessionBefore = session;
      session = applyTournamentSessionAction(session, actorId, decision.command);
      actions += 1;

      if (decision.command.type === "all-in") {
        allInActions += 1;
        if (hand.street === "preflop") sawPreflopAllIn = true;
        else sawPostflopAllIn = true;
        recordAllIn(
          scope,
          sessionBefore,
          session,
          actorId,
          decision,
          legal,
          hands,
          aggressiveActionsThisStreet,
        );
      }
      if (
        decision.command.type === "bet" || decision.command.type === "raise" ||
        decision.command.type === "all-in"
      ) {
        aggressiveActionsThisStreet += 1;
      }

      if (session.activeHand?.betting.complete) {
        session = progressTournamentSessionHand(session);
      }
    }

    if (session.activeHand && actions >= MAX_ACTIONS_PER_HAND) {
      throw new Error(
        `Hand ${session.activeHand.handId} exceeded ${MAX_ACTIONS_PER_HAND} actions`,
      );
    }
    if (sawPreflopAllIn) {
      handsWithPreflopAllIn += 1;
      scope.handsWithPreflopAllIn += 1;
    }
    if (sawPostflopAllIn) {
      handsWithPostflopAllIn += 1;
      scope.handsWithPostflopAllIn += 1;
    }
    if (scope.clock === "live" && session.status === "playing") {
      session = advanceTournamentSessionClock(session, MS_PER_LIVE_CLOCK_HAND);
    }
  }

  const reachedHandCap = session.status === "playing" && hands >= maxHands;
  return {
    clock: scope.clock,
    seed,
    hands,
    decisions,
    allInActions,
    handsWithPreflopAllIn,
    handsWithPostflopAllIn,
    completed: session.status === "complete",
    reachedHandCap,
    finalBlindLevel: session.tournament.levelIndex + 1,
  };
}

function countAndRate(decisions: number, allInActions: number): CountAndRate {
  return {
    decisions,
    allInActions,
    allInActionRate: round(decisions ? allInActions / decisions : 0),
  };
}

function summarize(scope: MutableScope): ClockAudit {
  const streetAllIns = emptyStreetCounts();
  const depthAllIns = emptyDepthCounts();
  const byKind = { open: 0, raise: 0, call: 0 };
  let personalityDeviationAllIns = 0;
  let legalityViolations = 0;

  for (const event of scope.allIns) {
    streetAllIns[event.street] += 1;
    depthAllIns[event.effectiveStackBucket] += 1;
    byKind[event.kind] += 1;
    if (event.usedPersonalityDeviation) personalityDeviationAllIns += 1;
    if (
      !event.legal.allInAvailable || !event.legal.targetMatches ||
      !event.legal.zeroStackAfter || !event.legal.allInStatusAfter
    ) {
      legalityViolations += 1;
    }
  }

  const preflopRate = round(
    scope.hands ? scope.handsWithPreflopAllIn / scope.hands : 0,
  );
  const postflopRate = round(
    scope.hands ? scope.handsWithPostflopAllIn / scope.hands : 0,
  );
  const byStreet = Object.fromEntries(
    ALL_STREETS.map((street) => [
      street,
      countAndRate(scope.streetDecisions[street], streetAllIns[street]),
    ]),
  ) as Record<Street, CountAndRate>;
  const byEffectiveStack = Object.fromEntries(
    Object.keys(scope.depthDecisions).map((bucket) => [
      bucket,
      countAndRate(
        scope.depthDecisions[bucket as EffectiveStackBucket],
        depthAllIns[bucket as EffectiveStackBucket],
      ),
    ]),
  ) as Record<EffectiveStackBucket, CountAndRate>;

  return {
    clock: scope.clock,
    tournaments: scope.tournaments.length,
    completedTournaments: scope.tournaments.filter((entry) => entry.completed).length,
    cappedTournaments: scope.tournaments.filter((entry) => entry.reachedHandCap).length,
    hands: scope.hands,
    decisions: scope.decisions,
    allInActions: scope.allIns.length,
    allInActionRate: round(scope.decisions ? scope.allIns.length / scope.decisions : 0),
    handsWithPreflopAllIn: scope.handsWithPreflopAllIn,
    preflopAllInHandRate: preflopRate,
    preflopAllInHandRateWilson95: wilson95(
      scope.handsWithPreflopAllIn,
      scope.hands,
    ),
    handsWithPostflopAllIn: scope.handsWithPostflopAllIn,
    postflopAllInHandRate: postflopRate,
    postflopAllInHandRateWilson95: wilson95(
      scope.handsWithPostflopAllIn,
      scope.hands,
    ),
    byStreet,
    byEffectiveStack,
    byKind,
    personalityDeviationAllIns,
    legality: {
      decisionsVerified: scope.decisions,
      allInsVerified: scope.allIns.length,
      violations: legalityViolations,
    },
    ...(scope.clock === "frozen"
      ? {
          releaseGateComparison: {
            preflop: {
              measured: preflopRate,
              maximum: DOCUMENTED_ALL_IN_REFERENCE.releaseBounds
                .preflopAllInHandRateMax,
              pass: preflopRate <= DOCUMENTED_ALL_IN_REFERENCE.releaseBounds
                .preflopAllInHandRateMax,
            },
            postflop: {
              measured: postflopRate,
              maximum: DOCUMENTED_ALL_IN_REFERENCE.releaseBounds
                .postflopAllInHandRateMax,
              pass: postflopRate <= DOCUMENTED_ALL_IN_REFERENCE.releaseBounds
                .postflopAllInHandRateMax,
            },
          },
        }
      : {}),
  };
}

export function auditSeedList(count: number, prefix: string): string[] {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error("Audit seed count must be a positive integer");
  }
  if (!prefix.trim()) throw new Error("Audit seed prefix must not be empty");
  return Array.from(
    { length: count },
    // Deliberately matches measure-ai-behavior.ts's public seed series so a
    // detailed audit can be reconciled against the release instrument.
    (_, index) => `${prefix}-${index}`,
  );
}

export function runNormalAllInAudit(
  options: NormalAllInAuditOptions,
): NormalAllInAuditReport {
  if (!options.seeds.length) throw new Error("At least one audit seed is required");
  if (!options.clocks.length) throw new Error("At least one audit clock is required");
  if (new Set(options.seeds).size !== options.seeds.length) {
    throw new Error("Audit seeds must be unique");
  }
  if (new Set(options.clocks).size !== options.clocks.length) {
    throw new Error("Audit clocks must be unique");
  }

  const eventId = options.eventId ?? "local-qualifier";
  const maxHands = options.maxHandsPerTournament ??
    DEFAULT_MAX_HANDS_PER_TOURNAMENT;
  if (!Number.isSafeInteger(maxHands) || maxHands <= 0) {
    throw new Error("Maximum hands per tournament must be a positive integer");
  }

  const scopes = new Map<AuditClock, MutableScope>();
  for (const clock of options.clocks) {
    const scope: MutableScope = {
      clock,
      tournaments: [],
      hands: 0,
      decisions: 0,
      handsWithPreflopAllIn: 0,
      handsWithPostflopAllIn: 0,
      streetDecisions: emptyStreetCounts(),
      depthDecisions: emptyDepthCounts(),
      rationalBaselinePolicies: new Set<string>(),
      allIns: [],
    };
    for (const seed of options.seeds) {
      scope.tournaments.push(playTournament(scope, seed, eventId, maxHands));
    }
    scopes.set(clock, scope);
  }

  const allScopes = [...scopes.values()];
  const rationalBaselinePolicies = new Set(
    allScopes.flatMap((scope) => [...scope.rationalBaselinePolicies]),
  );
  if (rationalBaselinePolicies.size !== 1) {
    throw new Error(
      `Expected one Rational baseline policy version, observed ${[
        ...rationalBaselinePolicies,
      ].join(", ") || "none"}`,
    );
  }
  const [rationalBaselinePolicy] = rationalBaselinePolicies;
  const projectRoot = process.cwd();

  return {
    schemaVersion: 1,
    auditVersion: NORMAL_ALL_IN_AUDIT_VERSION,
    status: "reproducible-measurement",
    scope: "normal-mode-all-in-frequency-and-context",
    auditDate: options.auditDate ?? "unspecified",
    sourceRevision: options.sourceRevision ?? "unspecified",
    versions: {
      package: packageVersion(projectRoot),
      normalPolicy: NORMAL_POLICY_VERSION,
      rationalBaselinePolicy,
    },
    inputs: {
      eventId,
      seeds: [...options.seeds],
      clocks: [...options.clocks],
      maxHandsPerTournament: maxHands,
      liveClockAdvanceMsPerHand: MS_PER_LIVE_CLOCK_HAND,
      policy: POLICY_OPTIONS,
    },
    reproductionCommand: options.reproductionCommand ?? "unspecified",
    relevantSourceSha256: sourceHashes(projectRoot),
    documentedReference: DOCUMENTED_ALL_IN_REFERENCE,
    summaries: {
      frozen: scopes.has("frozen") ? summarize(scopes.get("frozen")!) : null,
      live: scopes.has("live") ? summarize(scopes.get("live")!) : null,
    },
    tournaments: allScopes.flatMap((scope) => scope.tournaments),
    allIns: allScopes.flatMap((scope) => scope.allIns),
  };
}
