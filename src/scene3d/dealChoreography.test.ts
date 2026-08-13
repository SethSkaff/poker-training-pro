import { describe, expect, it } from "vitest";
import {
  createHoleCardDealPlan,
  HOLE_CARD_DEAL_DURATION_MS,
  sampleHoleCardDeal,
  sampleHoleCardDealAtMs,
  type DealPoint3,
  type HoleCardDealRecipient,
} from "./dealChoreography";
import {
  PLAYER_STATION_COUNT,
  TABLE_HEIGHT,
  playerStations,
  stationIndexForRelativeSeat,
} from "./tableStations";
import { seatPoses } from "./tableSceneModel";

const DECK: DealPoint3 = [0.28, TABLE_HEIGHT, -0.34];
const RIGHT_HAND_REST: DealPoint3 = [0.16, TABLE_HEIGHT, -0.36];

function recipients(heroStationIndex = 2): HoleCardDealRecipient[] {
  return seatPoses(PLAYER_STATION_COUNT, heroStationIndex).map((pose) => ({
    id: `player-${pose.seat}`,
    clockwiseIndex: pose.seat,
    cardAnchor: pose.feltPosition,
    facingRadians: pose.facing,
  }));
}

function plan(firstRecipientId = "player-0") {
  return createHoleCardDealPlan(
    recipients(),
    { surfaceY: TABLE_HEIGHT, deckAnchor: DECK, rightHandRest: RIGHT_HAND_REST },
    { firstRecipientId },
  );
}

function distance(left: DealPoint3, right: DealPoint3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

describe("initial two-card deal choreography", () => {
  it("visits active recipients clockwise from the named first player, then repeats the circuit", () => {
    const shuffled = [
      recipients()[2]!, recipients()[5]!, recipients()[0]!,
      recipients()[4]!, recipients()[1]!, recipients()[3]!,
    ];
    const deal = createHoleCardDealPlan(
      shuffled,
      { surfaceY: TABLE_HEIGHT, deckAnchor: DECK, rightHandRest: RIGHT_HAND_REST },
      { firstRecipientId: "player-4" },
    );
    const expectedCircuit = [
      "player-4", "player-5", "player-0", "player-1", "player-2", "player-3",
    ];

    expect(deal.recipientIdsClockwise).toEqual(expectedCircuit);
    expect(deal.assignments.map((card) => card.recipientId)).toEqual([
      ...expectedCircuit,
      ...expectedCircuit,
    ]);
    expect(deal.assignments.map((card) => card.cardIndex)).toEqual([
      0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1,
    ]);
    expect(deal.assignments.map((card) => card.circuit)).toEqual([
      1, 1, 1, 1, 1, 1,
      2, 2, 2, 2, 2, 2,
    ]);

    // `seatPoses` maps increasing relative seats to decreasing authored
    // station indices, which tableStations defines as physical clockwise.
    const stations = playerStations();
    for (let index = 1; index < recipients().length; index += 1) {
      const previousStation = stationIndexForRelativeSeat(index - 1, 2);
      const station = stationIndexForRelativeSeat(index, 2);
      expect(station).toBe((previousStation - 1 + PLAYER_STATION_COUNT) % PLAYER_STATION_COUNT);
      expect(recipients()[index]!.cardAnchor).toEqual(stations[station]!.feltPosition);
    }
  });

  it("uses one sequential slot per card and lands the full deal at two seconds", () => {
    const deal = plan();
    expect(deal.durationMs).toBe(HOLE_CARD_DEAL_DURATION_MS);
    expect(deal.assignments).toHaveLength(12);
    expect(deal.slotDurationMs).toBeCloseTo(HOLE_CARD_DEAL_DURATION_MS / 12, 10);
    expect(deal.assignments[0]!.startMs).toBe(0);
    expect(deal.assignments.at(-1)!.endMs).toBeCloseTo(HOLE_CARD_DEAL_DURATION_MS, 10);

    for (let index = 1; index < deal.assignments.length; index += 1) {
      expect(deal.assignments[index]!.startMs).toBeCloseTo(
        deal.assignments[index - 1]!.endMs,
        10,
      );
    }
  });

  it("keeps every visible card on the felt and never lets more than one card move or enter the right hand", () => {
    const deal = plan();
    for (let step = 0; step <= 2_000; step += 2) {
      const frame = sampleHoleCardDealAtMs(deal, step);
      const held = frame.cards.filter((card) => card.ownership === "dealer-right-hand");
      const moving = frame.cards.filter((card) => card.moving);
      expect(held.length).toBeLessThanOrEqual(1);
      expect(moving.length).toBeLessThanOrEqual(1);
      expect(frame.rightHand.holdingCard).toBe(held.length === 1);
      expect(frame.deck.owner).toBe("dealer-left-hand");
      expect(frame.leftHand.holdingDeck).toBe(true);
      expect(frame.leftHand.target).toEqual(DECK);
      for (const card of frame.cards.filter((candidate) => candidate.visible)) {
        expect(card.contact).toBe("felt");
        expect(card.position[1]).toBe(TABLE_HEIGHT);
        expect(card.position.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("keeps each card path and the returning right hand continuous at every phase and slot boundary", () => {
    const deal = plan();
    const epsilonMs = 0.0001;
    for (const assignment of deal.assignments) {
      for (const boundary of [assignment.startMs, assignment.arrivalMs, assignment.releaseMs, assignment.endMs]) {
        const before = sampleHoleCardDealAtMs(deal, Math.max(0, boundary - epsilonMs));
        const after = sampleHoleCardDealAtMs(deal, Math.min(deal.durationMs, boundary + epsilonMs));
        const beforeCard = before.cards[assignment.sequenceIndex]!;
        const afterCard = after.cards[assignment.sequenceIndex]!;
        expect(distance(beforeCard.position, afterCard.position)).toBeLessThan(0.0001);
        expect(distance(before.rightHand.target, after.rightHand.target)).toBeLessThan(0.0001);
      }
    }

    // A flat path is still a real traversal, not a destination visibility swap.
    const first = deal.assignments[0]!;
    const midpoint = sampleHoleCardDealAtMs(
      deal,
      first.startMs + deal.slotDurationMs * 0.42,
    ).cards[0]!;
    expect(distance(midpoint.position, DECK)).toBeGreaterThan(0.01);
    expect(distance(midpoint.position, first.target)).toBeGreaterThan(0.01);
  });

  it("makes each private card viewable immediately on its own arrival, never at deal start", () => {
    const deal = plan("player-0");
    const first = deal.assignments.find(
      (card) => card.recipientId === "player-0" && card.cardIndex === 0,
    )!;
    const second = deal.assignments.find(
      (card) => card.recipientId === "player-0" && card.cardIndex === 1,
    )!;

    const beforeFirstArrival = sampleHoleCardDealAtMs(deal, first.arrivalMs - 0.001);
    expect(beforeFirstArrival.cards[first.sequenceIndex]!.viewable).toBe(false);

    const atFirstArrival = sampleHoleCardDealAtMs(deal, first.arrivalMs);
    expect(atFirstArrival.cards[first.sequenceIndex]).toMatchObject({
      arrived: true,
      released: false,
      viewable: true,
    });
    expect(atFirstArrival.cards[second.sequenceIndex]!.viewable).toBe(false);

    const afterFirstRelease = sampleHoleCardDealAtMs(deal, first.releaseMs);
    expect(afterFirstRelease.cards[first.sequenceIndex]).toMatchObject({
      arrived: true,
      released: true,
      ownership: "recipient",
      viewable: true,
    });
    expect(afterFirstRelease.cards[second.sequenceIndex]!.viewable).toBe(false);

    const atSecondArrival = sampleHoleCardDealAtMs(deal, second.arrivalMs);
    expect(atSecondArrival.cards.filter(
      (card) => card.assignment.recipientId === "player-0" && card.viewable,
    )).toHaveLength(2);
  });

  it("places the pair symmetrically in each owner's lane at the authored 110 mm spacing", () => {
    const deal = plan();
    for (const recipient of recipients()) {
      const cards = deal.assignments.filter((card) => card.recipientId === recipient.id);
      expect(cards).toHaveLength(2);
      expect(distance(cards[0]!.target, cards[1]!.target)).toBeCloseTo(0.11, 10);
      const midpoint: DealPoint3 = [
        (cards[0]!.target[0] + cards[1]!.target[0]) / 2,
        (cards[0]!.target[1] + cards[1]!.target[1]) / 2,
        (cards[0]!.target[2] + cards[1]!.target[2]) / 2,
      ];
      expect(midpoint).toEqual(recipient.cardAnchor);
    }
  });

  it("clamps normalized and millisecond sampling without NaN or overshoot", () => {
    const deal = plan();
    expect(sampleHoleCardDeal(deal, -10)).toEqual(sampleHoleCardDeal(deal, Number.NaN));
    expect(sampleHoleCardDeal(deal, Number.NEGATIVE_INFINITY)).toEqual(sampleHoleCardDeal(deal, 0));
    expect(sampleHoleCardDeal(deal, Number.POSITIVE_INFINITY)).toEqual(sampleHoleCardDeal(deal, 1));
    expect(sampleHoleCardDealAtMs(deal, -1).elapsedMs).toBe(0);
    expect(sampleHoleCardDealAtMs(deal, 50_000).elapsedMs).toBe(deal.durationMs);
    expect(sampleHoleCardDeal(deal, 1)).toMatchObject({
      progress: 1,
      elapsedMs: HOLE_CARD_DEAL_DURATION_MS,
      phase: "complete",
      complete: true,
    });
    expect(sampleHoleCardDeal(deal, 1).cards.every(
      (card) => card.arrived && card.released && card.viewable,
    )).toBe(true);
  });

  it("de-duplicates malformed recipient input deterministically and handles an empty table", () => {
    const source = recipients().slice(0, 2);
    const duplicate = { ...source[0]!, clockwiseIndex: 99 };
    const left = createHoleCardDealPlan(
      [duplicate, ...source],
      { surfaceY: TABLE_HEIGHT, deckAnchor: DECK, rightHandRest: RIGHT_HAND_REST },
    );
    const right = createHoleCardDealPlan(
      [...source].reverse().concat(duplicate),
      { surfaceY: TABLE_HEIGHT, deckAnchor: DECK, rightHandRest: RIGHT_HAND_REST },
    );
    expect(left.assignments).toEqual(right.assignments);
    expect(left.assignments).toHaveLength(4);

    const empty = createHoleCardDealPlan(
      [],
      { surfaceY: TABLE_HEIGHT, deckAnchor: DECK, rightHandRest: RIGHT_HAND_REST },
    );
    expect(sampleHoleCardDeal(empty, 0)).toMatchObject({
      phase: "complete",
      complete: true,
      cards: [],
    });
  });
});
