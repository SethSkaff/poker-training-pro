import type { Card } from "../../src/types/poker";
import type {
  ReviewCanonicalAction,
  ReviewConditioningModel,
  ReviewFiniteWorld,
  ReviewNode,
} from "../../src/modes/reviewEvidence";
import { referenceConditioningFingerprint } from "./referenceValues";

function card(rank: Card["rank"], suit: Card["suit"]): Card {
  return { rank, suit };
}

function action(
  key: string,
  kind: ReviewCanonicalAction["kind"],
  targetChips: number,
  investedChips: number,
  options: Partial<Pick<ReviewCanonicalAction, "isActorAllIn" | "stackOffClass" | "isFullRaise" | "isShortAllInIncrease" | "raisesCurrentBet" | "raiseByChips">> = {},
): ReviewCanonicalAction {
  const raisesCurrentBet = options.raisesCurrentBet ?? (kind === "bet" || kind === "raise");
  return {
    key,
    kind,
    targetChips,
    investedChips,
    raisesCurrentBet,
    raiseByChips: options.raiseByChips ?? (raisesCurrentBet ? investedChips : 0),
    isActorAllIn: options.isActorAllIn ?? false,
    stackOffClass: options.stackOffClass ?? "none",
    isFullRaise: options.isFullRaise ?? (kind === "bet" || kind === "raise"),
    isShortAllInIncrease: options.isShortAllInIncrease ?? false,
  };
}

const heroCards = [card("A", "spades"), card("K", "diamonds")];
const board = [
  card("2", "clubs"),
  card("7", "hearts"),
  card("9", "spades"),
  card("J", "diamonds"),
  card("3", "clubs"),
];

function conditioning(
  modelId: string,
  sizingSignature: string | null = null,
  domainStatus: "supported" | "partial" | "unsupported" = "supported",
  status: ReviewConditioningModel["conditioningStatus"] = "explicit_reference",
): ReviewConditioningModel {
  return {
    modelId,
    modelVersion: "fixture-conditioned-v1",
    conditioningPrefixHash: referenceConditioningFingerprint({ prefix: "public-prefix-0" }),
    observedSizingSignature: sizingSignature,
    conditioningStatus: status,
    dimensions: [
      { dimension: "action_type", observedValue: "bet", usedRepresentation: "bet", status: "conditioned", basis: "fixture" },
      { dimension: "raw_target_chips", observedValue: sizingSignature, usedRepresentation: sizingSignature, status: sizingSignature ? "conditioned" : "assumed", basis: "fixture target" },
      { dimension: "normalized_sizing", observedValue: sizingSignature, usedRepresentation: sizingSignature, status: sizingSignature ? "conditioned" : "assumed", basis: "fixture sizing" },
      { dimension: "ordered_prior_sequence", observedValue: "public-prefix-0", usedRepresentation: "public-prefix-0", status: "conditioned", basis: "fixture" },
      { dimension: "street", observedValue: "river", usedRepresentation: "river", status: "conditioned", basis: "fixture" },
      { dimension: "position", observedValue: "button", usedRepresentation: "button", status: "conditioned", basis: "fixture" },
      { dimension: "depth_matchable_exposure", observedValue: 100, usedRepresentation: "100", status: "conditioned", basis: "fixture" },
      { dimension: "tournament_context", observedValue: null, usedRepresentation: null, status: "not_applicable", basis: "chip-EV fixture" },
    ],
    domainEvidence: {
      status: domainStatus,
      supportedDescription: "This fixture explicitly defines the tested target sizes.",
      extrapolation: domainStatus === "partial" ? "Targets outside the declared fixture sweep are unsupported." : null,
      basis: "reference-case-fixture",
    },
    limitations: [],
  };
}

function baseNode(
  nodeId: string,
  legalActions: readonly ReviewCanonicalAction[],
  overrides: Partial<ReviewNode> = {},
): ReviewNode {
  const opponents = overrides.opponents ?? [{
    id: "villain",
    remainingStackChips: 100,
    streetCommittedChips: 0,
    totalCommittedChips: 0,
    seat: 1,
    status: "active" as const,
  }];
  return {
    schemaVersion: 1,
    nodeId,
    handId: `hand-${nodeId}`,
    index: 0,
    actorId: "hero",
    objective: "chip_ev",
    street: "river",
    board,
    heroCards,
    potBeforeChips: 100,
    actorStackBeforeChips: 100,
    actorStreetCommittedChips: 0,
    actorTotalCommittedChips: 0,
    currentBetChips: 100,
    bigBlindChips: 1,
    smallestChipChips: 1,
    buttonSeat: 0,
    tableSize: Math.max(2, opponents.length + 1),
    opponents,
    legalActions,
    publicPrefix: [],
    publicPrefixHash: "public-prefix-0",
    observedSizingSignature: null,
    ...overrides,
  };
}

function world(
  worldId: string,
  weight: number,
  opponentCards: Readonly<Record<string, readonly Card[]>>,
  payoffByAction?: Readonly<Record<string, number>>,
  responses?: ReviewFiniteWorld["responses"],
  runouts?: readonly (readonly Card[])[],
): ReviewFiniteWorld {
  return { worldId, weight, opponentCards, payoffByAction, responses, runouts };
}

export interface ReferenceCase {
  id: string;
  description: string;
  node: ReviewNode;
  actions: readonly ReviewCanonicalAction[];
  expected: Readonly<Record<string, { mean: number | null; exact: boolean; support: "supported" | "unavailable" | "ood" }>>;
}

const fold = action("fold", "fold", 0, 0);
const call100 = action("call:100", "call", 100, 100);
const allInCall100 = action("all-in-call:100", "call", 100, 100, { isActorAllIn: true, stackOffClass: "all_in_call" });
const allInRaise100 = action("all-in-raise:100", "raise", 100, 100, { isActorAllIn: true, stackOffClass: "aggressive_jam", isFullRaise: true });

const cases: ReferenceCase[] = [];

cases.push({
  id: "exact-fold-zero",
  description: "Terminal fold is exactly zero incremental payoff.",
  node: baseNode("exact-fold-zero", [fold], { currentBetChips: 0, legalActions: [fold] }),
  actions: [fold],
  expected: { fold: { mean: 0, exact: true, support: "supported" } },
});

const losingWorld = world(
  "losing-qq",
  1,
  { villain: [card("Q", "spades"), card("Q", "hearts")] },
  undefined,
  { "call:100": { villain: { kind: "all-in", targetChips: 100 } }, "all-in-call:100": { villain: { kind: "all-in", targetChips: 100 } } },
);
cases.push({
  id: "known-river-loss",
  description: "Known river all-in loss uses ending stack minus predecision stack.",
  node: baseNode("known-river-loss", [fold, call100, allInCall100], { worlds: [losingWorld] }),
  actions: [fold, call100, allInCall100],
  expected: {
    fold: { mean: 0, exact: true, support: "supported" },
    "call:100": { mean: -100, exact: true, support: "supported" },
    "all-in-call:100": { mean: -100, exact: true, support: "supported" },
  },
});

const tieWorld = world(
  "tie-odd-chip",
  1,
  { villain: [card("A", "hearts"), card("K", "clubs")] },
  undefined,
  { "call:100": { villain: { kind: "all-in", targetChips: 101 } } },
);
cases.push({
  id: "tie-odd-chip",
  description: "Engine settlement handles an odd chip in a tied pot.",
  node: baseNode("tie-odd-chip", [call100], {
    potBeforeChips: 1,
    currentBetChips: 1,
    opponents: [{ id: "villain", remainingStackChips: 100, streetCommittedChips: 1, totalCommittedChips: 1, seat: 1, status: "active" }],
    worlds: [tieWorld],
  }),
  actions: [call100],
  expected: { "call:100": { mean: 0, exact: true, support: "supported" } },
});

const sidePotOpponents = [
  { id: "short", remainingStackChips: 50, streetCommittedChips: 0, totalCommittedChips: 0, seat: 1, status: "active" as const },
  { id: "deep-a", remainingStackChips: 50, streetCommittedChips: 50, totalCommittedChips: 50, seat: 2, status: "active" as const },
  { id: "deep-b", remainingStackChips: 50, streetCommittedChips: 50, totalCommittedChips: 50, seat: 3, status: "active" as const },
];
const sidePotWorld = world(
  "side-pot-main-win",
  1,
  {
    short: [card("Q", "spades"), card("8", "hearts")],
    "deep-a": [card("4", "spades"), card("6", "hearts")],
    "deep-b": [card("5", "spades"), card("T", "hearts")],
  },
  undefined,
  { "all-in-call:50": {
    short: { kind: "all-in", targetChips: 50 },
    "deep-a": { kind: "call", targetChips: 100 },
    "deep-b": { kind: "call", targetChips: 100 },
  } },
);
const allInCall50 = action("all-in-call:50", "call", 50, 50, { isActorAllIn: true, stackOffClass: "all_in_call" });
cases.push({
  id: "side-pot-main-award",
  description: "A short actor can win the main pot without receiving a deep side pot.",
  node: baseNode("side-pot-main-award", [allInCall50], {
    potBeforeChips: 100,
    actorStackBeforeChips: 50,
    currentBetChips: 50,
    opponents: sidePotOpponents,
    worlds: [sidePotWorld],
    tableSize: 4,
  }),
  actions: [allInCall50],
  expected: { "all-in-call:50": { mean: 150, exact: true, support: "supported" } },
});

cases.push({
  id: "unequal-stack-call",
  description: "Unequal stack terminal call remains a legal finite expectation.",
  node: baseNode("unequal-stack-call", [call100], {
    actorStackBeforeChips: 100,
    opponents: [{ id: "villain", remainingStackChips: 40, streetCommittedChips: 60, totalCommittedChips: 60, seat: 1, status: "active" }],
    potBeforeChips: 60,
    currentBetChips: 60,
    worlds: [world("unequal-win", 1, { villain: [card("Q", "spades"), card("Q", "hearts")] }, undefined, { "call:100": { villain: { kind: "all-in", targetChips: 100 } } })],
  }),
  actions: [call100],
  expected: { "call:100": { mean: -100, exact: true, support: "supported" } },
});

const hiddenA = world("hidden-a", 1, { villain: [card("2", "spades"), card("2", "hearts")] }, { "call:100": 100 });
const hiddenB = world("hidden-b", 3, { villain: [card("A", "hearts"), card("A", "clubs")] }, { "call:100": -100 });
cases.push({
  id: "weighted-hidden-world",
  description: "Joint hidden-world weights normalize once across complete worlds.",
  node: baseNode("weighted-hidden-world", [call100], { worlds: [hiddenA, hiddenB] }),
  actions: [call100],
  expected: { "call:100": { mean: -50, exact: true, support: "supported" } },
});

const sweepActions = [
  action("size:33", "bet", 133, 133),
  action("size:75", "bet", 175, 175),
  action("size:150", "bet", 250, 250),
  action("size:500", "bet", 600, 600),
  action("size:1300", "bet", 1400, 1400),
];
const sweepPayoffs = { "size:33": 1, "size:75": 2, "size:150": 3, "size:500": 4, "size:1300": 5 };
cases.push({
  id: "conditioned-size-sweep",
  description: "The five observed-size inputs have explicit conditioning records.",
  node: baseNode("conditioned-size-sweep", sweepActions, {
    potBeforeChips: 100,
    actorStackBeforeChips: 2000,
    opponents: [{ id: "villain", remainingStackChips: 2000, streetCommittedChips: 100, totalCommittedChips: 100, seat: 1, status: "active" }],
    conditioningModels: sweepActions.map((entry) => conditioning("size-model", entry.key)),
    worlds: [world("sweep-world", 1, { villain: [card("Q", "spades"), card("Q", "hearts")] }, sweepPayoffs)],
  }),
  actions: sweepActions,
  expected: Object.fromEntries(Object.entries(sweepPayoffs).map(([key, mean]) => [key, { mean, exact: true, support: "supported" as const }])),
});

const unsupportedTreeAction = action("check-nonterminal", "check", 0, 0, { raisesCurrentBet: false, raiseByChips: 0, isFullRaise: false });
cases.push({
  id: "unsupported-nonterminal",
  description: "A nonterminal action with no continuation is unsupported, not a zero payoff.",
  node: baseNode("unsupported-nonterminal", [unsupportedTreeAction], {
    continuationTree: { treeId: "tree-missing-check", version: "1", actions: [{ actionKey: unsupportedTreeAction.key, supported: false, assumption: "No continuation supplied" }] },
  }),
  actions: [unsupportedTreeAction],
  expected: { [unsupportedTreeAction.key]: { mean: null, exact: false, support: "unavailable" } },
});

const treeAction = action("tree-call", "call", 100, 100);
cases.push({
  id: "bounded-continuation-tree",
  description: "A supplied finite continuation tree returns its normalized terminal expectation.",
  node: baseNode("bounded-continuation-tree", [treeAction], {
    continuationTree: {
      treeId: "tree-call-v1",
      version: "1",
      actions: [{
        actionKey: treeAction.key,
        supported: true,
        assumption: "Two explicitly supplied river leaves",
        leaves: [
          { leafId: "win", probability: 1, payoffChips: 50 },
          { leafId: "loss", probability: 3, payoffChips: -50 },
        ],
      }],
    },
  }),
  actions: [treeAction],
  expected: { [treeAction.key]: { mean: -25, exact: true, support: "supported" } },
});

const unusual5x = action("overbet:500", "bet", 500, 500);
cases.push({
  id: "unusual-five-x-supported",
  description: "A supported five-times-pot line is unusual evidence, not automatically OOD.",
  node: baseNode("unusual-five-x-supported", [unusual5x], {
    potBeforeChips: 100,
    worlds: [world("five-x", 1, { villain: [card("Q", "spades"), card("Q", "hearts")] }, { [unusual5x.key]: 12 })],
    conditioningModels: [conditioning("size-model", unusual5x.key)],
  }),
  actions: [unusual5x],
  expected: { [unusual5x.key]: { mean: 12, exact: true, support: "supported" } },
});

const unusual10x = action("overbet:1300", "bet", 1300, 1300);
cases.push({
  id: "unusual-ten-x-supported",
  description: "A supported thirteen-pot-sized line remains analyzable under explicit scope.",
  node: baseNode("unusual-ten-x-supported", [unusual10x], {
    potBeforeChips: 100,
    actorStackBeforeChips: 2000,
    worlds: [world("thirteen-x", 1, { villain: [card("Q", "spades"), card("Q", "hearts")] }, { [unusual10x.key]: 8 })],
    conditioningModels: [conditioning("size-model", unusual10x.key)],
  }),
  actions: [unusual10x],
  expected: { [unusual10x.key]: { mean: 8, exact: true, support: "supported" } },
});

const aliasRaise = action("raise:100", "raise", 100, 100, { isActorAllIn: true, stackOffClass: "aggressive_jam" });
cases.push({
  id: "aggressive-jam-no-extra-raise",
  description: "The reconstructed jam menu can contain a call/all-in-call equivalence and no fictitious extra raise.",
  node: baseNode("aggressive-jam-no-extra-raise", [fold, call100, allInCall100, aliasRaise], {
    worlds: [world("jam-closure", 1, { villain: [card("Q", "spades"), card("Q", "hearts")] }, { fold: 0, "call:100": -100, "all-in-call:100": -100, "raise:100": -100 })],
  }),
  actions: [fold, call100, allInCall100, aliasRaise],
  expected: {
    fold: { mean: 0, exact: true, support: "supported" },
    "call:100": { mean: -100, exact: true, support: "supported" },
    "all-in-call:100": { mean: -100, exact: true, support: "supported" },
    "raise:100": { mean: -100, exact: true, support: "supported" },
  },
});

const domainUnsupportedAction = action("size:9999", "bet", 9999, 9999);
cases.push({
  id: "unsupported-domain",
  description: "A numerically exact result outside the declared domain remains OOD.",
  node: baseNode("unsupported-domain", [domainUnsupportedAction], {
    worlds: [world("domain-world", 1, { villain: [card("Q", "spades"), card("Q", "hearts")] }, { [domainUnsupportedAction.key]: 2 })],
    conditioningModels: [conditioning("size-model", domainUnsupportedAction.key, "unsupported", "unavailable")],
  }),
  actions: [domainUnsupportedAction],
  expected: { [domainUnsupportedAction.key]: { mean: 2, exact: true, support: "ood" } },
});

export const REFERENCE_CASES: readonly ReferenceCase[] = cases;

export function listReferenceCases(): readonly ReferenceCase[] {
  return REFERENCE_CASES;
}

export function loadReferenceCase(caseId: string): ReferenceCase {
  const referenceCase = REFERENCE_CASES.find((entry) => entry.id === caseId);
  if (!referenceCase) throw new Error(`Unknown reference case ${caseId}`);
  return referenceCase;
}

export function expectedReferenceValue(caseId: string, actionKey: string): number | null {
  return loadReferenceCase(caseId).expected[actionKey]?.mean ?? null;
}

export const REFERENCE_CASE_COUNT = REFERENCE_CASES.length;
