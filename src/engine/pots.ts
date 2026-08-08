import type { Card } from "../types/poker";
import {
  compareHandValues,
  evaluateBestHand,
  type HandValue,
} from "./evaluator";

export interface PlayerContribution {
  playerId: string;
  amount: number;
  folded?: boolean;
  /** Only an all-in cap can start a new contestable side-pot layer. */
  allIn?: boolean;
}

export interface ContestablePot {
  id: string;
  kind: "main" | "side";
  amount: number;
  cap: number;
  contributorIds: string[];
  eligiblePlayerIds: string[];
}

export interface PotRefund {
  playerId: string;
  amount: number;
}

export interface PotBuildResult {
  pots: ContestablePot[];
  refunds: PotRefund[];
  totalContributed: number;
}

export interface LivePotBuildResult {
  pots: ContestablePot[];
  /** Contributions that are currently unmatched and still await return. */
  refunds: PotRefund[];
  totalContributed: number;
}

export interface ResolvePotsOptions {
  board: readonly Card[];
  holeCards: Readonly<Record<string, readonly Card[]>>;
  seats: Readonly<Record<string, number>>;
  buttonSeat: number;
  tableSize: number;
  smallestChip?: number;
}

export interface PotAward {
  potId: string;
  playerId: string;
  amount: number;
  hand?: HandValue;
}

export interface ResolvedPots {
  awards: PotAward[];
  evaluatedHands: Record<string, HandValue>;
}

function assertAmount(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export function buildPots(
  contributions: readonly PlayerContribution[],
): PotBuildResult {
  const ids = contributions.map((entry) => entry.playerId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Each player may appear only once in the contribution ledger");
  }
  for (const contribution of contributions) {
    assertAmount(contribution.amount, `Contribution for ${contribution.playerId}`);
  }

  const positive = contributions.filter((entry) => entry.amount > 0);
  const levels = [...new Set(positive.map((entry) => entry.amount))].sort(
    (left, right) => left - right,
  );
  const pots: ContestablePot[] = [];
  const refundMap = new Map<string, number>();
  let previousCap = 0;
  const allInCaps = new Set(
    positive
      .filter((entry) => entry.allIn)
      .map((entry) => entry.amount),
  );
  let currentPot:
    | {
        amount: number;
        cap: number;
        contributorIds: string[];
        eligiblePlayerIds: string[];
      }
    | undefined;

  const flushPot = () => {
    if (!currentPot) return;
    if (currentPot.amount <= 0) {
      currentPot = undefined;
      return;
    }
    if (currentPot.eligiblePlayerIds.length === 0) {
      throw new Error("A contested contribution layer has no eligible winner");
    }
    pots.push({
      id: pots.length === 0 ? "main" : `side-${pots.length}`,
      kind: pots.length === 0 ? "main" : "side",
      ...currentPot,
    });
    currentPot = undefined;
  };

  for (const cap of levels) {
    const contributors = positive.filter((entry) => entry.amount >= cap);
    const amount = (cap - previousCap) * contributors.length;
    previousCap = cap;

    if (contributors.length === 1) {
      const playerId = contributors[0].playerId;
      refundMap.set(playerId, (refundMap.get(playerId) ?? 0) + amount);
      continue;
    }

    const eligiblePlayerIds = contributors
      .filter((entry) => !entry.folded)
      .map((entry) => entry.playerId);
    if (!currentPot) {
      currentPot = {
        amount: 0,
        cap,
        contributorIds: [],
        eligiblePlayerIds: [],
      };
    }
    currentPot.amount += amount;
    currentPot.cap = cap;
    for (const playerId of contributors.map((entry) => entry.playerId)) {
      if (!currentPot.contributorIds.includes(playerId)) {
        currentPot.contributorIds.push(playerId);
      }
    }
    for (const playerId of eligiblePlayerIds) {
      if (!currentPot.eligiblePlayerIds.includes(playerId)) {
        currentPot.eligiblePlayerIds.push(playerId);
      }
    }
    if (allInCaps.has(cap)) flushPot();
  }
  flushPot();

  return {
    pots,
    refunds: [...refundMap.entries()].map(([playerId, amount]) => ({
      playerId,
      amount,
    })),
    totalContributed: contributions.reduce(
      (sum, contribution) => sum + contribution.amount,
      0,
    ),
  };
}

/**
 * Builds the public, in-progress pot view. Unequal active commitments are
 * ordinary betting and remain one pot; contribution layers become separate
 * only at an actual all-in cap. Pending unmatched returns remain included in
 * the inclusive hand total until settlement applies the refund.
 */
export function buildLivePots(
  contributions: readonly PlayerContribution[],
): LivePotBuildResult {
  const totalContributed = contributions.reduce(
    (sum, contribution) => sum + contribution.amount,
    0,
  );
  if (totalContributed === 0) {
    return { pots: [], refunds: [], totalContributed: 0 };
  }

  const built = buildPots(contributions);
  if (!contributions.some((contribution) => contribution.allIn)) {
    const positive = contributions.filter((contribution) => contribution.amount > 0);
    const eligiblePlayerIds = positive
      .filter((contribution) => !contribution.folded)
      .map((contribution) => contribution.playerId);
    if (eligiblePlayerIds.length === 0) {
      return { ...built, pots: [] };
    }
    return {
      pots: [{
        id: "main",
        kind: "main",
        amount: totalContributed,
        cap: Math.max(...positive.map((contribution) => contribution.amount)),
        contributorIds: positive.map((contribution) => contribution.playerId),
        eligiblePlayerIds,
      }],
      refunds: built.refunds,
      totalContributed,
    };
  }

  if (built.pots.length === 0 || built.refunds.length === 0) return built;
  const [main, ...sidePots] = built.pots;
  return {
    ...built,
    pots: [
      { ...main, amount: main.amount + built.refunds.reduce((sum, refund) => sum + refund.amount, 0) },
      ...sidePots,
    ],
  };
}

function clockwiseDistance(
  seat: number,
  buttonSeat: number,
  tableSize: number,
): number {
  const distance = (seat - buttonSeat + tableSize) % tableSize;
  return distance === 0 ? tableSize : distance;
}

function orderWinnersForOddChips(
  playerIds: readonly string[],
  seats: Readonly<Record<string, number>>,
  buttonSeat: number,
  tableSize: number,
): string[] {
  return [...playerIds].sort((left, right) => {
    const leftSeat = seats[left];
    const rightSeat = seats[right];
    if (leftSeat === undefined || rightSeat === undefined) {
      throw new Error("Every pot-eligible player requires a seat");
    }
    return (
      clockwiseDistance(leftSeat, buttonSeat, tableSize) -
      clockwiseDistance(rightSeat, buttonSeat, tableSize)
    );
  });
}

export function resolvePots(
  pots: readonly ContestablePot[],
  options: ResolvePotsOptions,
): ResolvedPots {
  const smallestChip = options.smallestChip ?? 1;
  assertAmount(smallestChip, "Smallest chip");
  if (smallestChip === 0) throw new Error("Smallest chip must be positive");
  if (!Number.isSafeInteger(options.tableSize) || options.tableSize < 2) {
    throw new Error("Table size must be an integer of at least two");
  }

  const evaluatedHands: Record<string, HandValue> = {};
  const awards: PotAward[] = [];

  for (const pot of pots) {
    assertAmount(pot.amount, `Amount for pot ${pot.id}`);
    if (pot.eligiblePlayerIds.length === 0) {
      throw new Error(`Pot ${pot.id} has no eligible players`);
    }

    let winners: string[];
    if (pot.eligiblePlayerIds.length === 1) {
      winners = [pot.eligiblePlayerIds[0]];
    } else {
      for (const playerId of pot.eligiblePlayerIds) {
        if (!evaluatedHands[playerId]) {
          const hole = options.holeCards[playerId];
          if (!hole || hole.length !== 2) {
            throw new Error(`Player ${playerId} requires two hole cards`);
          }
          evaluatedHands[playerId] = evaluateBestHand([
            ...hole,
            ...options.board,
          ]);
        }
      }

      const bestPlayer = pot.eligiblePlayerIds.reduce((best, candidate) =>
        compareHandValues(
          evaluatedHands[candidate],
          evaluatedHands[best],
        ) > 0
          ? candidate
          : best,
      );
      winners = pot.eligiblePlayerIds.filter(
        (playerId) =>
          compareHandValues(
            evaluatedHands[playerId],
            evaluatedHands[bestPlayer],
          ) === 0,
      );
    }

    const ordered = orderWinnersForOddChips(
      winners,
      options.seats,
      options.buttonSeat,
      options.tableSize,
    );
    const share =
      Math.floor(pot.amount / winners.length / smallestChip) * smallestChip;
    let remainder = pot.amount - share * winners.length;

    for (const playerId of winners) {
      awards.push({
        potId: pot.id,
        playerId,
        amount: share,
        hand: evaluatedHands[playerId],
      });
    }

    let oddIndex = 0;
    while (remainder >= smallestChip) {
      const playerId = ordered[oddIndex % ordered.length];
      const award = awards.find(
        (entry) => entry.potId === pot.id && entry.playerId === playerId,
      );
      if (!award) throw new Error("Unable to assign odd chip");
      award.amount += smallestChip;
      remainder -= smallestChip;
      oddIndex += 1;
    }
    if (remainder !== 0) {
      throw new Error(`Pot ${pot.id} cannot be divided by the chip denomination`);
    }
  }

  return { awards, evaluatedHands };
}
