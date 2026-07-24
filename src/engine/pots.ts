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
    if (eligiblePlayerIds.length === 0) {
      throw new Error("A contested contribution layer has no eligible winner");
    }

    pots.push({
      id: pots.length === 0 ? "main" : `side-${pots.length}`,
      kind: pots.length === 0 ? "main" : "side",
      amount,
      cap,
      contributorIds: contributors.map((entry) => entry.playerId),
      eligiblePlayerIds,
    });
  }

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

