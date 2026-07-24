import { describe, expect, it } from "vitest";
import {
  applyBettingAction,
  buildPots,
  cardKey,
  createBettingRound,
  createInformationSet,
  createSeededRandom,
  createShuffledDeck,
  getLegalActions,
  nextToAct,
  resolvePots,
  type BettingActionCommand,
  type BettingActionType,
  type BettingRoundState,
  type HandInformationSource,
} from "./index";
import {
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  createPokerTableSnapshot,
  createTournamentSession,
  progressTournamentSessionHand,
  type TournamentSession,
} from "../modes/tournamentSession";

const SOAK_SEEDS = Array.from(
  { length: 64 },
  (_, index) => `release-invariant-${index}`,
);

function chipTotal(state: BettingRoundState): number {
  return state.players.reduce(
    (total, player) => total + player.stack + player.totalCommitted,
    0,
  );
}

function commandsAdvertisedBy(
  legal: ReturnType<typeof getLegalActions>,
): BettingActionCommand[] {
  const commands: BettingActionCommand[] = [{ type: "fold" }];
  if (legal.check) commands.push({ type: "check" });
  if (legal.call) commands.push({ type: "call" });
  if (legal.bet) {
    commands.push({ type: "bet", to: legal.bet.min });
    if (legal.bet.max !== legal.bet.min) {
      commands.push({ type: "bet", to: legal.bet.max });
    }
  }
  if (legal.raise) {
    commands.push({ type: "raise", to: legal.raise.minTo });
    if (legal.raise.maxTo !== legal.raise.minTo) {
      commands.push({ type: "raise", to: legal.raise.maxTo });
    }
  }
  if (legal.allIn) commands.push({ type: "all-in" });
  return commands;
}

function unsupportedCommand(
  type: BettingActionType,
  state: BettingRoundState,
): BettingActionCommand {
  if (type === "bet") return { type, to: state.minimumBet };
  if (type === "raise") {
    return { type, to: state.currentBet + state.lastFullRaise };
  }
  return { type };
}

function createSession(seed: string): TournamentSession {
  return createTournamentSession({
    eventId: "local-qualifier",
    hero: {
      id: "hero",
      name: "Player",
      rating: 1_000,
      normalProfile: "tempo",
    },
    mode: "normal",
    seed,
  });
}

describe("release invariant soak", () => {
  it("keeps every seeded deck unique and reproducible", () => {
    for (const seed of SOAK_SEEDS) {
      const deck = createShuffledDeck(seed);
      expect(deck).toHaveLength(52);
      expect(new Set(deck.map(cardKey)).size).toBe(52);
      expect(createShuffledDeck(seed)).toEqual(deck);
    }
  });

  it("conserves chips through generated side pots, refunds, and awards", () => {
    let sidePotCases = 0;
    let refundCases = 0;

    for (const seed of SOAK_SEEDS) {
      const random = createSeededRandom(seed);
      const otherAmounts = Array.from(
        { length: 5 },
        () => 1 + Math.floor(random() * 500),
      );
      const leaderAmount = Math.max(...otherAmounts) + 1 + Math.floor(random() * 50);
      const contributions = [leaderAmount, ...otherAmounts].map(
        (amount, index) => ({
          playerId: `p${index}`,
          amount,
          folded: index > 0 && random() < 0.35,
        }),
      );
      const built = buildPots(contributions);
      const potTotal = built.pots.reduce((sum, pot) => sum + pot.amount, 0);
      const refundTotal = built.refunds.reduce(
        (sum, refund) => sum + refund.amount,
        0,
      );

      expect(potTotal + refundTotal).toBe(built.totalContributed);
      expect(built.totalContributed).toBe(
        contributions.reduce((sum, contribution) => sum + contribution.amount, 0),
      );
      if (built.pots.some((pot) => pot.kind === "side")) sidePotCases += 1;
      if (built.refunds.length > 0) refundCases += 1;

      const deck = createShuffledDeck(`${seed}:showdown`);
      const holeCards = Object.fromEntries(
        contributions.map((contribution, index) => [
          contribution.playerId,
          deck.slice(index * 2, index * 2 + 2),
        ]),
      );
      const resolved = resolvePots(built.pots, {
        board: deck.slice(12, 17),
        holeCards,
        seats: Object.fromEntries(
          contributions.map((contribution, index) => [
            contribution.playerId,
            index + 1,
          ]),
        ),
        buttonSeat: 1,
        tableSize: 6,
      });
      expect(
        resolved.awards.reduce((sum, award) => sum + award.amount, 0),
      ).toBe(potTotal);
    }

    expect(sidePotCases).toBe(SOAK_SEEDS.length);
    expect(refundCases).toBe(SOAK_SEEDS.length);
  });

  it("applies every advertised betting action, rejects unadvertised actions, and conserves chips", () => {
    const observed = new Set<BettingActionType>();
    const actionTypes: BettingActionType[] = [
      "fold",
      "check",
      "call",
      "bet",
      "raise",
      "all-in",
    ];

    SOAK_SEEDS.forEach((seed, seedIndex) => {
      const random = createSeededRandom(seed);
      let state = createBettingRound(
        Array.from({ length: 4 }, (_, index) => ({
          id: `p${index}`,
          stack: 300 + Math.floor(random() * 1_700),
          streetCommitted: 0,
          totalCommitted: 0,
          status: "active" as const,
        })),
        ["p0", "p1", "p2", "p3"],
        { minimumBet: 50 },
      );
      const initialTotal = chipTotal(state);

      for (let step = 0; !state.complete && step < 40; step += 1) {
        const actor = nextToAct(state);
        if (!actor) throw new Error("An incomplete round must have an actor");
        const legal = getLegalActions(state, actor);
        const advertised = commandsAdvertisedBy(legal);
        const sourceSnapshot = structuredClone(state);

        for (const command of advertised) {
          observed.add(command.type);
          const result = applyBettingAction(state, actor, command);
          expect(chipTotal(result.state)).toBe(initialTotal);
          expect(result.event.type).toBe(command.type);
          expect(state).toEqual(sourceSnapshot);
        }

        const advertisedTypes = new Set(advertised.map((command) => command.type));
        for (const type of actionTypes) {
          if (advertisedTypes.has(type)) continue;
          expect(() =>
            applyBettingAction(state, actor, unsupportedCommand(type, state)),
          ).toThrow();
          expect(state).toEqual(sourceSnapshot);
        }

        const selected = advertised[(seedIndex + step) % advertised.length];
        state = applyBettingAction(state, actor, selected).state;
        expect(chipTotal(state)).toBe(initialTotal);
      }

      expect(state.complete).toBe(true);
    });

    expect([...observed].sort()).toEqual([...actionTypes].sort());
  });

  it("replays identical tournament commands deterministically for equal seeds", () => {
    for (const seed of SOAK_SEEDS.slice(0, 16)) {
      let first = beginTournamentSessionHand(createSession(seed));
      let replay = beginTournamentSessionHand(createSession(seed));
      let firstAction = true;
      const initialChips =
        first.tournament.players.reduce(
          (sum, player) => sum + player.stack,
          0,
        ) + (first.activeHand?.information.pot ?? 0);

      while (first.activeHand && !first.activeHand.betting.complete) {
        const actor = nextToAct(first.activeHand.betting);
        const replayActor = replay.activeHand
          ? nextToAct(replay.activeHand.betting)
          : null;
        expect(replayActor).toBe(actor);
        if (!actor) throw new Error("Expected an actor during replay");
        const legal = getLegalActions(first.activeHand.betting, actor);
        const command: BettingActionCommand = firstAction
          ? { type: "all-in" }
          : legal.call
            ? { type: "call" }
            : legal.allIn
              ? { type: "all-in" }
              : { type: "check" };
        firstAction = false;
        first = applyTournamentSessionAction(first, actor, command);
        replay = applyTournamentSessionAction(replay, actor, command);
        expect(replay).toEqual(first);
      }

      while (first.activeHand) {
        first = progressTournamentSessionHand(first);
        replay = progressTournamentSessionHand(replay);
        expect(replay).toEqual(first);
      }
      expect(first.status).toBe("complete");
      expect(
        first.tournament.players.reduce(
          (sum, player) => sum + player.stack,
          0,
        ),
      ).toBe(initialChips);
    }
  });

  it("redacts hidden cards and is invariant to all server-only card state", () => {
    for (const seed of SOAK_SEEDS.slice(0, 24)) {
      const session = beginTournamentSessionHand(createSession(seed));
      const hand = session.activeHand;
      if (!hand) throw new Error("Expected an active hand");
      const replacementDeck = createShuffledDeck(`${seed}:replacement`);
      const source: HandInformationSource = {
        ...hand.information,
        deck: hand.deck,
        burnCards: hand.deck.slice(hand.deckCursor, hand.deckCursor + 3),
        seed,
      };
      const changed: HandInformationSource = {
        ...source,
        players: source.players.map((player, index) =>
          player.id === session.heroId
            ? player
            : {
                ...player,
                holeCards: replacementDeck.slice(index * 2, index * 2 + 2),
              },
        ),
        deck: [...replacementDeck].reverse(),
        burnCards: replacementDeck.slice(40, 43),
        seed: `${seed}:different-secret`,
      };
      const view = createInformationSet(source, session.heroId);
      const changedView = createInformationSet(changed, session.heroId);

      expect(changedView).toEqual(view);
      expect(view).not.toHaveProperty("deck");
      expect(view).not.toHaveProperty("burnCards");
      expect(view).not.toHaveProperty("seed");
      expect(
        view.players
          .filter((player) => player.id !== session.heroId)
          .every((player) => player.holeCards === undefined),
      ).toBe(true);

      const changedSession: TournamentSession = {
        ...session,
        activeHand: {
          ...hand,
          information: changed,
        },
      };
      expect(createPokerTableSnapshot(changedSession)).toEqual(
        createPokerTableSnapshot(session),
      );
      expect(
        createPokerTableSnapshot(session).players
          .filter((player) => player.id !== session.heroId)
          .every((player) => player.cards === undefined),
      ).toBe(true);
    }
  });
});
