"use strict";
(() => {
  // src/engine/betting.ts
  function assertChipAmount(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }
  function cloneState(state) {
    return {
      ...state,
      players: state.players.map((player) => ({ ...player })),
      actionOrder: [...state.actionOrder],
      pending: [...state.pending],
      lastActedAtBet: { ...state.lastActedAtBet }
    };
  }
  function clockwiseAfter(order, playerId) {
    const index = order.indexOf(playerId);
    if (index < 0) throw new Error(`Player ${playerId} is not in action order`);
    return [
      ...order.slice(index + 1),
      ...order.slice(0, index + 1)
    ];
  }
  function livePlayers(state) {
    return state.players.filter((player) => player.status !== "folded");
  }
  function activePlayers(state) {
    return state.players.filter(
      (player) => player.status === "active" && player.stack > 0
    );
  }
  function raisingReopenedFor(state, playerId) {
    const lastBetFaced = state.lastActedAtBet[playerId];
    if (lastBetFaced === void 0) return true;
    return state.currentBet - lastBetFaced >= state.lastFullRaise;
  }
  function recomputePending(state, afterPlayerId) {
    if (livePlayers(state).length <= 1) {
      state.pending = [];
      state.complete = true;
      state.handComplete = true;
      return;
    }
    const active = activePlayers(state);
    if (active.length === 0) {
      state.pending = [];
      state.complete = true;
      return;
    }
    const candidates = afterPlayerId ? clockwiseAfter(state.actionOrder, afterPlayerId) : state.actionOrder;
    let pending = candidates.filter((playerId) => {
      const player = state.players.find((entry) => entry.id === playerId);
      if (!player || player.status !== "active" || player.stack <= 0) return false;
      return state.lastActedAtBet[playerId] === void 0 || player.streetCommitted < state.currentBet;
    });
    if (active.length === 1 && active[0].streetCommitted >= state.currentBet) {
      pending = [];
    }
    state.pending = pending;
    state.complete = pending.length === 0;
    state.handComplete = false;
  }
  function createBettingRound(players, actionOrder, options) {
    var _a, _b, _c;
    assertChipAmount(options.minimumBet, "Minimum bet");
    if (options.minimumBet === 0) throw new Error("Minimum bet must be positive");
    const ids = players.map((player) => player.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Betting player IDs must be unique");
    }
    if (actionOrder.length !== ids.length || new Set(actionOrder).size !== actionOrder.length || actionOrder.some((id) => !ids.includes(id))) {
      throw new Error("Action order must contain every player exactly once");
    }
    const normalizedPlayers = players.map((player) => {
      assertChipAmount(player.stack, `Stack for ${player.id}`);
      assertChipAmount(
        player.streetCommitted,
        `Street contribution for ${player.id}`
      );
      assertChipAmount(
        player.totalCommitted,
        `Total contribution for ${player.id}`
      );
      return {
        ...player,
        status: player.stack === 0 && player.status === "active" ? "all-in" : player.status
      };
    });
    const postedMaximum = Math.max(
      0,
      ...normalizedPlayers.map((player) => player.streetCommitted)
    );
    const currentBet = Math.max(
      postedMaximum,
      (_a = options.nominalOpeningBet) != null ? _a : 0,
      (_b = options.currentBet) != null ? _b : 0
    );
    const state = {
      players: normalizedPlayers,
      actionOrder: [...actionOrder],
      pending: [],
      currentBet,
      minimumBet: options.minimumBet,
      lastFullRaise: (_c = options.lastFullRaise) != null ? _c : options.minimumBet,
      lastActedAtBet: {},
      complete: false,
      handComplete: false
    };
    recomputePending(state);
    return state;
  }
  function nextToAct(state) {
    var _a;
    return (_a = state.pending[0]) != null ? _a : null;
  }
  function getLegalActions(state, playerId) {
    if (state.complete) throw new Error("Betting round is complete");
    if (nextToAct(state) !== playerId) {
      throw new Error(`It is not ${playerId}'s turn`);
    }
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== "active" || player.stack <= 0) {
      throw new Error(`Player ${playerId} cannot act`);
    }
    const toCall = Math.max(0, state.currentBet - player.streetCommitted);
    const allInTo = player.streetCommitted + player.stack;
    const reopened = raisingReopenedFor(state, playerId);
    const maxTo = allInTo;
    const minRaiseTo = state.currentBet + state.lastFullRaise;
    const canIncreaseBet = reopened && maxTo > state.currentBet;
    return {
      playerId,
      toCall,
      check: toCall === 0,
      fold: true,
      call: toCall > 0,
      callAmount: Math.min(player.stack, toCall),
      bet: state.currentBet === 0 && maxTo >= state.minimumBet ? { min: state.minimumBet, max: maxTo } : void 0,
      raise: state.currentBet > 0 && canIncreaseBet && maxTo >= minRaiseTo ? { minTo: minRaiseTo, maxTo } : void 0,
      allIn: maxTo <= state.currentBet || state.currentBet === 0 || canIncreaseBet,
      allInTo,
      raisingReopened: reopened
    };
  }
  function requireTarget(command, minimum, maximum) {
    if (command.to === void 0) {
      throw new Error(`${command.type} requires a total target`);
    }
    assertChipAmount(command.to, `${command.type} target`);
    if (command.to < minimum || command.to > maximum) {
      throw new Error(
        `${command.type} target must be between ${minimum} and ${maximum}`
      );
    }
    return command.to;
  }
  function applyBettingAction(source, playerId, command) {
    const legal = getLegalActions(source, playerId);
    const state = cloneState(source);
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) throw new Error(`Unknown player ${playerId}`);
    const previousBet = state.currentBet;
    let target = player.streetCommitted;
    let fullRaise = false;
    let shortAllIn = false;
    switch (command.type) {
      case "fold":
        if (!legal.fold) throw new Error("Fold is not legal");
        player.status = "folded";
        break;
      case "check":
        if (!legal.check) throw new Error("Check is not legal");
        break;
      case "call":
        if (!legal.call) throw new Error("Call is not legal");
        target = player.streetCommitted + legal.callAmount;
        break;
      case "bet":
        if (!legal.bet) throw new Error("Bet is not legal");
        target = requireTarget(command, legal.bet.min, legal.bet.max);
        break;
      case "raise":
        if (!legal.raise) throw new Error("Raise is not legal");
        target = requireTarget(command, legal.raise.minTo, legal.raise.maxTo);
        break;
      case "all-in":
        if (!legal.allIn) throw new Error("All-in is not legal");
        target = legal.allInTo;
        break;
      default:
        throw new Error("Unsupported betting action");
    }
    const committed = target - player.streetCommitted;
    if (committed < 0 || committed > player.stack) {
      throw new Error("Action commits an invalid chip amount");
    }
    player.stack -= committed;
    player.streetCommitted = target;
    player.totalCommitted += committed;
    if (target > previousBet) {
      const raiseIncrement = target - previousBet;
      const requiredIncrement = previousBet === 0 ? state.minimumBet : state.lastFullRaise;
      fullRaise = raiseIncrement >= requiredIncrement;
      shortAllIn = !fullRaise && command.type === "all-in";
      if (!fullRaise && command.type !== "all-in") {
        throw new Error("Only an all-in may be smaller than a full bet or raise");
      }
      state.currentBet = target;
      if (fullRaise) state.lastFullRaise = raiseIncrement;
      state.lastAggressorId = playerId;
    }
    if (player.stack === 0 && player.status === "active") {
      player.status = "all-in";
    }
    state.lastActedAtBet[playerId] = state.currentBet;
    recomputePending(state, playerId);
    return {
      state,
      event: {
        playerId,
        type: command.type,
        committed,
        to: target,
        previousBet,
        currentBet: state.currentBet,
        fullRaise,
        shortAllIn,
        allIn: player.status === "all-in"
      }
    };
  }

  // src/engine/deck.ts
  var SUITS = [
    "clubs",
    "diamonds",
    "hearts",
    "spades"
  ];
  var RANKS = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "T",
    "J",
    "Q",
    "K",
    "A"
  ];
  function hashSeed(seed) {
    const input = String(seed);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function createSeededRandom(seed) {
    let state = hashSeed(seed);
    return () => {
      state = state + 1831565813 >>> 0;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function deriveSeed(base, ...parts) {
    return [String(base), ...parts.map(String)].join(":");
  }
  function createDeck() {
    return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  }
  function cardKey(card) {
    return `${card.rank}:${card.suit}`;
  }
  function assertUniqueCards(cards) {
    const keys = new Set(cards.map(cardKey));
    if (keys.size !== cards.length) {
      throw new Error("Duplicate card detected");
    }
  }
  function shuffleDeck(cards, seedOrRandom) {
    assertUniqueCards(cards);
    const shuffled = cards.map((card) => ({ ...card }));
    const random = typeof seedOrRandom === "function" ? seedOrRandom : createSeededRandom(seedOrRandom);
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex],
        shuffled[index]
      ];
    }
    return shuffled;
  }
  function createShuffledDeck(seed) {
    return shuffleDeck(createDeck(), seed);
  }
  function drawCards(deck, cursor, count) {
    if (!Number.isInteger(cursor) || cursor < 0) {
      throw new Error("Deck cursor must be a non-negative integer");
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("Draw count must be a non-negative integer");
    }
    if (cursor + count > deck.length) {
      throw new Error("Cannot draw beyond the end of the deck");
    }
    return {
      cards: deck.slice(cursor, cursor + count).map((card) => ({ ...card })),
      cursor: cursor + count
    };
  }
  function dealRoundRobin(deck, cursor, playerOrder, cardsPerHand) {
    if (new Set(playerOrder).size !== playerOrder.length) {
      throw new Error("Deal order may not contain duplicate players");
    }
    if (!Number.isInteger(cardsPerHand) || cardsPerHand < 0) {
      throw new Error("Cards per hand must be a non-negative integer");
    }
    const draw = drawCards(
      deck,
      cursor,
      playerOrder.length * cardsPerHand
    );
    const hands = Object.fromEntries(
      playerOrder.map((playerId) => [playerId, []])
    );
    let cardIndex = 0;
    for (let round = 0; round < cardsPerHand; round += 1) {
      for (const playerId of playerOrder) {
        hands[playerId].push(draw.cards[cardIndex]);
        cardIndex += 1;
      }
    }
    return { ...draw, hands };
  }

  // src/engine/evaluator.ts
  var HAND_CATEGORY = {
    HIGH_CARD: 0,
    ONE_PAIR: 1,
    TWO_PAIR: 2,
    THREE_OF_A_KIND: 3,
    STRAIGHT: 4,
    FLUSH: 5,
    FULL_HOUSE: 6,
    FOUR_OF_A_KIND: 7,
    STRAIGHT_FLUSH: 8
  };
  var RANK_VALUE = {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14
  };
  var CATEGORY_NAMES = {
    [HAND_CATEGORY.HIGH_CARD]: "high-card",
    [HAND_CATEGORY.ONE_PAIR]: "one-pair",
    [HAND_CATEGORY.TWO_PAIR]: "two-pair",
    [HAND_CATEGORY.THREE_OF_A_KIND]: "three-of-a-kind",
    [HAND_CATEGORY.STRAIGHT]: "straight",
    [HAND_CATEGORY.FLUSH]: "flush",
    [HAND_CATEGORY.FULL_HOUSE]: "full-house",
    [HAND_CATEGORY.FOUR_OF_A_KIND]: "four-of-a-kind",
    [HAND_CATEGORY.STRAIGHT_FLUSH]: "straight-flush"
  };
  var DISPLAY_NAMES = {
    [HAND_CATEGORY.HIGH_CARD]: "High Card",
    [HAND_CATEGORY.ONE_PAIR]: "One Pair",
    [HAND_CATEGORY.TWO_PAIR]: "Two Pair",
    [HAND_CATEGORY.THREE_OF_A_KIND]: "Three of a Kind",
    [HAND_CATEGORY.STRAIGHT]: "Straight",
    [HAND_CATEGORY.FLUSH]: "Flush",
    [HAND_CATEGORY.FULL_HOUSE]: "Full House",
    [HAND_CATEGORY.FOUR_OF_A_KIND]: "Four of a Kind",
    [HAND_CATEGORY.STRAIGHT_FLUSH]: "Straight Flush"
  };
  function rankValue(card) {
    return RANK_VALUE[card.rank];
  }
  function compareNumberArrays(left, right) {
    var _a, _b;
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const difference = ((_a = left[index]) != null ? _a : 0) - ((_b = right[index]) != null ? _b : 0);
      if (difference !== 0) return Math.sign(difference);
    }
    return 0;
  }
  function straightHigh(values) {
    const unique = [...new Set(values)].sort((a, b) => b - a);
    if (unique.includes(14)) unique.push(1);
    for (let index = 0; index <= unique.length - 5; index += 1) {
      const start = unique[index];
      if (unique[index + 1] === start - 1 && unique[index + 2] === start - 2 && unique[index + 3] === start - 3 && unique[index + 4] === start - 4) {
        return start;
      }
    }
    return null;
  }
  function makeValue(category, tiebreak, cards) {
    const royal = category === HAND_CATEGORY.STRAIGHT_FLUSH && tiebreak[0] === 14;
    return {
      category,
      categoryName: CATEGORY_NAMES[category],
      displayName: royal ? "Royal Flush" : DISPLAY_NAMES[category],
      tiebreak,
      cards: cards.map((card) => ({ ...card }))
    };
  }
  function evaluateFive(cards) {
    var _a, _b, _c;
    if (cards.length !== 5) {
      throw new Error("evaluateFive requires exactly five cards");
    }
    assertUniqueCards(cards);
    const values = cards.map(rankValue).sort((a, b) => b - a);
    const flush = cards.every((card) => card.suit === cards[0].suit);
    const highStraight = straightHigh(values);
    if (flush && highStraight !== null) {
      return makeValue(HAND_CATEGORY.STRAIGHT_FLUSH, [highStraight], cards);
    }
    const counts = /* @__PURE__ */ new Map();
    for (const value of values) counts.set(value, ((_a = counts.get(value)) != null ? _a : 0) + 1);
    const groups = [...counts.entries()].sort(
      ([leftRank, leftCount], [rightRank, rightCount]) => rightCount - leftCount || rightRank - leftRank
    );
    if (groups[0][1] === 4) {
      return makeValue(
        HAND_CATEGORY.FOUR_OF_A_KIND,
        [groups[0][0], groups[1][0]],
        cards
      );
    }
    if (groups[0][1] === 3 && groups[1][1] === 2) {
      return makeValue(
        HAND_CATEGORY.FULL_HOUSE,
        [groups[0][0], groups[1][0]],
        cards
      );
    }
    if (flush) {
      return makeValue(HAND_CATEGORY.FLUSH, values, cards);
    }
    if (highStraight !== null) {
      return makeValue(HAND_CATEGORY.STRAIGHT, [highStraight], cards);
    }
    if (groups[0][1] === 3) {
      const kickers = groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a);
      return makeValue(
        HAND_CATEGORY.THREE_OF_A_KIND,
        [groups[0][0], ...kickers],
        cards
      );
    }
    const pairs = groups.filter(([, count]) => count === 2).map(([rank]) => rank).sort((a, b) => b - a);
    if (pairs.length === 2) {
      const kicker = (_c = (_b = groups.find(([, count]) => count === 1)) == null ? void 0 : _b[0]) != null ? _c : 0;
      return makeValue(
        HAND_CATEGORY.TWO_PAIR,
        [pairs[0], pairs[1], kicker],
        cards
      );
    }
    if (pairs.length === 1) {
      const kickers = groups.filter(([, count]) => count === 1).map(([rank]) => rank).sort((a, b) => b - a);
      return makeValue(
        HAND_CATEGORY.ONE_PAIR,
        [pairs[0], ...kickers],
        cards
      );
    }
    return makeValue(HAND_CATEGORY.HIGH_CARD, values, cards);
  }
  function combinations(items, size) {
    const output = [];
    function visit(start, selected) {
      if (selected.length === size) {
        output.push([...selected]);
        return;
      }
      for (let index = start; index <= items.length - (size - selected.length); index += 1) {
        selected.push(items[index]);
        visit(index + 1, selected);
        selected.pop();
      }
    }
    visit(0, []);
    return output;
  }
  function compareHandValues(left, right) {
    if (left.category !== right.category) {
      return Math.sign(left.category - right.category);
    }
    return compareNumberArrays(left.tiebreak, right.tiebreak);
  }
  function evaluateBestHand(cards) {
    if (cards.length < 5 || cards.length > 7) {
      throw new Error("A poker hand evaluator requires five to seven cards");
    }
    assertUniqueCards(cards);
    let best = null;
    for (const candidate of combinations(cards, 5)) {
      const value = evaluateFive(candidate);
      if (best === null || compareHandValues(value, best) > 0) {
        best = value;
      }
    }
    if (best === null) throw new Error("Unable to evaluate hand");
    return best;
  }

  // src/engine/pots.ts
  function assertAmount(amount, label) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }
  function buildPots(contributions) {
    var _a;
    const ids = contributions.map((entry) => entry.playerId);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Each player may appear only once in the contribution ledger");
    }
    for (const contribution of contributions) {
      assertAmount(contribution.amount, `Contribution for ${contribution.playerId}`);
    }
    const positive = contributions.filter((entry) => entry.amount > 0);
    const levels = [...new Set(positive.map((entry) => entry.amount))].sort(
      (left, right) => left - right
    );
    const pots = [];
    const refundMap = /* @__PURE__ */ new Map();
    let previousCap = 0;
    for (const cap of levels) {
      const contributors = positive.filter((entry) => entry.amount >= cap);
      const amount = (cap - previousCap) * contributors.length;
      previousCap = cap;
      if (contributors.length === 1) {
        const playerId = contributors[0].playerId;
        refundMap.set(playerId, ((_a = refundMap.get(playerId)) != null ? _a : 0) + amount);
        continue;
      }
      const eligiblePlayerIds = contributors.filter((entry) => !entry.folded).map((entry) => entry.playerId);
      if (eligiblePlayerIds.length === 0) {
        throw new Error("A contested contribution layer has no eligible winner");
      }
      pots.push({
        id: pots.length === 0 ? "main" : `side-${pots.length}`,
        kind: pots.length === 0 ? "main" : "side",
        amount,
        cap,
        contributorIds: contributors.map((entry) => entry.playerId),
        eligiblePlayerIds
      });
    }
    return {
      pots,
      refunds: [...refundMap.entries()].map(([playerId, amount]) => ({
        playerId,
        amount
      })),
      totalContributed: contributions.reduce(
        (sum, contribution) => sum + contribution.amount,
        0
      )
    };
  }
  function clockwiseDistance(seat, buttonSeat, tableSize) {
    const distance = (seat - buttonSeat + tableSize) % tableSize;
    return distance === 0 ? tableSize : distance;
  }
  function orderWinnersForOddChips(playerIds, seats, buttonSeat, tableSize) {
    return [...playerIds].sort((left, right) => {
      const leftSeat = seats[left];
      const rightSeat = seats[right];
      if (leftSeat === void 0 || rightSeat === void 0) {
        throw new Error("Every pot-eligible player requires a seat");
      }
      return clockwiseDistance(leftSeat, buttonSeat, tableSize) - clockwiseDistance(rightSeat, buttonSeat, tableSize);
    });
  }
  function resolvePots(pots, options) {
    var _a;
    const smallestChip = (_a = options.smallestChip) != null ? _a : 1;
    assertAmount(smallestChip, "Smallest chip");
    if (smallestChip === 0) throw new Error("Smallest chip must be positive");
    if (!Number.isSafeInteger(options.tableSize) || options.tableSize < 2) {
      throw new Error("Table size must be an integer of at least two");
    }
    const evaluatedHands = {};
    const awards = [];
    for (const pot of pots) {
      assertAmount(pot.amount, `Amount for pot ${pot.id}`);
      if (pot.eligiblePlayerIds.length === 0) {
        throw new Error(`Pot ${pot.id} has no eligible players`);
      }
      let winners;
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
              ...options.board
            ]);
          }
        }
        const bestPlayer = pot.eligiblePlayerIds.reduce(
          (best, candidate) => compareHandValues(
            evaluatedHands[candidate],
            evaluatedHands[best]
          ) > 0 ? candidate : best
        );
        winners = pot.eligiblePlayerIds.filter(
          (playerId) => compareHandValues(
            evaluatedHands[playerId],
            evaluatedHands[bestPlayer]
          ) === 0
        );
      }
      const ordered = orderWinnersForOddChips(
        winners,
        options.seats,
        options.buttonSeat,
        options.tableSize
      );
      const share = Math.floor(pot.amount / winners.length / smallestChip) * smallestChip;
      let remainder = pot.amount - share * winners.length;
      for (const playerId of winners) {
        awards.push({
          potId: pot.id,
          playerId,
          amount: share,
          hand: evaluatedHands[playerId]
        });
      }
      let oddIndex = 0;
      while (remainder >= smallestChip) {
        const playerId = ordered[oddIndex % ordered.length];
        const award = awards.find(
          (entry) => entry.potId === pot.id && entry.playerId === playerId
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

  // src/engine/tournament.ts
  var MAIN_EVENT_BLINDS = [
    [100, 200, 200],
    [200, 300, 300],
    [200, 400, 400],
    [300, 500, 500],
    [300, 600, 600],
    [400, 800, 800],
    [500, 1e3, 1e3],
    [600, 1200, 1200],
    [1e3, 1500, 1500],
    [1e3, 2e3, 2e3],
    [1e3, 2500, 2500],
    [1500, 3e3, 3e3],
    [2e3, 4e3, 4e3],
    [3e3, 5e3, 5e3],
    [3e3, 6e3, 6e3],
    [4e3, 8e3, 8e3],
    [5e3, 1e4, 1e4],
    [6e3, 12e3, 12e3],
    [1e4, 15e3, 15e3],
    [1e4, 2e4, 2e4],
    [1e4, 25e3, 25e3],
    [15e3, 3e4, 3e4],
    [2e4, 4e4, 4e4],
    [25e3, 5e4, 5e4],
    [3e4, 6e4, 6e4],
    [4e4, 8e4, 8e4],
    [5e4, 1e5, 1e5],
    [6e4, 12e4, 12e4],
    [1e5, 15e4, 15e4],
    [1e5, 2e5, 2e5],
    [125e3, 25e4, 25e4],
    [15e4, 3e5, 3e5],
    [2e5, 4e5, 4e5],
    [25e4, 5e5, 5e5],
    [3e5, 6e5, 6e5],
    [4e5, 8e5, 8e5],
    [5e5, 1e6, 1e6],
    [6e5, 12e5, 12e5],
    [8e5, 16e5, 16e5],
    [1e6, 2e6, 2e6],
    [125e4, 25e5, 25e5],
    [15e5, 3e6, 3e6],
    [2e6, 4e6, 4e6],
    [25e5, 5e6, 5e6],
    [3e6, 6e6, 6e6],
    [4e6, 8e6, 8e6],
    [5e6, 1e7, 1e7]
  ];
  function makeMainEventLevels(durationMs) {
    return MAIN_EVENT_BLINDS.map(([smallBlind, bigBlind, bigBlindAnte], index) => ({
      level: index + 1,
      smallBlind,
      bigBlind,
      bigBlindAnte,
      durationMs
    }));
  }
  var AUTHENTIC_MAIN_EVENT_STRUCTURE = {
    id: "main-event-authentic",
    name: "World Championship — Authentic",
    startingStack: 6e4,
    maxSeats: 9,
    levels: makeMainEventLevels(120 * 6e4),
    rated: true
  };
  var CAREER_MAIN_EVENT_STRUCTURE = {
    id: "main-event-career",
    name: "World Championship — Career",
    startingStack: 6e4,
    maxSeats: 9,
    levels: makeMainEventLevels(8 * 6e4),
    rated: true
  };
  var QUICK_MAIN_EVENT_STRUCTURE = {
    id: "main-event-quick",
    name: "World Championship — Quick",
    startingStack: 6e4,
    maxSeats: 9,
    levels: makeMainEventLevels(3 * 6e4),
    rated: false
  };
  function scaledStructure(id, name, startingStack, durationMinutes) {
    const scale = startingStack / 6e4;
    return {
      id,
      name,
      startingStack,
      maxSeats: 9,
      rated: true,
      levels: MAIN_EVENT_BLINDS.slice(0, 24).map(
        ([smallBlind, bigBlind, bigBlindAnte], index) => ({
          level: index + 1,
          smallBlind: Math.max(25, Math.round(smallBlind * scale / 25) * 25),
          bigBlind: Math.max(50, Math.round(bigBlind * scale / 25) * 25),
          bigBlindAnte: Math.max(
            50,
            Math.round(bigBlindAnte * scale / 25) * 25
          ),
          durationMs: durationMinutes * 6e4
        })
      )
    };
  }
  var CAREER_EVENTS = [
    {
      id: "local-qualifier",
      name: "Local Qualifier",
      tier: "local",
      fieldSize: 27,
      structure: scaledStructure(
        "local-qualifier-structure",
        "Local Qualifier",
        15e3,
        4
      ),
      prerequisites: [],
      qualification: { type: "top-count", value: 9 },
      unlocks: ["regional-open"],
      ratingWeight: 0.75
    },
    {
      id: "regional-open",
      name: "Regional Open",
      tier: "regional",
      fieldSize: 54,
      structure: scaledStructure(
        "regional-open-structure",
        "Regional Open",
        25e3,
        5
      ),
      prerequisites: ["local-qualifier"],
      qualification: { type: "top-percent", value: 0.15 },
      unlocks: ["circuit-main"],
      ratingWeight: 0.9
    },
    {
      id: "circuit-main",
      name: "Circuit Main Event",
      tier: "circuit",
      fieldSize: 90,
      structure: scaledStructure(
        "circuit-main-structure",
        "Circuit Main Event",
        4e4,
        6
      ),
      prerequisites: ["regional-open"],
      qualification: { type: "top-count", value: 9 },
      unlocks: ["national-championship"],
      ratingWeight: 1
    },
    {
      id: "national-championship",
      name: "National Championship",
      tier: "championship",
      fieldSize: 180,
      structure: CAREER_MAIN_EVENT_STRUCTURE,
      prerequisites: ["circuit-main"],
      qualification: { type: "top-percent", value: 0.05 },
      unlocks: ["world-championship"],
      ratingWeight: 1.15
    },
    {
      id: "world-championship",
      name: "World Championship",
      tier: "world",
      fieldSize: 360,
      structure: CAREER_MAIN_EVENT_STRUCTURE,
      prerequisites: ["national-championship"],
      qualification: { type: "win", value: 1 },
      unlocks: [],
      ratingWeight: 1.25
    }
  ];
  function currentBlindLevel(state) {
    return state.structure.levels[state.levelIndex];
  }
  function advanceTournamentClock(source, elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error("Elapsed time must be non-negative");
    }
    const state = {
      ...source,
      players: source.players.map((player) => ({ ...player })),
      tables: source.tables.map((table) => ({ ...table })),
      levelElapsedMs: source.levelElapsedMs + elapsedMs,
      totalElapsedMs: source.totalElapsedMs + elapsedMs
    };
    while (state.levelIndex < state.structure.levels.length - 1 && state.levelElapsedMs >= currentBlindLevel(state).durationMs) {
      state.levelElapsedMs -= currentBlindLevel(state).durationMs;
      state.levelIndex += 1;
    }
    return state;
  }
  function randomSeatOrder(count, seed) {
    return shuffleValues(
      Array.from({ length: count }, (_, index) => index),
      seed
    );
  }
  function shuffleValues(values, seed) {
    const random = createSeededRandom(seed);
    const output = [...values];
    for (let index = output.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [output[index], output[swapIndex]] = [
        output[swapIndex],
        output[index]
      ];
    }
    return output;
  }
  function createTournament(id, structure, entrants, seed) {
    if (entrants.length < 2) throw new Error("A tournament needs at least two entrants");
    if (new Set(entrants.map((entrant) => entrant.id)).size !== entrants.length) {
      throw new Error("Tournament entrant IDs must be unique");
    }
    if (structure.levels.length === 0) {
      throw new Error("Tournament structure requires at least one blind level");
    }
    const tableCount = Math.ceil(entrants.length / structure.maxSeats);
    const tables = Array.from(
      { length: tableCount },
      (_, index) => ({
        id: `table-${index + 1}`,
        maxSeats: structure.maxSeats,
        buttonSeat: 1,
        handNumber: 0,
        status: "playing"
      })
    );
    const shuffledEntrants = shuffleValues(
      entrants,
      deriveSeed(seed, "seating")
    );
    const seatOrders = Object.fromEntries(
      tables.map((table) => [
        table.id,
        randomSeatOrder(
          structure.maxSeats,
          deriveSeed(seed, table.id, "seats")
        ).map((seat) => seat + 1)
      ])
    );
    const players = shuffledEntrants.map(
      (entrant, index) => {
        const table = tables[index % tables.length];
        const tableIndex = Math.floor(index / tables.length);
        return {
          ...entrant,
          stack: structure.startingStack,
          status: "active",
          tableId: table.id,
          seat: seatOrders[table.id][tableIndex]
        };
      }
    );
    return {
      id,
      structure,
      players,
      tables,
      levelIndex: 0,
      levelElapsedMs: 0,
      totalElapsedMs: 0,
      status: "running",
      handForHand: false,
      seedCommitment: hashSeed(seed).toString(16).padStart(8, "0"),
      breakingOrder: tables.map((table) => table.id).reverse()
    };
  }
  function recordEliminations(source, records) {
    if (records.length === 0) return source;
    if (new Set(records.map((record) => record.playerId)).size !== records.length) {
      throw new Error("A player may be eliminated only once per transition");
    }
    for (const record of records) {
      if (!Number.isSafeInteger(record.startedHandWith) || record.startedHandWith < 0) {
        throw new Error("Starting stack for an elimination must be valid");
      }
      const player = source.players.find((entry) => entry.id === record.playerId);
      if (!player || player.status !== "active" || player.tableId !== record.tableId) {
        throw new Error(`Invalid elimination record for ${record.playerId}`);
      }
    }
    const activeBefore = source.players.filter(
      (player) => player.status === "active"
    ).length;
    const bestPlace = activeBefore - records.length + 1;
    const sameSynchronizedHand = source.handForHand && records.every((record) => record.handId === records[0].handId);
    const sameTableAndHand = records.every(
      (record) => record.handId === records[0].handId && record.tableId === records[0].tableId
    );
    const places = /* @__PURE__ */ new Map();
    if (sameTableAndHand) {
      [...records].sort(
        (left, right) => right.startedHandWith - left.startedHandWith || left.playerId.localeCompare(right.playerId)
      ).forEach((record, index) => {
        const previous = records.find(
          (candidate) => candidate.playerId !== record.playerId && candidate.startedHandWith === record.startedHandWith
        );
        const tiedPlace = previous === void 0 ? void 0 : places.get(previous.playerId);
        places.set(record.playerId, tiedPlace != null ? tiedPlace : bestPlace + index);
      });
    } else if (sameSynchronizedHand) {
      for (const record of records) places.set(record.playerId, bestPlace);
    } else {
      records.forEach((record, index) => {
        places.set(record.playerId, bestPlace + index);
      });
    }
    const state = {
      ...source,
      players: source.players.map((player) => {
        const place = places.get(player.id);
        return place === void 0 ? { ...player } : {
          ...player,
          stack: 0,
          status: "eliminated",
          finishPlace: place
        };
      }),
      tables: source.tables.map((table) => ({ ...table }))
    };
    const remaining = state.players.filter(
      (player) => player.status === "active"
    );
    if (remaining.length === 1) {
      const winner = remaining[0];
      winner.finishPlace = 1;
      state.status = "complete";
    }
    return state;
  }
  function createInformationSet(source, viewerId) {
    if (!source.players.some((player) => player.id === viewerId)) {
      throw new Error(`Viewer ${viewerId} is not seated in this hand`);
    }
    return {
      handId: source.handId,
      viewerId,
      street: source.street,
      board: source.board.map((card) => ({ ...card })),
      pot: source.pot,
      currentBet: source.currentBet,
      actingPlayerId: source.actingPlayerId,
      buttonSeat: source.buttonSeat,
      players: source.players.map(({ holeCards, ...player }) => ({
        ...player,
        ...player.id === viewerId || player.revealed ? { holeCards: holeCards.map((card) => ({ ...card })) } : {}
      })),
      actions: source.actions.map((action) => ({ ...action }))
    };
  }

  // src/modes/normal.ts
  var clamp01 = (value) => Math.max(0, Math.min(1, value));
  function makeProfile(profile) {
    const vector = profile.personality;
    for (const [name, value] of Object.entries(vector)) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Normal profile ${profile.id} has invalid ${name}`);
      }
    }
    if (profile.competenceRate < 0.9 || profile.competenceRate > 0.95) {
      throw new Error(
        `Normal profile ${profile.id} competence must remain between 90% and 95%`
      );
    }
    if (!Number.isFinite(profile.maxEvLossBb) || profile.maxEvLossBb < 0) {
      throw new Error(`Normal profile ${profile.id} has an invalid EV budget`);
    }
    return Object.freeze({
      ...profile,
      personality: Object.freeze({ ...profile.personality })
    });
  }
  var NORMAL_OPPONENT_PROFILES = Object.freeze({
    anchor: makeProfile({
      id: "anchor",
      name: "Adrian “Anchor” Cole",
      description: "Patient and disciplined. Prefers low-variance defenses and rarely spends EV on a bluff.",
      personality: {
        aggression: 0.3,
        looseness: 0.24,
        riskTolerance: 0.28,
        trapAppetite: 0.36,
        bluffAppetite: 0.14
      },
      competenceRate: 0.95,
      maxEvLossBb: 0.12
    }),
    tempo: makeProfile({
      id: "tempo",
      name: "Maya “Tempo” Chen",
      description: "Balanced and observant. Changes pace when public frequencies justify it.",
      personality: {
        aggression: 0.56,
        looseness: 0.48,
        riskTolerance: 0.52,
        trapAppetite: 0.42,
        bluffAppetite: 0.4
      },
      competenceRate: 0.94,
      maxEvLossBb: 0.18
    }),
    pressure: makeProfile({
      id: "pressure",
      name: "Rafael “Pressure” Torres",
      description: "Applies controlled pressure with value and credible semi-bluffs.",
      personality: {
        aggression: 0.86,
        looseness: 0.55,
        riskTolerance: 0.73,
        trapAppetite: 0.18,
        bluffAppetite: 0.62
      },
      competenceRate: 0.92,
      maxEvLossBb: 0.26
    }),
    mirror: makeProfile({
      id: "mirror",
      name: "Juno “Mirror” Pike",
      description: "Tricky but coherent. Uses blockers, traps, and observed fold pressure.",
      personality: {
        aggression: 0.63,
        looseness: 0.45,
        riskTolerance: 0.58,
        trapAppetite: 0.83,
        bluffAppetite: 0.72
      },
      competenceRate: 0.91,
      maxEvLossBb: 0.3
    }),
    wideLens: makeProfile({
      id: "wide-lens",
      name: "Lena “Wide Lens” Ortiz",
      description: "Defends wider than the field and realizes equity without punting stacks.",
      personality: {
        aggression: 0.57,
        looseness: 0.82,
        riskTolerance: 0.68,
        trapAppetite: 0.31,
        bluffAppetite: 0.48
      },
      competenceRate: 0.9,
      maxEvLossBb: 0.32
    })
  });
  function resolveProfile(profile) {
    return typeof profile === "string" ? NORMAL_OPPONENT_PROFILES[profile] : profile;
  }
  function safeRate(numerator, denominator, prior) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
      return prior;
    }
    return clamp01((Math.max(0, numerator) + prior * 12) / (Math.max(0, denominator) + 12));
  }
  function historiesFromCurrentHand(informationSet) {
    const byPlayer = /* @__PURE__ */ new Map();
    for (const player of informationSet.players) {
      if (player.id === informationSet.viewerId) continue;
      byPlayer.set(player.id, {
        playerId: player.id,
        handsObserved: 1,
        voluntaryEntries: 0,
        aggressiveActions: 0,
        passiveActions: 0,
        foldsFacingPressure: 0,
        pressureOpportunities: 0
      });
    }
    for (const action of informationSet.actions) {
      const history = byPlayer.get(action.playerId);
      if (!history) continue;
      const type = action.type.toLowerCase();
      if (type === "bet" || type === "raise" || type === "all-in") {
        history.aggressiveActions += 1;
        history.voluntaryEntries += 1;
      } else if (type === "call" || type === "check") {
        history.passiveActions += 1;
        if (type === "call") history.voluntaryEntries += 1;
      } else if (type === "fold") {
        history.foldsFacingPressure += 1;
        history.pressureOpportunities += 1;
      }
    }
    return [...byPlayer.values()];
  }
  function derivePublicExploitSignals(informationSet, publicHistory) {
    const histories = publicHistory && publicHistory.length > 0 ? publicHistory.filter(
      (entry) => entry.playerId !== informationSet.viewerId
    ) : historiesFromCurrentHand(informationSet);
    if (histories.length === 0) {
      return {
        foldToPressure: 0.45,
        aggression: 0.42,
        looseness: 0.38,
        confidence: 0
      };
    }
    let weightedFold = 0;
    let weightedAggression = 0;
    let weightedLooseness = 0;
    let totalWeight = 0;
    let observedHands = 0;
    for (const history of histories) {
      const hands = Math.max(0, history.handsObserved);
      const actionCount = Math.max(0, history.aggressiveActions) + Math.max(0, history.passiveActions);
      const weight = Math.max(1, Math.min(40, hands));
      weightedFold += safeRate(
        history.foldsFacingPressure,
        history.pressureOpportunities,
        0.45
      ) * weight;
      weightedAggression += safeRate(history.aggressiveActions, actionCount, 0.42) * weight;
      weightedLooseness += safeRate(history.voluntaryEntries, Math.max(1, hands), 0.38) * weight;
      totalWeight += weight;
      observedHands += hands;
    }
    return {
      foldToPressure: weightedFold / totalWeight,
      aggression: weightedAggression / totalWeight,
      looseness: weightedLooseness / totalWeight,
      confidence: clamp01(observedHands / (histories.length * 40))
    };
  }
  var RANK_VALUE2 = {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14
  };
  function straightDrawStrength(cards) {
    const values = new Set(cards.map((card) => RANK_VALUE2[card.rank]));
    if (values.has(14)) values.add(1);
    let best = 0;
    for (let low = 1; low <= 10; low += 1) {
      let present = 0;
      for (let rank = low; rank < low + 5; rank += 1) {
        if (values.has(rank)) present += 1;
      }
      if (present >= 4) best = Math.max(best, present === 5 ? 1 : 0.66);
      else if (present === 3) best = Math.max(best, 0.24);
    }
    return best;
  }
  function analyzePrivateHand(informationSet) {
    var _a, _b, _c;
    const viewer = informationSet.players.find(
      (player) => player.id === informationSet.viewerId
    );
    const holeCards = (_b = (_a = viewer == null ? void 0 : viewer.holeCards) == null ? void 0 : _a.slice(0, 2)) != null ? _b : [];
    const knownCards = [...holeCards, ...informationSet.board];
    if (holeCards.length !== 2) {
      return {
        showdownStrength: 0,
        drawStrength: 0,
        blockerStrength: 0,
        strongMadeHand: false
      };
    }
    const holeValues = holeCards.map((card) => RANK_VALUE2[card.rank]).sort((left, right) => right - left);
    const pair = holeValues[0] === holeValues[1];
    const suited = holeCards[0].suit === holeCards[1].suit;
    const connected = Math.abs(holeValues[0] - holeValues[1]) <= 2;
    let showdownStrength = pair ? 0.46 + holeValues[0] / 14 * 0.42 : (holeValues[0] + holeValues[1]) / 34;
    if (suited) showdownStrength += 0.05;
    if (connected) showdownStrength += 0.04;
    let strongMadeHand = false;
    if (knownCards.length >= 5) {
      const value = evaluateBestHand(knownCards);
      showdownStrength = Math.max(
        showdownStrength,
        (value.category + 0.7) / (HAND_CATEGORY.STRAIGHT_FLUSH + 1)
      );
      strongMadeHand = value.category >= HAND_CATEGORY.TWO_PAIR;
    }
    const suitCounts = /* @__PURE__ */ new Map();
    for (const card of knownCards) {
      suitCounts.set(card.suit, ((_c = suitCounts.get(card.suit)) != null ? _c : 0) + 1);
    }
    const relevantSuitCounts = holeCards.map(
      (card) => {
        var _a2;
        return (_a2 = suitCounts.get(card.suit)) != null ? _a2 : 0;
      }
    );
    const flushDraw = relevantSuitCounts.some((count) => count === 4) ? 0.82 : 0;
    const straightDraw = straightDrawStrength(knownCards);
    const drawStrength = Math.max(flushDraw, straightDraw);
    let blockerStrength = 0;
    for (const holeCard of holeCards) {
      const sameSuitOnBoard = informationSet.board.filter(
        (card) => card.suit === holeCard.suit
      ).length;
      if (holeCard.rank === "A" && sameSuitOnBoard >= 2) blockerStrength = 1;
      else if (holeCard.rank === "K" && sameSuitOnBoard >= 2) {
        blockerStrength = Math.max(blockerStrength, 0.72);
      } else if (RANK_VALUE2[holeCard.rank] >= 13) {
        blockerStrength = Math.max(blockerStrength, 0.36);
      }
    }
    return {
      showdownStrength: clamp01(showdownStrength),
      drawStrength,
      blockerStrength,
      strongMadeHand
    };
  }
  function commandKey(command) {
    var _a;
    return `${command.type}:${(_a = command.to) != null ? _a : ""}`;
  }
  function isAggressive(command) {
    return command.type === "bet" || command.type === "raise" || command.type === "all-in";
  }
  function assertLegalEvaluation(evaluation, legal) {
    if (!Number.isFinite(evaluation.estimatedEv)) {
      throw new Error("Normal action EVs must be finite numbers");
    }
    const { command } = evaluation;
    let valid = false;
    switch (command.type) {
      case "fold":
        valid = legal.fold;
        break;
      case "check":
        valid = legal.check;
        break;
      case "call":
        valid = legal.call;
        break;
      case "bet":
        valid = legal.bet !== void 0 && command.to !== void 0 && command.to >= legal.bet.min && command.to <= legal.bet.max;
        break;
      case "raise":
        valid = legal.raise !== void 0 && command.to !== void 0 && command.to >= legal.raise.minTo && command.to <= legal.raise.maxTo;
        break;
      case "all-in":
        valid = legal.allIn && (command.to === void 0 || command.to === legal.allInTo);
        break;
    }
    if (!valid) {
      throw new Error(`Evaluation contains illegal action ${commandKey(command)}`);
    }
  }
  function purposeAllowed(evaluation, hand, publicSignals) {
    var _a;
    const purpose = (_a = evaluation.purpose) != null ? _a : "neutral";
    if (!isAggressive(evaluation.command)) return true;
    if (purpose === "semi-bluff") return hand.drawStrength >= 0.45;
    if (purpose === "bluff") {
      const credibleBlockerBluff = hand.blockerStrength >= 0.55 && publicSignals.foldToPressure >= 0.52;
      return hand.drawStrength >= 0.45 || credibleBlockerBluff;
    }
    if (purpose === "trap") {
      return hand.strongMadeHand || hand.showdownStrength >= 0.72;
    }
    if (purpose === "thin-value") return hand.showdownStrength >= 0.42;
    return true;
  }
  function candidateWeight(evaluation, profile, hand, signals, legal) {
    var _a;
    const vector = profile.personality;
    const purpose = (_a = evaluation.purpose) != null ? _a : "neutral";
    const command = evaluation.command;
    const pressure = clamp01(legal.toCall / Math.max(1, legal.allInTo));
    let weight = 0.2;
    if (command.type === "fold") {
      weight += (1 - vector.looseness) * 0.8 + pressure * (1 - vector.riskTolerance);
    } else if (command.type === "check" || command.type === "call") {
      weight += vector.looseness * 0.55 + (1 - vector.aggression) * 0.35;
    } else {
      weight += vector.aggression * 0.8 + vector.riskTolerance * 0.25;
    }
    if (purpose === "value") weight += vector.aggression * hand.showdownStrength;
    if (purpose === "thin-value") {
      weight += vector.riskTolerance * hand.showdownStrength * 0.7;
    }
    if (purpose === "semi-bluff") {
      weight += vector.bluffAppetite * hand.drawStrength + signals.foldToPressure * signals.confidence * 0.45;
    }
    if (purpose === "bluff") {
      weight += vector.bluffAppetite * 0.85 + hand.blockerStrength * 0.4 + signals.foldToPressure * signals.confidence * 0.65;
    }
    if (purpose === "trap") {
      const passive = command.type === "check" || command.type === "call";
      weight += passive ? vector.trapAppetite : 1 - vector.trapAppetite;
    }
    if (purpose === "defense") weight += vector.looseness * 0.6;
    return Math.max(0.01, weight);
  }
  function weightedChoice(candidates, weight, random) {
    const weighted = candidates.map((candidate) => ({
      candidate,
      weight: Math.max(0, weight(candidate))
    }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return candidates[0];
    let cursor = random() * total;
    for (const entry of weighted) {
      cursor -= entry.weight;
      if (cursor <= 0) return entry.candidate;
    }
    return weighted[weighted.length - 1].candidate;
  }
  function publicDecisionSeed(input, profile) {
    var _a;
    const board = input.informationSet.board.map((card) => `${card.rank}-${card.suit}`).join(",");
    return deriveSeed(
      input.seed,
      "normal-policy-v1",
      input.informationSet.handId,
      input.informationSet.viewerId,
      input.informationSet.street,
      board,
      (_a = input.decisionIndex) != null ? _a : input.informationSet.actions.length,
      profile.id
    );
  }
  function decideNormalAction(input) {
    var _a;
    const profile = resolveProfile(input.profile);
    if (input.legalActions.playerId !== input.informationSet.viewerId) {
      throw new Error("Legal actions must belong to the information-set viewer");
    }
    if (input.informationSet.actingPlayerId !== void 0 && input.informationSet.actingPlayerId !== input.informationSet.viewerId) {
      throw new Error("Normal policy may act only for the information-set viewer");
    }
    if (!Number.isSafeInteger(input.bigBlind) || input.bigBlind <= 0) {
      throw new Error("Big blind must be a positive chip amount");
    }
    if (input.evaluations.length === 0) {
      throw new Error("Normal policy requires at least one action evaluation");
    }
    const seen = /* @__PURE__ */ new Set();
    for (const evaluation of input.evaluations) {
      assertLegalEvaluation(evaluation, input.legalActions);
      const key = commandKey(evaluation.command);
      if (seen.has(key)) throw new Error(`Duplicate action evaluation ${key}`);
      seen.add(key);
    }
    const ranked = [...input.evaluations].sort(
      (left, right) => right.estimatedEv - left.estimatedEv || commandKey(left.command).localeCompare(commandKey(right.command))
    );
    const best = ranked[0];
    const bestEv = best.estimatedEv;
    const hardBudget = profile.maxEvLossBb * input.bigBlind;
    const signals = derivePublicExploitSignals(
      input.informationSet,
      input.publicHistory
    );
    const hand = analyzePrivateHand(input.informationSet);
    const random = createSeededRandom(publicDecisionSeed(input, profile));
    const useBest = random() < profile.competenceRate;
    const deviations = ranked.slice(1).filter((evaluation) => {
      const loss = bestEv - evaluation.estimatedEv;
      return loss >= 0 && loss <= hardBudget + Number.EPSILON && purposeAllowed(evaluation, hand, signals);
    });
    const chosen = useBest || deviations.length === 0 ? best : weightedChoice(
      deviations,
      (candidate) => candidateWeight(
        candidate,
        profile,
        hand,
        signals,
        input.legalActions
      ),
      random
    );
    const evLoss = Math.max(0, bestEv - chosen.estimatedEv);
    const selectedBestAction = commandKey(chosen.command) === commandKey(best.command);
    const purpose = (_a = chosen.purpose) != null ? _a : "neutral";
    return {
      command: { ...chosen.command },
      purpose,
      estimatedEv: chosen.estimatedEv,
      bestEv,
      evLoss,
      evLossBudget: hardBudget,
      profileId: profile.id,
      selectedBestAction,
      usedPersonalityDeviation: !selectedBestAction,
      reason: selectedBestAction ? `${profile.name} selected the highest modeled-EV line under its current range estimate.` : `${profile.name} used a bounded ${purpose} deviation supported by its own hole-card texture and public action history.`,
      publicSignals: signals
    };
  }

  // src/locales/en-US.numeric.ts
  var EN_US_NUMERIC_LOCALE = Object.freeze({
    resource: "poker-training-pro-numeric-locale",
    version: 1,
    id: "en-US",
    intlLocale: "en-US",
    acceptedDecimalSeparators: Object.freeze([".", ","]),
    ratioSeparator: ":",
    durationSeparator: ":"
  });

  // src/lib/localeNumbers.ts
  var NUMERIC_LOCALE_RESOURCE_VERSION = 1;
  function formatNumber(value, options = {}, locale = EN_US_NUMERIC_LOCALE) {
    assertLocale(locale);
    assertDisplayNumber(value);
    return new Intl.NumberFormat(locale.intlLocale, options).format(value);
  }
  function formatFixedDecimal(value, fractionDigits, locale = EN_US_NUMERIC_LOCALE) {
    if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
      throw new RangeError("fractionDigits must be from 0 to 6.");
    }
    return formatNumber(
      value,
      {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
      },
      locale
    );
  }
  function formatPercentage(percentagePoints, locale = EN_US_NUMERIC_LOCALE, maximumFractionDigits = 1) {
    if (!Number.isInteger(maximumFractionDigits) || maximumFractionDigits < 0 || maximumFractionDigits > 6) {
      throw new RangeError("maximumFractionDigits must be from 0 to 6.");
    }
    return formatNumber(
      percentagePoints / 100,
      {
        style: "percent",
        maximumFractionDigits,
        minimumFractionDigits: 0
      },
      locale
    );
  }
  function assertLocale(locale) {
    if (locale.resource !== "poker-training-pro-numeric-locale" || locale.version !== NUMERIC_LOCALE_RESOURCE_VERSION || typeof locale.id !== "string" || locale.id.length === 0 || locale.id.length > 64 || typeof locale.intlLocale !== "string" || locale.intlLocale.length === 0 || locale.intlLocale.length > 64 || Intl.NumberFormat.supportedLocalesOf([locale.intlLocale]).length !== 1 || locale.acceptedDecimalSeparators.length === 0 || locale.acceptedDecimalSeparators.length > 2 || !locale.acceptedDecimalSeparators.every(
      (separator) => separator === "." || separator === ","
    ) || new Set(locale.acceptedDecimalSeparators).size !== locale.acceptedDecimalSeparators.length || typeof locale.ratioSeparator !== "string" || locale.ratioSeparator.length !== 1 || typeof locale.durationSeparator !== "string" || locale.durationSeparator.length !== 1) {
      throw new TypeError("Unsupported numeric locale resource.");
    }
  }
  function assertDisplayNumber(value) {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Display value must be a finite safe number.");
    }
  }

  // src/locales/en-US.dateTime.ts
  var EN_US_DATE_TIME_LOCALE = Object.freeze({
    resource: "poker-training-pro-date-time-locale",
    version: 1,
    id: "en-US",
    intlLocale: "en-US",
    options: Object.freeze({
      dateStyle: "medium",
      timeStyle: "short"
    })
  });

  // src/modes/rational.ts
  var POLICY_VERSION = "rational-v1";
  var DEFAULT_SIMULATIONS = 700;
  var MAX_EQUITY_SIMULATIONS_PER_DECISION = 1200;
  var MAX_EQUITY_SIMULATIONS_PER_SLICE = 32;
  var DEFAULT_EQUITY_SIMULATIONS_PER_SLICE = 16;
  var RANK_VALUE3 = {
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14
  };
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }
  function roundChips(value, unit) {
    const snapped = Math.max(unit, Math.round(value / unit) * unit);
    return Math.round(snapped);
  }
  function aggressionFor(actions, playerId) {
    return actions.filter((action) => action.playerId === playerId).reduce((score, action) => {
      const type = action.type.toLowerCase();
      if (type.includes("all")) return score + 1;
      if (type.includes("raise")) return score + 0.8;
      if (type.includes("bet")) return score + 0.55;
      if (type.includes("call")) return score + 0.15;
      return score;
    }, 0);
  }
  function preflopStrength([left, right]) {
    const high = Math.max(RANK_VALUE3[left.rank], RANK_VALUE3[right.rank]);
    const low = Math.min(RANK_VALUE3[left.rank], RANK_VALUE3[right.rank]);
    const pair = high === low;
    const suited = left.suit === right.suit;
    const gap = high - low;
    if (pair) return clamp(0.53 + high / 14 * 0.45, 0, 1);
    let score = high / 14 * 0.43 + low / 14 * 0.22;
    if (suited) score += 0.1;
    if (gap === 1) score += 0.1;
    else if (gap === 2) score += 0.06;
    else if (gap === 3) score += 0.025;
    if (high === 14) score += 0.05;
    if (high >= 11 && low >= 10) score += 0.07;
    return clamp(score, 0.02, 0.98);
  }
  function madeHandStrength(combo, board) {
    var _a;
    if (board.length < 3) return preflopStrength(combo);
    const value = evaluateBestHand([...combo, ...board]);
    const kicker = ((_a = value.tiebreak[0]) != null ? _a : 0) / 14;
    return clamp(value.category / 8 + kicker * 0.08, 0, 1);
  }
  function drawPotential(cards, board) {
    var _a;
    if (board.length >= 5) return 0;
    const available = [...cards, ...board];
    const suitCounts = /* @__PURE__ */ new Map();
    for (const card of available) {
      suitCounts.set(card.suit, ((_a = suitCounts.get(card.suit)) != null ? _a : 0) + 1);
    }
    const flushDraw = Math.max(...suitCounts.values()) >= 4 ? 0.28 : 0;
    const ranks = new Set(available.map((card) => RANK_VALUE3[card.rank]));
    if (ranks.has(14)) ranks.add(1);
    let straightDraw = 0;
    for (let low = 1; low <= 10; low += 1) {
      let present = 0;
      for (let rank = low; rank < low + 5; rank += 1) {
        if (ranks.has(rank)) present += 1;
      }
      if (present === 4) straightDraw = Math.max(straightDraw, 0.22);
      else if (present === 3) straightDraw = Math.max(straightDraw, 0.08);
    }
    return clamp(flushDraw + straightDraw, 0, 0.45);
  }
  function blockerScore(heroCards, board) {
    var _a, _b;
    const boardSuits = /* @__PURE__ */ new Map();
    for (const card of board) {
      boardSuits.set(card.suit, ((_a = boardSuits.get(card.suit)) != null ? _a : 0) + 1);
    }
    let score = 0;
    for (const card of heroCards) {
      const rank = RANK_VALUE3[card.rank];
      if (((_b = boardSuits.get(card.suit)) != null ? _b : 0) >= 2 && rank >= 13) score += 0.18;
      if (rank === 14) score += 0.05;
      else if (rank === 13) score += 0.025;
    }
    return clamp(score, 0, 0.35);
  }
  function allTwoCardCombos(cards) {
    const combos = [];
    for (let left = 0; left < cards.length - 1; left += 1) {
      for (let right = left + 1; right < cards.length; right += 1) {
        combos.push([cards[left], cards[right]]);
      }
    }
    return combos;
  }
  function buildRange(opponent, availableDeck, board, actions) {
    const aggression = aggressionFor(actions, opponent.id);
    const publicActions = actions.filter((action) => action.playerId === opponent.id).length;
    const tightness = clamp(0.8 + aggression * 0.75, 0.8, 3.4);
    const rawCombos = allTwoCardCombos(availableDeck);
    const combos = rawCombos.map((cards) => {
      const starting = preflopStrength(cards);
      const made = madeHandStrength(cards, board);
      const draw = drawPotential(cards, board);
      const strategicStrength = board.length >= 3 ? made * 0.62 + starting * 0.18 + draw * 0.2 : starting;
      const valueWeight = Math.exp((strategicStrength - 0.48) * tightness * 2.2);
      const bluffTail = aggression > 0 ? 0.08 + draw * 0.5 + (1 - strategicStrength) * 0.04 : 0.04;
      return { cards, weight: Math.max(1e-4, valueWeight + bluffTail) };
    });
    const topPercent = clamp(62 - aggression * 13 - publicActions * 2, 8, 72);
    return {
      combos,
      summary: {
        opponentId: opponent.id,
        publicActions,
        aggression: Number(aggression.toFixed(3)),
        estimatedTopRangePercent: Number(topPercent.toFixed(1)),
        weightedCombos: combos.length,
        description: aggression >= 1.2 ? "Public aggression weights this range toward made hands, strong draws, and a protected bluff tail." : aggression > 0 ? "Calls and modest aggression retain a medium-width range with value and drawing hands." : "With little public action, the estimate remains broad and position-neutral."
      }
    };
  }
  function chooseWeightedAvailableCombo(combos, unavailable, random) {
    let total = 0;
    for (const combo of combos) {
      if (!unavailable.has(cardKey(combo.cards[0])) && !unavailable.has(cardKey(combo.cards[1]))) {
        total += combo.weight;
      }
    }
    if (total <= 0) throw new Error("No legal opponent combinations remain");
    let needle = random() * total;
    for (const combo of combos) {
      if (unavailable.has(cardKey(combo.cards[0])) || unavailable.has(cardKey(combo.cards[1]))) {
        continue;
      }
      needle -= combo.weight;
      if (needle <= 0) return combo.cards;
    }
    const fallback = combos.find(
      (combo) => !unavailable.has(cardKey(combo.cards[0])) && !unavailable.has(cardKey(combo.cards[1]))
    );
    if (!fallback) throw new Error("No legal fallback combination remains");
    return fallback.cards;
  }
  function sampleWithoutReplacement(values, count, random) {
    const pool = [...values];
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    return pool.slice(0, count);
  }
  function assertInformationSet(informationSet, legalActions) {
    if (legalActions.playerId !== informationSet.viewerId) {
      throw new Error("Legal actions must belong to the information-set viewer");
    }
    const hero = informationSet.players.find(
      (player) => player.id === informationSet.viewerId
    );
    if (!(hero == null ? void 0 : hero.holeCards) || hero.holeCards.length !== 2) {
      throw new Error("Rational policy requires exactly two visible hero cards");
    }
    const knownCards = [
      ...hero.holeCards,
      ...informationSet.board,
      ...informationSet.players.flatMap(
        (player) => player.id !== hero.id && player.revealed && player.holeCards ? player.holeCards : []
      )
    ];
    if (new Set(knownCards.map(cardKey)).size !== knownCards.length) {
      throw new Error("Visible information contains duplicate cards");
    }
    const opponents = informationSet.players.filter(
      (player) => player.id !== hero.id && player.status !== "folded" && player.status !== "out"
    ).map((player) => ({
      id: player.id,
      status: player.status,
      stack: player.stack,
      seat: player.seat,
      holeCards: player.revealed && player.holeCards ? player.holeCards.map((card) => ({ ...card })) : void 0
    }));
    if (opponents.length === 0) {
      throw new Error("Rational policy requires at least one live opponent");
    }
    return {
      heroCards: hero.holeCards.map((card) => ({ ...card })),
      opponents
    };
  }
  function validateEquityWorkBudget(simulations2, simulationsPerSlice) {
    if (!Number.isInteger(simulations2) || simulations2 < 50 || simulations2 > MAX_EQUITY_SIMULATIONS_PER_DECISION) {
      throw new Error(
        `Equity simulations must be an integer from 50 to ${MAX_EQUITY_SIMULATIONS_PER_DECISION}`
      );
    }
    if (!Number.isInteger(simulationsPerSlice) || simulationsPerSlice < 1 || simulationsPerSlice > MAX_EQUITY_SIMULATIONS_PER_SLICE) {
      throw new Error(
        `Equity simulations per slice must be an integer from 1 to ${MAX_EQUITY_SIMULATIONS_PER_SLICE}`
      );
    }
  }
  function createRangeEquityWork(informationSet, legalActions, seed, simulations2, simulationsPerSlice) {
    validateEquityWorkBudget(simulations2, simulationsPerSlice);
    const stableInformationSet = structuredClone(informationSet);
    const { heroCards, opponents } = assertInformationSet(
      stableInformationSet,
      legalActions
    );
    const known = /* @__PURE__ */ new Set([
      ...heroCards.map(cardKey),
      ...stableInformationSet.board.map(cardKey),
      ...opponents.flatMap(
        (opponent) => {
          var _a, _b;
          return (_b = (_a = opponent.holeCards) == null ? void 0 : _a.map(cardKey)) != null ? _b : [];
        }
      )
    ]);
    const unknownDeck = createDeck().filter((card) => !known.has(cardKey(card)));
    const ranges = /* @__PURE__ */ new Map();
    for (const opponent of opponents) {
      if (!opponent.holeCards) {
        ranges.set(
          opponent.id,
          buildRange(
            opponent,
            unknownDeck,
            stableInformationSet.board,
            stableInformationSet.actions
          )
        );
      }
    }
    return {
      informationSet: stableInformationSet,
      heroCards,
      opponents,
      ranges,
      random: createSeededRandom(
        deriveSeed(seed, POLICY_VERSION, stableInformationSet.handId, "equity")
      ),
      simulations: simulations2,
      simulationsPerSlice,
      completed: 0,
      slices: 0,
      wins: 0,
      ties: 0,
      losses: 0,
      equityPoints: 0
    };
  }
  function advanceRangeEquityWork(state) {
    if (state.completed >= state.simulations) return;
    const stop = Math.min(
      state.simulations,
      state.completed + state.simulationsPerSlice
    );
    while (state.completed < stop) {
      const unavailable = /* @__PURE__ */ new Set([
        ...state.heroCards.map(cardKey),
        ...state.informationSet.board.map(cardKey)
      ]);
      const opponentCards = /* @__PURE__ */ new Map();
      for (const opponent of state.opponents) {
        let combo;
        if (opponent.holeCards) {
          combo = [opponent.holeCards[0], opponent.holeCards[1]];
        } else {
          const range = state.ranges.get(opponent.id);
          if (!range) throw new Error("Missing opponent range");
          combo = chooseWeightedAvailableCombo(
            range.combos,
            unavailable,
            state.random
          );
        }
        opponentCards.set(opponent.id, combo);
        unavailable.add(cardKey(combo[0]));
        unavailable.add(cardKey(combo[1]));
      }
      const runout = sampleWithoutReplacement(
        createDeck().filter((card) => !unavailable.has(cardKey(card))),
        5 - state.informationSet.board.length,
        state.random
      );
      const board = [...state.informationSet.board, ...runout];
      const heroValue = evaluateBestHand([...state.heroCards, ...board]);
      const values = [
        { id: state.informationSet.viewerId, value: heroValue },
        ...state.opponents.map((opponent) => ({
          id: opponent.id,
          value: evaluateBestHand([
            ...opponentCards.get(opponent.id),
            ...board
          ])
        }))
      ];
      const best = values.reduce(
        (leader, candidate) => compareHandValues(candidate.value, leader.value) > 0 ? candidate : leader
      );
      const winners = values.filter(
        (candidate) => compareHandValues(candidate.value, best.value) === 0
      );
      if (!winners.some(
        (winner) => winner.id === state.informationSet.viewerId
      )) {
        state.losses += 1;
      } else if (winners.length === 1) {
        state.wins += 1;
        state.equityPoints += 1;
      } else {
        state.ties += 1;
        state.equityPoints += 1 / winners.length;
      }
      state.completed += 1;
    }
    state.slices += 1;
  }
  function finishRangeEquityWork(state) {
    if (state.completed !== state.simulations) {
      throw new Error(
        `Equity work is incomplete (${state.completed}/${state.simulations}).`
      );
    }
    return {
      equity: state.equityPoints / state.simulations,
      wins: state.wins,
      ties: state.ties,
      losses: state.losses,
      simulations: state.simulations,
      opponentRanges: state.opponents.map((opponent) => {
        var _a;
        const range = state.ranges.get(opponent.id);
        return (_a = range == null ? void 0 : range.summary) != null ? _a : {
          opponentId: opponent.id,
          publicActions: state.informationSet.actions.filter(
            (action) => action.playerId === opponent.id
          ).length,
          aggression: aggressionFor(
            state.informationSet.actions,
            opponent.id
          ),
          estimatedTopRangePercent: 0,
          weightedCombos: 1,
          description: "The hand is publicly revealed, so no hidden range is inferred."
        };
      }),
      work: {
        workVersion: "range-equity-work-v1",
        requestedSimulations: state.simulations,
        completedSimulations: state.completed,
        simulationsPerSlice: state.simulationsPerSlice,
        slices: state.slices,
        handEvaluations: state.completed * (state.opponents.length + 1),
        maximumSimulationsPerDecision: MAX_EQUITY_SIMULATIONS_PER_DECISION,
        maximumSimulationsPerSlice: MAX_EQUITY_SIMULATIONS_PER_SLICE,
        schedulingBasis: "completed-simulation-count"
      }
    };
  }
  function estimateRangeEquity(informationSet, legalActions, seed, simulations2 = DEFAULT_SIMULATIONS, options = {}) {
    var _a;
    const state = createRangeEquityWork(
      informationSet,
      legalActions,
      seed,
      simulations2,
      (_a = options.simulationsPerSlice) != null ? _a : DEFAULT_EQUITY_SIMULATIONS_PER_SLICE
    );
    while (state.completed < state.simulations) advanceRangeEquityWork(state);
    return finishRangeEquityWork(state);
  }
  function positionScore(informationSet) {
    const active = informationSet.players.filter(
      (player) => player.status !== "folded" && player.status !== "out"
    );
    if (active.length <= 1) return 1;
    const tableSize = Math.max(
      informationSet.buttonSeat,
      ...informationSet.players.map((player) => player.seat)
    );
    const order = [...active].sort((left, right) => {
      const leftDistance = (left.seat - informationSet.buttonSeat + tableSize) % tableSize || tableSize;
      const rightDistance = (right.seat - informationSet.buttonSeat + tableSize) % tableSize || tableSize;
      return leftDistance - rightDistance;
    });
    const heroIndex = order.findIndex(
      (player) => player.id === informationSet.viewerId
    );
    return clamp(heroIndex / (order.length - 1), 0, 1);
  }
  function tournamentRiskPremium(context, heroStack) {
    if (!context) return 0;
    if (context.riskPremium !== void 0) {
      return clamp(context.riskPremium, 0, 0.3);
    }
    let premium = context.handForHand ? 0.055 : 0;
    if (context.paidPlaces !== void 0 && context.playersRemaining > context.paidPlaces) {
      const bubbleDistance = context.playersRemaining - context.paidPlaces;
      if (bubbleDistance <= 2) premium += 0.07;
      else if (bubbleDistance <= 5) premium += 0.035;
    }
    if (context.placesToQualification !== void 0) {
      if (context.placesToQualification <= 1) premium += 0.07;
      else if (context.placesToQualification <= 3) premium += 0.04;
    }
    if (context.averageStack && heroStack < context.averageStack * 0.6) {
      premium *= 0.72;
    }
    return clamp(premium, 0, 0.22);
  }
  function addCandidate(map, command, additionalRisk) {
    const id = command.to === void 0 ? command.type : `${command.type}:${command.to}`;
    map.set(id, { id, command, additionalRisk });
  }
  function buildCandidates(informationSet, legal, bigBlind) {
    const hero = informationSet.players.find(
      (player) => player.id === informationSet.viewerId
    );
    if (!hero) throw new Error("Hero is missing");
    const candidates = /* @__PURE__ */ new Map();
    if (legal.fold) addCandidate(candidates, { type: "fold" }, 0);
    if (legal.check) addCandidate(candidates, { type: "check" }, 0);
    if (legal.call) {
      addCandidate(candidates, { type: "call" }, legal.callAmount);
    }
    if (legal.bet) {
      const desired = [0.33, 0.66, 1].map(
        (fraction) => {
          var _a, _b, _c, _d;
          return clamp(
            roundChips(informationSet.pot * fraction, Math.max(1, bigBlind / 4)),
            (_b = (_a = legal.bet) == null ? void 0 : _a.min) != null ? _b : 0,
            (_d = (_c = legal.bet) == null ? void 0 : _c.max) != null ? _d : 0
          );
        }
      );
      for (const to of /* @__PURE__ */ new Set([legal.bet.min, ...desired, legal.bet.max])) {
        addCandidate(
          candidates,
          { type: "bet", to },
          Math.max(0, to - hero.streetCommitted)
        );
      }
    }
    if (legal.raise) {
      const potAfterCall = informationSet.pot + legal.toCall;
      const desired = [0.5, 0.8, 1.1].map(
        (fraction) => {
          var _a, _b, _c, _d;
          return clamp(
            roundChips(
              informationSet.currentBet + potAfterCall * fraction,
              Math.max(1, bigBlind / 4)
            ),
            (_b = (_a = legal.raise) == null ? void 0 : _a.minTo) != null ? _b : 0,
            (_d = (_c = legal.raise) == null ? void 0 : _c.maxTo) != null ? _d : 0
          );
        }
      );
      for (const to of /* @__PURE__ */ new Set([legal.raise.minTo, ...desired, legal.raise.maxTo])) {
        addCandidate(
          candidates,
          { type: "raise", to },
          Math.max(0, to - hero.streetCommitted)
        );
      }
    }
    if (legal.allIn) {
      const callConsumesStack = legal.allInTo <= informationSet.currentBet;
      const duplicatesExisting = [...candidates.values()].some(
        (candidate) => candidate.command.to === legal.allInTo
      );
      if (!callConsumesStack && !duplicatesExisting) {
        addCandidate(
          candidates,
          { type: "all-in" },
          Math.max(0, legal.allInTo - hero.streetCommitted)
        );
      }
    }
    return [...candidates.values()];
  }
  function foldEquityFor(candidate, informationSet, ranges, position) {
    var _a;
    if (!["bet", "raise", "all-in"].includes(candidate.command.type)) return 0;
    const opponents = informationSet.players.filter(
      (player) => player.id !== informationSet.viewerId && player.status !== "folded" && player.status !== "out" && player.status !== "all-in"
    );
    if (opponents.length === 0) return 0;
    const sizeRatio = candidate.additionalRisk / Math.max(1, informationSet.pot + candidate.additionalRisk);
    let everyoneFolds = 1;
    for (const opponent of opponents) {
      const range = ranges.find((entry) => entry.opponentId === opponent.id);
      const aggressionResistance = clamp(((_a = range == null ? void 0 : range.aggression) != null ? _a : 0) * 0.045, 0, 0.16);
      const singleFold = clamp(
        0.16 + sizeRatio * 0.62 + position * 0.07 - aggressionResistance,
        0.06,
        0.78
      );
      everyoneFolds *= singleFold;
    }
    return clamp(everyoneFolds, 0, 0.82);
  }
  function actionRole(candidate, equity, potOdds, draw, blockers) {
    if (candidate.command.type === "fold") return "fold";
    if (candidate.command.type === "check" || candidate.command.type === "call") {
      return "showdown";
    }
    if (equity >= Math.max(0.58, potOdds + 0.16)) return "value";
    if (draw >= 0.16) return "semi-bluff";
    if (blockers >= 0.08 || equity < potOdds + 0.08) return "bluff";
    return "value";
  }
  function rationaleFor(candidate, role, equity, requiredEquity, foldEquity, spr) {
    const edge = equity - requiredEquity;
    if (role === "fold") {
      return edge < 0 ? `Estimated equity trails the risk-adjusted calling threshold by ${formatFixedDecimal(Math.abs(edge * 100), 1)} points.` : "Folding preserves chips, but the modeled equity makes it a low-frequency option.";
    }
    if (candidate.command.type === "check") {
      return "Checking realizes equity without adding chips and protects the checking range.";
    }
    if (candidate.command.type === "call") {
      return `Calling compares ${formatPercentage(equity * 100, void 0, 1)} range equity with a ${formatPercentage(requiredEquity * 100, void 0, 1)} risk-adjusted threshold.`;
    }
    if (role === "value") {
      return `Value aggression leverages the equity edge at ${formatFixedDecimal(spr, 1)} SPR; modeled immediate fold equity is ${formatPercentage(foldEquity * 100, void 0, 1)}.`;
    }
    if (role === "semi-bluff") {
      return `The hand retains draw equity while fold equity of ${formatPercentage(foldEquity * 100, void 0, 1)} can win the pot immediately.`;
    }
    return `This is a mathematically mixed bluff supported by blockers/range pressure and ${formatPercentage(foldEquity * 100, void 0, 1)} modeled fold equity.`;
  }
  function scoreCandidates(candidates, informationSet, equity, potOdds, riskPremium, effectiveStack, bigBlind, position, draw, blockers, ranges) {
    const requiredEquity = clamp(potOdds + riskPremium, 0, 0.98);
    const spr = effectiveStack / Math.max(1, informationSet.pot);
    const equityEdge = equity - requiredEquity;
    return candidates.map((candidate) => {
      const type = candidate.command.type;
      const foldEquity = foldEquityFor(
        candidate,
        informationSet,
        ranges,
        position
      );
      const role = actionRole(candidate, equity, potOdds, draw, blockers);
      let chipUtility = 0;
      if (type === "fold") {
        chipUtility = 0;
        if (informationSet.currentBet === 0) chipUtility -= bigBlind * 2;
      } else if (type === "check") {
        chipUtility = equity * informationSet.pot + position * bigBlind * 0.12 + (1 - Math.min(1, draw)) * bigBlind * 0.03;
      } else if (type === "call") {
        const call = candidate.additionalRisk;
        chipUtility = equity * (informationSet.pot + call) - call - riskPremium * call * 1.8 + position * bigBlind * 0.08;
      } else {
        const wager = candidate.additionalRisk;
        const calledEquity = clamp(
          equity * (role === "bluff" ? 0.82 : 0.91) + draw * 0.05,
          0,
          1
        );
        const calledPot = informationSet.pot + wager * 2;
        chipUtility = foldEquity * informationSet.pot + (1 - foldEquity) * (calledEquity * calledPot - wager);
        chipUtility -= riskPremium * wager * (1.4 + Math.min(1, wager / Math.max(1, effectiveStack)));
        chipUtility += position * bigBlind * 0.1;
        if (role === "bluff") {
          chipUtility += blockers * bigBlind * 0.8 + draw * bigBlind * 0.5;
        }
        if (spr <= 2 && equity >= 0.55) chipUtility += bigBlind * 0.35;
        if (spr >= 8 && wager > informationSet.pot && equity < 0.7) {
          chipUtility -= bigBlind * 0.5;
        }
      }
      if (type === "call") chipUtility += equityEdge * bigBlind * 1.2;
      const utilityBigBlinds = chipUtility / bigBlind;
      return {
        id: candidate.id,
        command: { ...candidate.command },
        utilityBigBlinds,
        foldEquity,
        role,
        rationale: rationaleFor(
          candidate,
          role,
          equity,
          requiredEquity,
          foldEquity,
          spr
        )
      };
    });
  }
  function normalizedDistribution(scored, temperature) {
    if (scored.length === 0) throw new Error("No legal rational actions available");
    const maxUtility = Math.max(...scored.map((option) => option.utilityBigBlinds));
    const scale = clamp(temperature, 0.08, 3);
    const weights = scored.map(
      (option) => Math.max(1e-8, Math.exp((option.utilityBigBlinds - maxUtility) / scale))
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const distribution = scored.map((option, index) => ({
      ...option,
      probability: weights[index] / total
    }));
    const correction = 1 - distribution.reduce((sum, option) => sum + option.probability, 0);
    distribution[distribution.length - 1].probability += correction;
    return distribution;
  }
  function sampleAction(distribution, seed, handId, viewerId) {
    const random = createSeededRandom(
      deriveSeed(seed, POLICY_VERSION, handId, viewerId, "action")
    );
    let needle = random();
    for (const option of distribution) {
      needle -= option.probability;
      if (needle <= 0) return { ...option, command: { ...option.command } };
    }
    const fallback = distribution[distribution.length - 1];
    return { ...fallback, command: { ...fallback.command } };
  }
  function actionLabel(type) {
    return type === "all-in" ? "all-in" : type;
  }
  function prepareRationalDecision(input) {
    if (!Number.isSafeInteger(input.bigBlind) || input.bigBlind <= 0) {
      throw new Error("Big blind must be a positive safe integer");
    }
    const { informationSet, legalActions } = input;
    const { heroCards, opponents } = assertInformationSet(
      informationSet,
      legalActions
    );
    const hero = informationSet.players.find(
      (player) => player.id === informationSet.viewerId
    );
    if (!hero) throw new Error("Hero is missing");
    return { hero, heroCards, opponents };
  }
  function equityRequestFromPolicyInput(input) {
    var _a;
    return {
      informationSet: input.informationSet,
      legalActions: input.legalActions,
      seed: input.seed,
      simulations: (_a = input.simulations) != null ? _a : DEFAULT_SIMULATIONS,
      simulationsPerSlice: input.equitySimulationsPerSlice
    };
  }
  function decideRationalAction(input) {
    const prepared = prepareRationalDecision(input);
    const request = equityRequestFromPolicyInput(input);
    const equity = estimateRangeEquity(
      request.informationSet,
      request.legalActions,
      request.seed,
      request.simulations,
      { simulationsPerSlice: request.simulationsPerSlice }
    );
    return assembleRationalDecision(input, prepared, equity);
  }
  function assembleRationalDecision(input, prepared, equity) {
    var _a;
    const { informationSet, legalActions } = input;
    const { hero, heroCards, opponents } = prepared;
    const potOdds = legalActions.toCall > 0 ? legalActions.toCall / Math.max(1, informationSet.pot + legalActions.toCall) : 0;
    const riskPremium = tournamentRiskPremium(input.tournament, hero.stack);
    const requiredEquity = clamp(potOdds + riskPremium, 0, 0.98);
    const effectiveStack = Math.min(
      hero.stack,
      Math.max(...opponents.map((opponent) => opponent.stack))
    );
    const effectiveStackBigBlinds = effectiveStack / input.bigBlind;
    const spr = effectiveStack / Math.max(1, informationSet.pot);
    const position = positionScore(informationSet);
    const draw = drawPotential(heroCards, informationSet.board);
    const blockers = blockerScore(heroCards, informationSet.board);
    const candidates = buildCandidates(
      informationSet,
      legalActions,
      input.bigBlind
    );
    const scored = scoreCandidates(
      candidates,
      informationSet,
      equity.equity,
      potOdds,
      riskPremium,
      effectiveStack,
      input.bigBlind,
      position,
      draw,
      blockers,
      equity.opponentRanges
    );
    const distribution = normalizedDistribution(
      scored,
      (_a = input.temperature) != null ? _a : 0.48
    );
    const chosen = sampleAction(
      distribution,
      input.seed,
      informationSet.handId,
      informationSet.viewerId
    );
    const best = [...distribution].sort(
      (left, right) => right.probability - left.probability
    )[0];
    return {
      chosen,
      distribution,
      audit: {
        policyVersion: POLICY_VERSION,
        informationBoundary: "Uses only the viewer's hole cards, public board/actions/stacks, legal actions, and tournament context. Opponent cards and future deck state are not accepted by this policy contract.",
        equityWork: equity.work,
        metrics: {
          equity: equity.equity,
          potOdds,
          requiredEquity,
          equityEdge: equity.equity - requiredEquity,
          effectiveStack,
          effectiveStackBigBlinds,
          stackToPotRatio: spr,
          positionScore: position,
          inPosition: position >= 0.67,
          drawPotential: draw,
          blockerScore: blockers
        },
        adjustments: {
          tournamentRiskPremium: riskPremium,
          positionAdjustment: (position - 0.5) * 0.04,
          stackDepthAdjustment: effectiveStackBigBlinds <= 12 ? 0.04 : effectiveStackBigBlinds >= 80 ? -0.025 : 0,
          sprAdjustment: spr <= 2 ? 0.04 : spr >= 8 ? -0.025 : 0
        },
        opponentRanges: equity.opponentRanges,
        actionEvaluations: distribution.map(
          ({ id, utilityBigBlinds, foldEquity, role, rationale }) => ({
            id,
            utilityBigBlinds,
            foldEquity,
            role,
            rationale
          })
        ),
        summary: `${actionLabel(best.command.type)} is the highest-frequency action at ${formatPercentage(best.probability * 100, void 0, 0)}; estimated equity is ${formatPercentage(equity.equity * 100, void 0, 1)} versus a ${formatPercentage(requiredEquity * 100, void 0, 1)} risk-adjusted threshold.`
      }
    };
  }

  // src/modes/tournamentSession.ts
  var SESSION_TABLE_SIZE = 6;
  var SESSION_FORMAT = "compressed-six-seat";
  var DEFAULT_OPPONENTS = [
    {
      id: "maya-tempo",
      name: "Maya Chen",
      rating: 1080,
      normalProfile: "tempo"
    },
    {
      id: "rafael-pressure",
      name: "Rafael Torres",
      rating: 1125,
      normalProfile: "pressure"
    },
    {
      id: "adrian-anchor",
      name: "Adrian Cole",
      rating: 1040,
      normalProfile: "anchor"
    },
    {
      id: "juno-mirror",
      name: "Juno Pike",
      rating: 1095,
      normalProfile: "mirror"
    },
    {
      id: "lena-wide",
      name: "Lena Ortiz",
      rating: 1060,
      normalProfile: "wideLens"
    }
  ];
  function sourceQualificationRate(event) {
    switch (event.qualification.type) {
      case "win":
        return 1 / event.fieldSize;
      case "top-count":
        return Math.min(1, event.qualification.value / event.fieldSize);
      case "top-percent":
        return Math.min(1, event.qualification.value);
    }
  }
  function compressedQualifyingPlaces(event) {
    if (event.qualification.type === "win") return 1;
    return Math.max(
      1,
      Math.min(
        SESSION_TABLE_SIZE,
        Math.ceil(sourceQualificationRate(event) * SESSION_TABLE_SIZE)
      )
    );
  }
  function compressedStructure(event) {
    return {
      ...event.structure,
      id: `${event.structure.id}-six-seat`,
      name: `${event.structure.name} — Six-Seat Career`,
      maxSeats: SESSION_TABLE_SIZE,
      levels: event.structure.levels.map((level) => ({ ...level }))
    };
  }
  function qualificationLabel(event, qualifyingPlaces) {
    if (event.qualification.type === "win") return "Win the six-seat final";
    return `Finish in the top ${qualifyingPlaces} of ${SESSION_TABLE_SIZE}`;
  }
  function qualifiedEventIds(results) {
    return new Set(
      results.filter((result) => result.qualified).map((result) => result.eventId)
    );
  }
  function listTournamentSessionEvents(careerResults2 = []) {
    const qualified = qualifiedEventIds(careerResults2);
    return CAREER_EVENTS.map((event) => {
      const qualifyingPlaces = compressedQualifyingPlaces(event);
      return {
        id: event.id,
        name: event.name,
        tier: event.tier,
        sourceFieldSize: event.fieldSize,
        sessionFieldSize: SESSION_TABLE_SIZE,
        qualifyingPlaces,
        qualificationLabel: qualificationLabel(event, qualifyingPlaces),
        structure: compressedStructure(event),
        prerequisites: [...event.prerequisites],
        ratingWeight: event.ratingWeight,
        unlocked: event.prerequisites.length === 0 || event.prerequisites.every((id) => qualified.has(id)),
        format: SESSION_FORMAT,
        disclosure: `Compressed local six-seat simulation of a ${event.fieldSize}-entry career event; blind amounts and level ratios come from the published career structure.`
      };
    });
  }
  function assertEntrants(hero, opponents) {
    if (opponents.length !== SESSION_TABLE_SIZE - 1) {
      throw new Error("A six-seat session requires exactly five opponents");
    }
    const entrants = [hero, ...opponents].map((entrant) => ({ ...entrant }));
    if (new Set(entrants.map((entrant) => entrant.id)).size !== entrants.length) {
      throw new Error("Session entrant IDs must be unique");
    }
    for (const entrant of entrants) {
      if (!Number.isFinite(entrant.rating) || entrant.rating < 100 || entrant.rating > 4e3) {
        throw new Error(`Invalid tournament rating for ${entrant.id}`);
      }
    }
    return entrants;
  }
  function createTournamentSession(options) {
    var _a, _b;
    const careerResults2 = ((_a = options.careerResults) != null ? _a : []).map((result) => ({
      ...result
    }));
    const event = listTournamentSessionEvents(careerResults2).find(
      (entry) => entry.id === options.eventId
    );
    if (!event) throw new Error(`Unknown career event ${options.eventId}`);
    if (!event.unlocked) {
      throw new Error(`Career event ${options.eventId} is still locked`);
    }
    const entrants = assertEntrants(
      options.hero,
      (_b = options.opponents) != null ? _b : DEFAULT_OPPONENTS
    );
    const tournament = createTournament(
      `${options.eventId}-session`,
      event.structure,
      entrants,
      deriveSeed(options.seed, options.eventId, "tournament")
    );
    return {
      id: `${options.eventId}:${String(options.seed)}`,
      format: SESSION_FORMAT,
      mode: options.mode,
      seed: options.seed,
      event,
      heroId: options.hero.id,
      entrants,
      tournament,
      careerResults: careerResults2,
      status: "playing"
    };
  }
  function tableForSession(session) {
    const table = session.tournament.tables[0];
    if (!table) throw new Error("Session table is missing");
    return table;
  }
  function activePlayers2(session) {
    return session.tournament.players.filter((player) => player.status === "active").sort((left, right) => left.seat - right.seat);
  }
  function nextOccupiedSeat(occupiedSeats, afterSeat) {
    for (let distance = 1; distance <= SESSION_TABLE_SIZE; distance += 1) {
      const seat = (afterSeat - 1 + distance) % SESSION_TABLE_SIZE + 1;
      if (occupiedSeats.includes(seat)) return seat;
    }
    throw new Error("No occupied seat is available");
  }
  function clockwisePlayersAfter(players, afterSeat) {
    return [...players].sort((left, right) => {
      const leftDistance = (left.seat - afterSeat + SESSION_TABLE_SIZE) % SESSION_TABLE_SIZE;
      const rightDistance = (right.seat - afterSeat + SESSION_TABLE_SIZE) % SESSION_TABLE_SIZE;
      const normalizedLeft = leftDistance === 0 ? SESSION_TABLE_SIZE : leftDistance;
      const normalizedRight = rightDistance === 0 ? SESSION_TABLE_SIZE : rightDistance;
      return normalizedLeft - normalizedRight;
    });
  }
  function cloneTournament(state) {
    return {
      ...state,
      players: state.players.map((player) => ({ ...player })),
      tables: state.tables.map((table) => ({ ...table })),
      breakingOrder: [...state.breakingOrder]
    };
  }
  function postForced(stacks, totalCommitted, streetCommitted, playerId, amount, countsTowardStreet) {
    var _a, _b, _c, _d;
    const posted = Math.min((_a = stacks.get(playerId)) != null ? _a : 0, amount);
    stacks.set(playerId, ((_b = stacks.get(playerId)) != null ? _b : 0) - posted);
    totalCommitted.set(
      playerId,
      ((_c = totalCommitted.get(playerId)) != null ? _c : 0) + posted
    );
    if (countsTowardStreet) {
      streetCommitted.set(
        playerId,
        ((_d = streetCommitted.get(playerId)) != null ? _d : 0) + posted
      );
    }
    return posted;
  }
  function informationPlayers(players, betting, holeCards) {
    return players.map((player) => {
      const bettingPlayer = betting.players.find((entry) => entry.id === player.id);
      if (!bettingPlayer) throw new Error(`Missing betting state for ${player.id}`);
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        stack: bettingPlayer.stack,
        status: bettingPlayer.status,
        streetCommitted: bettingPlayer.streetCommitted,
        totalCommitted: bettingPlayer.totalCommitted,
        holeCards: holeCards[player.id].map((card) => ({ ...card }))
      };
    });
  }
  function sumCommitted(players) {
    return players.reduce((sum, player) => sum + player.totalCommitted, 0);
  }
  function beginTournamentSessionHand(source) {
    var _a;
    if (source.status !== "playing" || source.result) {
      throw new Error("Cannot start a hand in a completed session");
    }
    if (source.activeHand) throw new Error("The current hand is not complete");
    const players = activePlayers2(source);
    if (players.length < 2) throw new Error("A hand requires two active players");
    const tournament = cloneTournament(source.tournament);
    const table = tournament.tables[0];
    const occupied = players.map((player) => player.seat);
    table.buttonSeat = nextOccupiedSeat(occupied, table.buttonSeat);
    table.handNumber += 1;
    const buttonSeat = table.buttonSeat;
    const smallBlindSeat = players.length === 2 ? buttonSeat : nextOccupiedSeat(occupied, buttonSeat);
    const bigBlindSeat = nextOccupiedSeat(occupied, smallBlindSeat);
    const smallBlindPlayer = players.find(
      (player) => player.seat === smallBlindSeat
    );
    const bigBlindPlayer = players.find((player) => player.seat === bigBlindSeat);
    if (!smallBlindPlayer || !bigBlindPlayer) {
      throw new Error("Unable to assign the session blinds");
    }
    const handId = `${source.id}:hand-${table.handNumber}`;
    const deck = createShuffledDeck(
      deriveSeed(source.seed, source.event.id, handId, "deck")
    );
    const dealOrder = clockwisePlayersAfter(players, buttonSeat).map(
      (player) => player.id
    );
    const dealt = dealRoundRobin(deck, 0, dealOrder, 2);
    const level = currentBlindLevel(tournament);
    const stacks = new Map(players.map((player) => [player.id, player.stack]));
    const totalCommitted = new Map(players.map((player) => [player.id, 0]));
    const streetCommitted = new Map(players.map((player) => [player.id, 0]));
    const forcedActions = [];
    const ante = postForced(
      stacks,
      totalCommitted,
      streetCommitted,
      bigBlindPlayer.id,
      level.bigBlindAnte,
      false
    );
    if (ante > 0) {
      forcedActions.push({
        playerId: bigBlindPlayer.id,
        type: "big-blind-ante",
        amount: ante
      });
    }
    const smallBlind = postForced(
      stacks,
      totalCommitted,
      streetCommitted,
      smallBlindPlayer.id,
      level.smallBlind,
      true
    );
    forcedActions.push({
      playerId: smallBlindPlayer.id,
      type: "small-blind",
      amount: smallBlind
    });
    const bigBlind = postForced(
      stacks,
      totalCommitted,
      streetCommitted,
      bigBlindPlayer.id,
      level.bigBlind,
      true
    );
    forcedActions.push({
      playerId: bigBlindPlayer.id,
      type: "big-blind",
      amount: bigBlind
    });
    const preflopOrder = clockwisePlayersAfter(players, bigBlindSeat).map(
      (player) => player.id
    );
    const betting = createBettingRound(
      players.map((player) => ({
        id: player.id,
        stack: stacks.get(player.id),
        streetCommitted: streetCommitted.get(player.id),
        totalCommitted: totalCommitted.get(player.id),
        status: stacks.get(player.id) === 0 ? "all-in" : "active"
      })),
      preflopOrder,
      {
        minimumBet: level.bigBlind,
        nominalOpeningBet: level.bigBlind,
        lastFullRaise: level.bigBlind
      }
    );
    for (const tournamentPlayer of tournament.players) {
      if (stacks.has(tournamentPlayer.id)) {
        tournamentPlayer.stack = stacks.get(tournamentPlayer.id);
      }
    }
    const infoPlayers = informationPlayers(players, betting, dealt.hands);
    const information = {
      handId,
      street: "preflop",
      board: [],
      pot: sumCommitted(infoPlayers),
      currentBet: betting.currentBet,
      actingPlayerId: (_a = nextToAct(betting)) != null ? _a : void 0,
      buttonSeat,
      players: infoPlayers,
      actions: forcedActions
    };
    return {
      ...source,
      tournament,
      activeHand: {
        handId,
        street: "preflop",
        deck,
        deckCursor: dealt.cursor,
        board: [],
        holeCards: Object.fromEntries(
          Object.entries(dealt.hands).map(([id, cards]) => [
            id,
            cards.map((card) => ({ ...card }))
          ])
        ),
        startingStacks: Object.fromEntries(
          players.map((player) => [player.id, player.stack])
        ),
        buttonSeat,
        smallBlindPlayerId: smallBlindPlayer.id,
        bigBlindPlayerId: bigBlindPlayer.id,
        betting,
        information
      },
      lastHand: void 0
    };
  }
  function syncTournamentStacks(tournament, betting) {
    return {
      ...tournament,
      players: tournament.players.map((player) => {
        const bettingPlayer = betting.players.find(
          (entry) => entry.id === player.id
        );
        return bettingPlayer ? { ...player, stack: bettingPlayer.stack } : { ...player };
      }),
      tables: tournament.tables.map((table) => ({ ...table })),
      breakingOrder: [...tournament.breakingOrder]
    };
  }
  function syncHandInformation(hand, betting, actions) {
    var _a;
    const players = hand.information.players.map((player) => {
      const bettingPlayer = betting.players.find((entry) => entry.id === player.id);
      if (!bettingPlayer) throw new Error(`Missing betting player ${player.id}`);
      return {
        ...player,
        stack: bettingPlayer.stack,
        status: bettingPlayer.status,
        streetCommitted: bettingPlayer.streetCommitted,
        totalCommitted: bettingPlayer.totalCommitted,
        holeCards: player.holeCards.map((card) => ({ ...card }))
      };
    });
    return {
      ...hand.information,
      board: hand.board.map((card) => ({ ...card })),
      pot: sumCommitted(players),
      currentBet: betting.currentBet,
      actingPlayerId: (_a = nextToAct(betting)) != null ? _a : void 0,
      players,
      actions: actions.map((action) => ({ ...action }))
    };
  }
  function applyTournamentSessionAction(source, playerId, command) {
    const hand = source.activeHand;
    if (!hand) throw new Error("No active session hand");
    const result = applyBettingAction(hand.betting, playerId, command);
    const actions = [
      ...hand.information.actions,
      {
        playerId,
        type: result.event.type,
        amount: result.event.to
      }
    ];
    const nextHand = {
      ...hand,
      betting: result.state,
      information: hand.information
    };
    nextHand.information = syncHandInformation(nextHand, result.state, actions);
    return {
      ...source,
      tournament: syncTournamentStacks(source.tournament, result.state),
      activeHand: nextHand
    };
  }
  function nextStreet(street) {
    if (street === "preflop") return "flop";
    if (street === "flop") return "turn";
    return "river";
  }
  function dealNextStreet(hand) {
    if (hand.street === "river") {
      throw new Error("The river is already dealt");
    }
    const burn = drawCards(hand.deck, hand.deckCursor, 1);
    const street = nextStreet(hand.street);
    const count = street === "flop" ? 3 : 1;
    const cards = drawCards(hand.deck, burn.cursor, count);
    return {
      street,
      board: [...hand.board, ...cards.cards],
      cursor: cards.cursor
    };
  }
  function createPostflopBetting(session, hand) {
    const players = activePlayers2(session).filter(
      (player) => hand.betting.players.some((entry) => entry.id === player.id)
    );
    const order = clockwisePlayersAfter(players, hand.buttonSeat).map(
      (player) => player.id
    );
    const level = currentBlindLevel(session.tournament);
    return createBettingRound(
      hand.betting.players.map((player) => ({
        ...player,
        streetCommitted: 0
      })),
      order,
      { minimumBet: level.bigBlind }
    );
  }
  function awardMap(awards, refunds) {
    var _a, _b;
    const output = /* @__PURE__ */ new Map();
    for (const award of awards) {
      output.set(award.playerId, ((_a = output.get(award.playerId)) != null ? _a : 0) + award.amount);
    }
    for (const refund of refunds) {
      output.set(refund.playerId, ((_b = output.get(refund.playerId)) != null ? _b : 0) + refund.amount);
    }
    return output;
  }
  function finishScores(session, heroFinishPlace) {
    return session.entrants.filter((entrant) => entrant.id !== session.heroId).map((entrant) => {
      const tournamentPlayer = session.tournament.players.find(
        (player) => player.id === entrant.id
      );
      const opponentPlace = tournamentPlayer == null ? void 0 : tournamentPlayer.finishPlace;
      const actual = opponentPlace === void 0 || opponentPlace < heroFinishPlace ? 0 : opponentPlace === heroFinishPlace ? 0.5 : 1;
      return { id: entrant.id, rating: entrant.rating, actual };
    });
  }
  function calculatePairwiseTournamentElo(hero, opponents, ratingWeight, kFactor = 32) {
    if (opponents.length === 0) throw new Error("Pairwise Elo needs opponents");
    if (!Number.isFinite(ratingWeight) || ratingWeight <= 0) {
      throw new Error("Rating weight must be positive");
    }
    const entries = opponents.map((opponent) => {
      const expectedScore = 1 / (1 + 10 ** ((opponent.rating - hero.rating) / 400));
      const delta = kFactor * ratingWeight * (opponent.actual - expectedScore) / opponents.length;
      return {
        opponentId: opponent.id,
        opponentRating: opponent.rating,
        expectedScore,
        actualScore: opponent.actual,
        delta
      };
    });
    return {
      heroId: hero.id,
      heroRating: hero.rating,
      kFactor,
      ratingWeight,
      entries,
      totalDelta: Math.round(
        entries.reduce((sum, entry) => sum + entry.delta, 0)
      )
    };
  }
  function ordinalSuffix(place) {
    const modulo100 = place % 100;
    if (modulo100 >= 11 && modulo100 <= 13) return "th";
    switch (place % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  }
  function createSessionResult(session, finishPlace) {
    var _a;
    const hero = session.entrants.find((entrant) => entrant.id === session.heroId);
    if (!hero) throw new Error("Session hero is missing");
    const qualifyingPlaces = session.event.qualifyingPlaces;
    const elo = calculatePairwiseTournamentElo(
      hero,
      finishScores(session, finishPlace),
      session.event.ratingWeight
    );
    const careerResult = {
      eventId: session.event.id,
      finishPlace,
      fieldSize: SESSION_TABLE_SIZE,
      sourceFieldSize: session.event.sourceFieldSize,
      qualifyingPlaces,
      qualified: finishPlace <= qualifyingPlaces,
      tournamentEloDelta: elo.totalDelta
    };
    const previousUnlocked = new Set(
      listTournamentSessionEvents(session.careerResults).filter((event) => event.unlocked).map((event) => event.id)
    );
    const resultsAfterEvent = [
      ...session.careerResults.filter(
        (entry) => entry.eventId !== careerResult.eventId
      ),
      careerResult
    ];
    const unlockedEventIds = listTournamentSessionEvents(resultsAfterEvent).filter((event) => event.unlocked).map((event) => event.id);
    const newlyUnlockedEventIds = unlockedEventIds.filter(
      (eventId) => !previousUnlocked.has(eventId)
    );
    const nextEventId = (_a = CAREER_EVENTS.find(
      (event) => unlockedEventIds.includes(event.id) && !resultsAfterEvent.some((result) => result.eventId === event.id)
    )) == null ? void 0 : _a.id;
    return {
      heroId: hero.id,
      ...careerResult,
      eventName: session.event.name,
      handNumber: tableForSession(session).handNumber,
      elo,
      placementLabel: `${finishPlace}${ordinalSuffix(finishPlace)} of ${SESSION_TABLE_SIZE}`,
      qualificationLabel: finishPlace <= qualifyingPlaces ? "Qualified for the next Grand Prix event" : `Needed top ${qualifyingPlaces} to qualify`,
      unlockedEventIds,
      newlyUnlockedEventIds,
      ...nextEventId ? { nextEventId } : {}
    };
  }
  function settleTournamentSessionHand(source) {
    const hand = source.activeHand;
    if (!hand) throw new Error("No active session hand");
    if (!hand.betting.complete) {
      throw new Error("Cannot settle while betting is still open");
    }
    const live = hand.betting.players.filter(
      (player) => player.status !== "folded"
    );
    if (live.length > 1 && hand.board.length !== 5) {
      throw new Error("A contested pot requires a complete board");
    }
    const built = buildPots(
      hand.betting.players.map((player) => ({
        playerId: player.id,
        amount: player.totalCommitted,
        folded: player.status === "folded"
      }))
    );
    const seats = Object.fromEntries(
      hand.information.players.map((player) => [player.id, player.seat])
    );
    const resolved = resolvePots(built.pots, {
      board: hand.board,
      holeCards: hand.holeCards,
      seats,
      buttonSeat: hand.buttonSeat,
      tableSize: SESSION_TABLE_SIZE,
      smallestChip: 1
    });
    const winnings = awardMap(resolved.awards, built.refunds);
    let tournament = cloneTournament(source.tournament);
    tournament.players = tournament.players.map((player) => {
      var _a;
      return {
        ...player,
        stack: player.stack + ((_a = winnings.get(player.id)) != null ? _a : 0)
      };
    });
    const eliminated = tournament.players.filter(
      (player) => player.status === "active" && player.stack === 0
    );
    if (eliminated.length > 0) {
      tournament = recordEliminations(
        tournament,
        eliminated.map((player) => ({
          playerId: player.id,
          handId: hand.handId,
          tableId: player.tableId,
          startedHandWith: hand.startingStacks[player.id]
        }))
      );
    }
    let next = {
      ...source,
      tournament,
      activeHand: void 0,
      lastHand: {
        handId: hand.handId,
        board: hand.board.map((card) => ({ ...card })),
        pots: built.pots.map((pot) => ({
          ...pot,
          contributorIds: [...pot.contributorIds],
          eligiblePlayerIds: [...pot.eligiblePlayerIds]
        })),
        awards: resolved.awards.map((award) => ({ ...award })),
        eliminatedPlayerIds: eliminated.map((player) => player.id)
      }
    };
    const heroState = tournament.players.find(
      (player) => player.id === source.heroId
    );
    if (!heroState) throw new Error("Hero tournament state is missing");
    if (heroState.finishPlace !== void 0) {
      const result = createSessionResult(next, heroState.finishPlace);
      next = {
        ...next,
        status: "complete",
        result,
        careerResults: [
          ...source.careerResults.filter(
            (entry) => entry.eventId !== result.eventId
          ),
          {
            eventId: result.eventId,
            finishPlace: result.finishPlace,
            fieldSize: result.fieldSize,
            sourceFieldSize: result.sourceFieldSize,
            qualifyingPlaces: result.qualifyingPlaces,
            qualified: result.qualified,
            tournamentEloDelta: result.tournamentEloDelta
          }
        ]
      };
    }
    return next;
  }
  function progressTournamentSessionHand(source) {
    const hand = source.activeHand;
    if (!hand) throw new Error("No active session hand");
    if (!hand.betting.complete) {
      throw new Error("Betting must complete before progressing the hand");
    }
    if (hand.betting.handComplete || hand.street === "river") {
      return settleTournamentSessionHand(source);
    }
    const dealt = dealNextStreet(hand);
    const staged = {
      ...hand,
      street: dealt.street,
      board: dealt.board,
      deckCursor: dealt.cursor,
      information: {
        ...hand.information,
        street: dealt.street,
        board: dealt.board.map((card) => ({ ...card }))
      }
    };
    const betting = createPostflopBetting(source, staged);
    const actions = [
      ...staged.information.actions,
      { playerId: "dealer", type: dealt.street }
    ];
    const information = syncHandInformation(staged, betting, actions);
    return {
      ...source,
      activeHand: {
        ...staged,
        betting,
        information: {
          ...information,
          street: dealt.street,
          board: dealt.board.map((card) => ({ ...card }))
        }
      }
    };
  }
  function advanceTournamentSessionClock(source, elapsedMs) {
    return {
      ...source,
      tournament: advanceTournamentClock(source.tournament, elapsedMs)
    };
  }
  function mapRationalRole(role) {
    switch (role) {
      case "showdown":
        return "defense";
      case "value":
        return "value";
      case "semi-bluff":
        return "semi-bluff";
      case "bluff":
        return "bluff";
      case "fold":
        return "neutral";
    }
  }
  function policyInformation(session, playerId) {
    const hand = session.activeHand;
    if (!hand) throw new Error("No active session hand");
    if (nextToAct(hand.betting) !== playerId) {
      throw new Error(`It is not ${playerId}'s turn`);
    }
    return {
      hand,
      informationSet: createInformationSet(hand.information, playerId),
      legalActions: getLegalActions(hand.betting, playerId),
      level: currentBlindLevel(session.tournament)
    };
  }
  function sessionPolicyContext(session, playerId, options) {
    const { hand, informationSet, legalActions, level } = policyInformation(
      session,
      playerId
    );
    const active = session.tournament.players.filter(
      (player) => player.status === "active"
    );
    const rationalInput = {
      informationSet,
      legalActions,
      bigBlind: level.bigBlind,
      seed: deriveSeed(session.seed, hand.handId, playerId, "rational-policy"),
      simulations: options.simulations,
      temperature: options.temperature,
      tournament: {
        playersRemaining: active.length,
        placesToQualification: session.event.qualifyingPlaces,
        averageStack: active.reduce((sum, player) => sum + player.stack, 0) / Math.max(1, active.length)
      }
    };
    return { rationalInput, hand, informationSet, legalActions, level };
  }
  function assembleSessionPolicyDecision(session, playerId, rational, context) {
    var _a;
    const { hand, informationSet, legalActions, level } = context;
    if (session.mode === "rational") {
      return {
        mode: "rational",
        command: { ...rational.chosen.command },
        rational
      };
    }
    const entrant = session.entrants.find((entry) => entry.id === playerId);
    const profile = (_a = entrant == null ? void 0 : entrant.normalProfile) != null ? _a : "tempo";
    const evaluations = rational.distribution.map(
      (option) => ({
        command: { ...option.command },
        estimatedEv: option.utilityBigBlinds * level.bigBlind,
        purpose: mapRationalRole(option.role)
      })
    );
    const normal = decideNormalAction({
      informationSet,
      legalActions,
      evaluations,
      profile,
      bigBlind: level.bigBlind,
      seed: deriveSeed(session.seed, hand.handId, playerId, "normal-policy"),
      decisionIndex: hand.information.actions.length
    });
    return {
      mode: "normal",
      command: { ...normal.command },
      normal,
      rationalBaseline: rational
    };
  }
  function chooseTournamentSessionPolicyAction(session, playerId, options = {}) {
    const context = sessionPolicyContext(session, playerId, options);
    const rational = decideRationalAction(context.rationalInput);
    return assembleSessionPolicyDecision(session, playerId, rational, context);
  }
  function tableOrderForSnapshot(session, viewerId) {
    const viewer = session.tournament.players.find(
      (player) => player.id === viewerId
    );
    if (!viewer || viewer.seat === void 0) {
      throw new Error(`Viewer ${viewerId} is not seated`);
    }
    const viewerSeat = viewer.seat;
    return [...session.tournament.players].sort((left, right) => {
      if (left.id === viewerId) return -1;
      if (right.id === viewerId) return 1;
      const leftDistance = (left.seat - viewerSeat + SESSION_TABLE_SIZE) % SESSION_TABLE_SIZE || SESSION_TABLE_SIZE;
      const rightDistance = (right.seat - viewerSeat + SESSION_TABLE_SIZE) % SESSION_TABLE_SIZE || SESSION_TABLE_SIZE;
      return leftDistance - rightDistance;
    });
  }
  function createPokerTableSnapshot(session, viewerId = session.heroId) {
    var _a;
    const hand = session.activeHand;
    if (!hand) throw new Error("No active session hand");
    const informationSet = createInformationSet(hand.information, viewerId);
    const ordered = tableOrderForSnapshot(session, viewerId);
    const level = currentBlindLevel(session.tournament);
    const viewerHand = informationSet.players.find(
      (player) => player.id === viewerId
    );
    if (!(viewerHand == null ? void 0 : viewerHand.holeCards) || viewerHand.holeCards.length !== 2) {
      throw new Error("PokerTable viewer requires two private cards");
    }
    const viewerHoleCards = viewerHand.holeCards;
    const actingId = nextToAct(hand.betting);
    const actor = actingId ? informationSet.players.find((player) => player.id === actingId) : void 0;
    const viewerBetting = hand.betting.players.find(
      (player) => player.id === viewerId
    );
    if (!viewerBetting) throw new Error("Viewer betting state is missing");
    const toCall = Math.max(0, hand.betting.currentBet - viewerBetting.streetCommitted);
    const players = ordered.map((tournamentPlayer, index) => {
      var _a2, _b;
      const handPlayer = informationSet.players.find(
        (player) => player.id === tournamentPlayer.id
      );
      return {
        id: tournamentPlayer.id,
        name: tournamentPlayer.name,
        stack: tournamentPlayer.stack,
        seat: index,
        status: tournamentPlayer.status === "eliminated" ? "out" : (_a2 = handPlayer == null ? void 0 : handPlayer.status) != null ? _a2 : "out",
        bet: (_b = handPlayer == null ? void 0 : handPlayer.streetCommitted) != null ? _b : 0,
        ...tournamentPlayer.id === viewerId ? { cards: viewerHoleCards.map((card) => ({ ...card })) } : {}
      };
    });
    const buttonIndex = ordered.findIndex(
      (player) => player.seat === hand.buttonSeat
    );
    const recommendedAction = toCall > 0 ? "call" : "check";
    return {
      id: hand.handId,
      title: `${session.event.name} · Hand ${tableForSession(session).handNumber}`,
      difficulty: session.event.tier === "local" ? 2 : session.event.tier === "regional" ? 3 : session.event.tier === "world" ? 5 : 4,
      street: hand.street,
      blinds: [level.smallBlind, level.bigBlind],
      ante: level.bigBlindAnte,
      heroSeat: 0,
      buttonSeat: Math.max(0, buttonIndex),
      pot: hand.information.pot,
      amountToCall: toCall,
      minimumRaise: hand.betting.currentBet === 0 ? level.bigBlind : hand.betting.currentBet + hand.betting.lastFullRaise,
      heroCards: viewerHoleCards.map((card) => ({ ...card })),
      board: hand.board.map((card) => ({ ...card })),
      players,
      prompt: actingId ? `${(_a = actor == null ? void 0 : actor.name) != null ? _a : actingId} is deciding.` : "Betting is complete. Continue the hand.",
      recommendedAction,
      actionReason: "Tournament decisions are supplied by the selected information-set policy.",
      mathQuestion: {
        topic: "pot-odds",
        prompt: "Compatibility field; hidden outside Training mode.",
        unit: "chips",
        correctValue: toCall,
        tolerance: 0,
        explanation: "Tournament mode uses the live policy audit instead."
      },
      tags: [
        "tournament",
        session.mode,
        session.event.tier,
        SESSION_FORMAT
      ]
    };
  }

  // src/modes/timedBlindDirector.ts
  var MIN_DURATION_MINUTES = 5;
  var MAX_DURATION_MINUTES = 180;
  function assertPositiveInteger(value, label) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive integer.`);
    }
  }
  function smoothstep(value) {
    const clamped = Math.max(0, Math.min(1, value));
    return clamped * clamped * (3 - 2 * clamped);
  }
  function friendlyStep(value) {
    if (value < 500) return 25;
    if (value < 2e3) return 50;
    if (value < 1e4) return 100;
    if (value < 5e4) return 500;
    return 1e3;
  }
  function roundUpFriendly(value) {
    const safe = Math.max(1, value);
    const step = friendlyStep(safe);
    return Math.ceil(safe / step) * step;
  }
  function phaseForProgress(progress) {
    if (progress >= 1) return "deadline";
    if (progress < 0.25) return "opening";
    if (progress < 0.72) return "pressure";
    return "closing";
  }
  function reviewCadenceMs(durationMs, phase) {
    const normalCadence = Math.max(
      2e4,
      Math.min(9e4, Math.round(durationMs / 24))
    );
    if (phase === "opening") return normalCadence;
    if (phase === "pressure") return Math.max(15e3, normalCadence * 0.8);
    if (phase === "closing") return Math.max(1e4, normalCadence * 0.55);
    return Math.max(5e3, normalCadence * 0.3);
  }
  function directTimedBlinds(input) {
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < MIN_DURATION_MINUTES || input.durationMinutes > MAX_DURATION_MINUTES) {
      throw new Error(
        `durationMinutes must be an integer from ${MIN_DURATION_MINUTES} to ${MAX_DURATION_MINUTES}.`
      );
    }
    if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) {
      throw new Error("elapsedMs must be a non-negative finite number.");
    }
    assertPositiveInteger(input.current.smallBlind, "smallBlind");
    assertPositiveInteger(input.current.bigBlind, "bigBlind");
    assertPositiveInteger(input.current.bigBlindAnte, "bigBlindAnte");
    assertPositiveInteger(input.startingTotalChips, "startingTotalChips");
    const liveStacks = input.players.filter((player) => !player.eliminated && player.stack > 0).map((player) => {
      assertPositiveInteger(player.stack, `stack for ${player.id}`);
      return player.stack;
    }).sort((left, right) => right - left);
    const durationMs = input.durationMinutes * 6e4;
    const progress = input.elapsedMs / durationMs;
    const phase = phaseForProgress(progress);
    const currentBigBlind = input.current.bigBlind;
    const currentSmallBlind = input.current.smallBlind;
    const nextReviewMs = reviewCadenceMs(durationMs, phase);
    if (liveStacks.length <= 1) {
      return {
        ...input.current,
        phase,
        progress,
        livePlayers: liveStacks.length,
        nextReviewMs,
        forcedAllInStack: null,
        reason: "The table is complete, so the blind level is held."
      };
    }
    const chipsInPlay = liveStacks.reduce((sum, stack) => sum + stack, 0);
    const averageStack = chipsInPlay / liveStacks.length;
    const secondLargestStack = liveStacks[1];
    let targetBigBlind = currentBigBlind;
    let reason = "Opening levels are intentionally stable so the table begins like normal tournament poker.";
    if (phase === "pressure") {
      const pressureProgress = smoothstep((progress - 0.25) / 0.47);
      const desiredAverageBigBlinds = 42 - pressureProgress * 26;
      const stackTarget = averageStack / desiredAverageBigBlinds;
      const populationPressure = 1 + Math.max(0, liveStacks.length - 3) * 0.055 * pressureProgress;
      targetBigBlind = stackTarget * populationPressure;
      reason = "Blinds rise gradually from public time, field size, and the average live stack.";
    } else if (phase === "closing") {
      const closingProgress = smoothstep((progress - 0.72) / 0.28);
      const desiredAverageBigBlinds = 14 - closingProgress * 10;
      const stackTarget = averageStack / desiredAverageBigBlinds;
      const deadlineTarget = currentBigBlind + (secondLargestStack - currentBigBlind) * Math.pow(closingProgress, 1.65);
      targetBigBlind = Math.max(stackTarget, deadlineTarget);
      reason = "Closing pressure accelerates toward the second-largest stack without decreasing the current level.";
    } else if (phase === "deadline") {
      targetBigBlind = secondLargestStack;
      reason = "The deadline safety level covers the second-largest stack, forcing every player except the chip leader all-in.";
    }
    if (phase !== "deadline") {
      const jumpCap = phase === "opening" ? currentBigBlind : currentBigBlind * (phase === "pressure" ? 2 : 3);
      targetBigBlind = Math.min(targetBigBlind, jumpCap);
    }
    const bigBlind = Math.max(currentBigBlind, roundUpFriendly(targetBigBlind));
    const smallBlind = Math.max(
      currentSmallBlind,
      roundUpFriendly(bigBlind / 2)
    );
    const bigBlindAnte = Math.max(input.current.bigBlindAnte, bigBlind);
    return {
      smallBlind,
      bigBlind,
      bigBlindAnte,
      phase,
      progress,
      livePlayers: liveStacks.length,
      nextReviewMs,
      forcedAllInStack: phase === "deadline" ? secondLargestStack : null,
      reason
    };
  }

  // src/modes/tournamentRunner.ts
  function timedStartingTotal(session) {
    return session.tournament.players.reduce(
      (sum, player) => sum + player.stack,
      0
    );
  }
  function createCareerTournamentRunner(options) {
    return {
      kind: "career",
      session: createTournamentSession(options),
      sequence: 0,
      decisions: [],
      replayActions: []
    };
  }
  function createTimedTournamentRunner(options) {
    var _a;
    const session = createTournamentSession({
      eventId: "local-qualifier",
      hero: options.hero,
      mode: "normal",
      seed: options.seed,
      opponents: options.opponents,
      careerResults: []
    });
    const renamed = {
      ...session,
      event: {
        ...session.event,
        name: `${options.minutes}-Minute Timed Table`,
        qualificationLabel: "One table · No career progression",
        prerequisites: []
      },
      careerResults: []
    };
    return {
      kind: "timed",
      session: renamed,
      sequence: 0,
      decisions: [],
      replayActions: [],
      timed: {
        durationMinutes: options.minutes,
        startedAtMs: (_a = options.nowMs) != null ? _a : Date.now(),
        startingTotalChips: timedStartingTotal(renamed)
      }
    };
  }
  function sanitizeTimedCompletion(runner) {
    var _a, _b;
    if (runner.kind !== "timed" || runner.session.status !== "complete" || !runner.session.result) {
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
          eventName: `${(_b = (_a = runner.timed) == null ? void 0 : _a.durationMinutes) != null ? _b : 0}-Minute Timed Table`,
          qualified: result.finishPlace === 1,
          qualificationLabel: result.finishPlace === 1 ? "Timed table won" : "Timed table complete",
          unlockedEventIds: [],
          newlyUnlockedEventIds: [],
          nextEventId: void 0
        }
      }
    };
  }
  function applyTimedBlindLevel(runner, nowMs) {
    if (runner.kind !== "timed" || !runner.timed || runner.session.activeHand) {
      return runner;
    }
    const current = runner.session.tournament.structure.levels[runner.session.tournament.levelIndex];
    const decision = directTimedBlinds({
      durationMinutes: runner.timed.durationMinutes,
      elapsedMs: Math.max(0, nowMs - runner.timed.startedAtMs),
      current: {
        smallBlind: current.smallBlind,
        bigBlind: current.bigBlind,
        bigBlindAnte: current.bigBlindAnte
      },
      players: runner.session.tournament.players.map((player) => ({
        id: player.id,
        stack: player.stack,
        eliminated: player.status === "eliminated"
      })),
      startingTotalChips: runner.timed.startingTotalChips
    });
    const levels = runner.session.tournament.structure.levels.map(
      (level, index) => index === runner.session.tournament.levelIndex ? {
        ...level,
        smallBlind: decision.smallBlind,
        bigBlind: decision.bigBlind,
        bigBlindAnte: decision.bigBlindAnte
      } : { ...level }
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
            levels
          }
        }
      }
    };
  }
  function heroTournamentLegalActions(runner) {
    const hand = runner.session.activeHand;
    if (!hand || hand.betting.complete) return null;
    if (nextToAct(hand.betting) !== runner.session.heroId) return null;
    return getLegalActions(hand.betting, runner.session.heroId);
  }
  function tournamentCommandForHeroAction(legal, request) {
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
  function advanceTournamentRunnerToHero(source, options = {}) {
    var _a, _b;
    const maxSteps = (_a = options.maxSteps) != null ? _a : 2500;
    const nowMs = (_b = options.nowMs) != null ? _b : Date.now();
    let runner = source;
    for (let step = 0; step < maxSteps; step += 1) {
      runner = sanitizeTimedCompletion(runner);
      if (runner.session.status === "complete") return runner;
      if (!runner.session.activeHand) {
        runner = applyTimedBlindLevel(runner, nowMs);
        runner = {
          ...runner,
          session: beginTournamentSessionHand(runner.session)
        };
        continue;
      }
      const hand = runner.session.activeHand;
      if (hand.betting.complete) {
        runner = {
          ...runner,
          session: progressTournamentSessionHand(runner.session)
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
        options.policy
      );
      const nextSession = applyTournamentSessionAction(
        runner.session,
        actor,
        policy.command
      );
      const elapsed = 1500 + runner.sequence * 977 % 2750;
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
            policy: policy.mode
          }
        ]
      };
    }
    throw new Error(`Tournament runner exceeded ${maxSteps} automatic steps`);
  }
  function applyHeroTournamentAction(source, request, options = {}) {
    var _a, _b, _c;
    const legal = heroTournamentLegalActions(source);
    if (!legal) throw new Error("The tournament is not waiting for the hero");
    const nowMs = (_a = options.nowMs) != null ? _a : Date.now();
    const command = tournamentCommandForHeroAction(legal, request);
    const handId = (_b = source.session.activeHand) == null ? void 0 : _b.handId;
    if (!handId) throw new Error("The tournament hand is missing");
    const acted = applyTournamentSessionAction(
      source.session,
      source.session.heroId,
      command
    );
    const elapsed = Math.max(0, (_c = request.decisionElapsedMs) != null ? _c : 0);
    const runner = {
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
          policy: source.session.mode
        }
      ],
      replayActions: [
        ...source.replayActions,
        { request: { ...request }, nowMs }
      ]
    };
    return advanceTournamentRunnerToHero(runner, { ...options, nowMs });
  }
  function createTournamentRunnerReplay(runner, policySimulations = 60) {
    const hero = runner.session.entrants.find(
      (entrant) => entrant.id === runner.session.heroId
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
        ...level
      })),
      actions: runner.replayActions.map((entry) => ({
        request: { ...entry.request },
        nowMs: entry.nowMs
      })),
      ...runner.kind === "timed" && runner.timed ? {
        timed: {
          durationMinutes: runner.timed.durationMinutes,
          startedAtMs: runner.timed.startedAtMs
        }
      } : {}
    };
  }
  function restoreTournamentRunnerReplay(replay) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (replay.format !== "poker-training-pro-tournament-replay" || replay.version !== 1 || !Number.isInteger(replay.policySimulations) || replay.policySimulations < 1) {
      throw new Error("Unsupported tournament replay");
    }
    const firstNowMs = (_d = (_c = (_a = replay.timed) == null ? void 0 : _a.startedAtMs) != null ? _c : (_b = replay.actions[0]) == null ? void 0 : _b.nowMs) != null ? _d : Date.now();
    let runner = replay.kind === "timed" ? createTimedTournamentRunner({
      minutes: (_f = (_e = replay.timed) == null ? void 0 : _e.durationMinutes) != null ? _f : 30,
      hero: { ...replay.hero },
      seed: replay.seed,
      nowMs: (_h = (_g = replay.timed) == null ? void 0 : _g.startedAtMs) != null ? _h : firstNowMs
    }) : createCareerTournamentRunner({
      eventId: replay.eventId,
      hero: { ...replay.hero },
      mode: replay.mode,
      seed: replay.seed,
      careerResults: replay.careerResults
    });
    runner = advanceTournamentRunnerToHero(runner, {
      nowMs: firstNowMs,
      policy: { simulations: replay.policySimulations }
    });
    for (const entry of replay.actions) {
      if (runner.session.status === "complete") break;
      runner = applyHeroTournamentAction(runner, entry.request, {
        nowMs: entry.nowMs,
        policy: { simulations: replay.policySimulations }
      });
    }
    return runner;
  }

  // ios/tournament-session-engine-entry.ts
  var simulations = 60;
  if (typeof globalThis.structuredClone !== "function") {
    Object.defineProperty(globalThis, "structuredClone", {
      value: (value) => JSON.parse(JSON.stringify(value)),
      configurable: true
    });
  }
  function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Tournament request payload must be an object");
    }
    return value;
  }
  function number(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function careerResults(value) {
    return Array.isArray(value) ? value : [];
  }
  function runnerResponse(runner) {
    const replay = createTournamentRunnerReplay(runner, simulations);
    const complete = runner.session.status === "complete";
    return {
      replay,
      complete,
      ...complete ? { result: runner.session.result } : {},
      ...!complete && runner.session.activeHand ? {
        table: createPokerTableSnapshot(runner.session),
        legalActions: heroTournamentLegalActions(runner)
      } : {}
    };
  }
  function create(payload) {
    var _a, _b;
    const hero = asObject(payload.hero);
    const seed = String((_a = payload.seed) != null ? _a : "ios-session");
    const nowMs = number(payload.nowMs, 0);
    const runner = payload.kind === "timed" ? createTimedTournamentRunner({
      minutes: Math.max(5, Math.min(180, Math.trunc(number(payload.minutes, 30)))),
      hero: { id: String(hero.id), name: String(hero.name), rating: number(hero.rating, 1200) },
      seed,
      nowMs
    }) : createCareerTournamentRunner({
      eventId: String((_b = payload.eventId) != null ? _b : "local-qualifier"),
      hero: { id: String(hero.id), name: String(hero.name), rating: number(hero.rating, 1200) },
      mode: payload.mode === "rational" ? "rational" : "normal",
      seed,
      careerResults: careerResults(payload.careerResults)
    });
    return runnerResponse(advanceTournamentRunnerToHero(runner, { nowMs, policy: { simulations } }));
  }
  function act(payload) {
    const replay = payload.replay;
    const action = String(payload.action);
    const runner = restoreTournamentRunnerReplay(replay);
    const next = applyHeroTournamentAction(runner, {
      action,
      ...typeof payload.raiseTo === "number" ? { raiseTo: payload.raiseTo } : {},
      decisionElapsedMs: Math.max(0, Math.trunc(number(payload.decisionElapsedMs, 0)))
    }, { nowMs: number(payload.nowMs, 0), policy: { simulations } });
    return runnerResponse(next);
  }
  function invoke(request) {
    var _a;
    const payload = (_a = request.payload) != null ? _a : {};
    if (request.operation === "createTournament") return create(payload);
    if (request.operation === "actTournament") return act(payload);
    throw new Error(`Unsupported tournament operation: ${request.operation}`);
  }
  globalThis.PokerTrainingProTournamentEngine = { invoke };
})();
