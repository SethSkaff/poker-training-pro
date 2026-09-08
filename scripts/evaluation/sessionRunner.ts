import { createHash } from "node:crypto";
import {
  advanceTournamentSessionClock,
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  createSessionOpponents,
  createTournamentSession,
  progressTournamentSessionHand,
  type SessionPolicyOptions,
  type TournamentSession,
  type TournamentSessionProgressionOptions,
} from "../../src/modes/tournamentSession";
import { createInformationSet } from "../../src/engine/tournament";
import { getLegalActions, nextToAct } from "../../src/engine/betting";
import { computeWagerGeometry, canonicalizeBettingAction } from "../../src/lib/pokerActionSemantics";
import { captureDecisionBefore, completeDecisionEvent, type BehavioralDecisionEvent } from "./decisionEvent";
import { stratifyDecision } from "./stratification";
import type { ArtifactRef, PolicyIdentity } from "./contracts";
import { evaluatePolicyAtNode, type EvaluationPolicyAdapter } from "./policyAdapter";

export interface EvaluationHandSummary {
  handId: string;
  handNumber: number;
  actionCount: number;
  completed: boolean;
  heroBusted: boolean;
  eliminatedPlayerIds: string[];
}

export interface EvaluationSessionResult {
  sessionId: string;
  mode: "normal" | "rational" | "scripted";
  scope: "hero" | "full-field";
  status: "complete" | "budget_exhausted" | "invalid";
  completed: boolean;
  censored: boolean;
  hands: EvaluationHandSummary[];
  events: BehavioralDecisionEvent[];
  heroMilestone: { handId: string; handNumber: number; finishPlace: number | null } | null;
  finalActivePlayers: number;
  actions: number;
  error: string | null;
}

export interface EvaluationSessionOptions {
  eventId?: string;
  seed?: string | number;
  sessionId?: string;
  hero?: { id: string; name: string; rating?: number };
  mode?: "normal" | "rational";
  scope?: "hero" | "full-field";
  maxHands?: number;
  maxActionsPerHand?: number;
  policy?: EvaluationPolicyAdapter;
  policyOptions?: SessionPolicyOptions;
  clockMsPerHand?: number;
}

function ref(label: string): ArtifactRef {
  return { relativePath: `evaluation-fixture/${label}.json`, sha256: createHash("sha256").update(label).digest("hex"), bytes: 0 };
}

function policyIdentity(mode: "normal" | "rational" | "scripted", seed: string | number): PolicyIdentity {
  const identity = {
    mode,
    policyVersion: "evaluation-session-adapter-v1",
    engineVersion: "tournament-session-v1",
    contentVersion: "career-events-v1",
    sourceTreeHash: createHash("sha256").update(String(seed)).digest("hex"),
    parameterHash: createHash("sha256").update(`${mode}:${seed}`).digest("hex"),
    profileKey: null,
    profileId: null,
    profileHash: null,
    adapterVersion: "evaluation-session-adapter-v1",
  } as const;
  return { ...identity, id: createHash("sha256").update(JSON.stringify(identity)).digest("hex") };
}

function reproduction(seed: string | number, mode: "normal" | "rational" | "scripted", sessionId: string, handId: string, handNumber: number, decisionIndex: number, actorId: string): import("./contracts").Reproduction {
  const base = `${seed}:${sessionId}:${handId}:${decisionIndex}:${actorId}`;
  const digest = createHash("sha256").update(base).digest("hex");
  return {
    manifestHash: digest,
    scenarioId: null,
    familyId: `natural-${sessionId}`,
    blockId: `block-${String(seed)}`,
    sessionId,
    handId,
    handNumber,
    decisionIndex,
    streetActionIndex: decisionIndex,
    initialStateRef: ref(`${handId}-initial`),
    prefixRef: ref(`${handId}-prefix-${decisionIndex}`),
    sourceSnapshotRef: ref("source-snapshot"),
    stateHash: digest,
    masterSeed: String(seed),
    dealSeed: `${seed}:${handId}:deck`,
    equitySeed: `${seed}:${handId}:equity:${decisionIndex}`,
    actionSeed: `${seed}:${handId}:action:${actorId}`,
    samplingSeed: `${seed}:sampling`,
    seedStreamVersion: "evaluation-stream-v1",
    rolloutReplicate: 0,
    policy: policyIdentity(mode, seed),
    simulations: 60,
    temperature: mode === "rational" || mode === "normal" ? 0.48 : null,
  };
}

function handNumber(session: TournamentSession): number {
  return session.tournament.tables[0]?.handNumber ?? 0;
}

export function runEvaluationSession(options: EvaluationSessionOptions = {}): EvaluationSessionResult {
  const seed = options.seed ?? "evaluation-session-0";
  const eventId = options.eventId ?? "local-qualifier";
  const mode = options.mode ?? "rational";
  const scope = options.scope ?? "hero";
  const sessionId = options.sessionId ?? `evaluation:${String(seed)}:${mode}`;
  const hero = options.hero ?? { id: "hero", name: "Evaluation Hero", rating: 1_000 };
  const opponents = createSessionOpponents(seed, eventId, mode);
  let session: TournamentSession = createTournamentSession({ eventId, hero, mode, seed, opponents });
  const policy = options.policy ?? (mode === "normal" || mode === "rational" ? {
    id: `production-${mode}`,
    mode,
    choose: (current: TournamentSession, playerId: string) => evaluatePolicyAtNode(current, playerId, options.policyOptions).command,
  } satisfies EvaluationPolicyAdapter : undefined);
  if (!policy) throw new Error("A scripted evaluation requires a policy adapter");
  const progression: TournamentSessionProgressionOptions = { completionScope: scope };
  const hands: EvaluationHandSummary[] = [];
  const events: BehavioralDecisionEvent[] = [];
  let heroMilestone: EvaluationSessionResult["heroMilestone"] = null;
  let actions = 0;
  const maxHands = options.maxHands ?? 8;
  const maxActionsPerHand = options.maxActionsPerHand ?? 4_000;
  let error: string | null = null;

  try {
    while (session.status === "playing" && hands.length < maxHands) {
      session = beginTournamentSessionHand(session);
      const handId = session.activeHand?.handId;
      if (!handId || !session.activeHand) throw new Error("Session hand did not start");
      const startingHandNumber = handNumber(session);
      let handActions = 0;
      let handEventCount = 0;
      while (session.activeHand && handActions < maxActionsPerHand) {
        const hand = session.activeHand;
        if (hand.betting.complete) {
          session = progressTournamentSessionHand(session, progression);
          continue;
        }
        const actorId = nextToAct(hand.betting);
        if (!actorId) {
          session = progressTournamentSessionHand(session, progression);
          continue;
        }
        const actorView = createInformationSet(hand.information, actorId);
        const legal = getLegalActions(hand.betting, actorId);
        const command = policy.choose(session, actorId);
        const canonical = canonicalizeBettingAction(hand.betting, command);
        const bigBlind = session.tournament.structure.levels[session.tournament.levelIndex]?.bigBlind ?? 1;
        const geometry = computeWagerGeometry({ preState: hand.betting, canonicalAction: canonical, bigBlindChips: bigBlind, smallestChipChips: session.tournament.structure.smallestChip ?? 1 });
        const strata = stratifyDecision({ informationSet: actorView, geometry, tournamentPlayersRemaining: session.tournament.players.filter((player) => player.status === "active").length });
        const pending = captureDecisionBefore({
          decisionId: `${sessionId}:${handId}:decision-${handActions}`,
          reproduction: reproduction(seed, policy.mode, sessionId, handId, startingHandNumber, handActions, actorId),
          policy: policyIdentity(policy.mode, seed),
          preState: hand.betting,
          actorView,
          legal,
          strata,
          opportunityIds: [],
          traceRef: `${sessionId}:${handId}:trace-${handActions}`,
        });
        const event = completeDecisionEvent({ frame: pending, command, geometry: { bigBlindChips: bigBlind, smallestChipChips: session.tournament.structure.smallestChip ?? 1 } });
        events.push(event);
        handEventCount += 1;
        session = applyTournamentSessionAction(session, actorId, command);
        handActions += 1;
        actions += 1;
      }
      const capped = Boolean(session.activeHand);
      if (capped) {
        hands.push({ handId, handNumber: startingHandNumber, actionCount: handActions, completed: false, heroBusted: false, eliminatedPlayerIds: [] });
        return {
          sessionId, mode: policy.mode, scope, status: "budget_exhausted", completed: false, censored: true,
          hands, events, heroMilestone, finalActivePlayers: session.tournament.players.filter((player) => player.status === "active").length,
          actions, error: null,
        };
      }
      const summary = session.lastHand;
      const heroState = session.tournament.players.find((player) => player.id === session.heroId);
      const heroBusted = heroState?.status === "eliminated";
      if (heroBusted && !heroMilestone) {
        heroMilestone = { handId, handNumber: startingHandNumber, finishPlace: heroState?.finishPlace ?? null };
      }
      hands.push({ handId, handNumber: startingHandNumber, actionCount: handActions, completed: true, heroBusted, eliminatedPlayerIds: summary?.eliminatedPlayerIds ?? [] });
      if (options.clockMsPerHand) session = advanceTournamentSessionClock(session, options.clockMsPerHand);
      if (handEventCount === 0) throw new Error(`Hand ${handId} produced no decision events`);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const complete = error === null && session.status === "complete";
  return {
    sessionId, mode: policy.mode, scope,
    status: error ? "invalid" : complete ? "complete" : "budget_exhausted",
    completed: complete,
    censored: !complete,
    hands, events, heroMilestone,
    finalActivePlayers: session.tournament.players.filter((player) => player.status === "active").length,
    actions, error,
  };
}
