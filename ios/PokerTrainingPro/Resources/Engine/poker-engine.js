(function (root) {
  "use strict";

  // Poker Training Pro — mobile shared-engine bundle.
  //
  // Browserless, self-contained, ES5-compatible IIFE for JavaScriptCore. It
  // mirrors the deterministic desktop TypeScript engine primitives so the iOS
  // app preserves the same backend behavior on-device: deck/deal, hand
  // evaluation, Training quiz parsing and grading, Decision/Math Elo, the AI
  // decision timing model, the Timed Table blind director, and capped
  // range-equity work used by the Normal and Rational bot decisions.
  //
  // No Math.random() is used for gameplay. All randomness derives from the
  // request seed. There are no timers, storage, DOM, or network calls.

  var CONTRACT_VERSION = "1.0.0";
  var ENGINE_VERSION = "mobile-engine-1";
  var SUITS = ["clubs", "diamonds", "hearts", "spades"];
  var RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  var RANK_VALUE = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    T: 10, J: 11, Q: 12, K: 13, A: 14
  };

  // Conservative per-decision equity caps tuned for phones. These are lower
  // than the desktop ceiling (1,200) so a single decision cannot stall a
  // touch frame, spike thermals, or drain battery. A caller may lower them
  // but never raise them past MAX_MOBILE_SIMULATIONS.
  var DEFAULT_MOBILE_SIMULATIONS = 240;
  var MAX_MOBILE_SIMULATIONS = 600;
  var DEFAULT_SIMULATIONS_PER_SLICE = 16;
  var MAX_SIMULATIONS_PER_SLICE = 32;

  // ---------------------------------------------------------------------------
  // Deterministic RNG — FNV-1a hash + Mulberry32, byte-identical to src/engine.
  // ---------------------------------------------------------------------------

  function hashSeed(seed) {
    var input = String(seed);
    var hash = 0x811c9dc5;
    for (var index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function createSeededRandom(seed) {
    var state = hashSeed(seed);
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function deriveSeed(base) {
    var parts = [String(base)];
    for (var i = 1; i < arguments.length; i += 1) {
      parts.push(String(arguments[i]));
    }
    return parts.join(":");
  }

  function createDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s += 1) {
      for (var r = 0; r < RANKS.length; r += 1) {
        deck.push({ rank: RANKS[r], suit: SUITS[s] });
      }
    }
    return deck;
  }

  function cardKey(card) {
    return card.rank + ":" + card.suit;
  }

  function shuffleDeck(cards, random) {
    var shuffled = [];
    for (var i = 0; i < cards.length; i += 1) {
      shuffled.push({ rank: cards[i].rank, suit: cards[i].suit });
    }
    for (var index = shuffled.length - 1; index > 0; index -= 1) {
      var swapIndex = Math.floor(random() * (index + 1));
      var temporary = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = temporary;
    }
    return shuffled;
  }

  // ---------------------------------------------------------------------------
  // Hand evaluator — mirrors src/engine/evaluator.ts.
  // ---------------------------------------------------------------------------

  var HAND_CATEGORY = {
    HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2, THREE_OF_A_KIND: 3, STRAIGHT: 4,
    FLUSH: 5, FULL_HOUSE: 6, FOUR_OF_A_KIND: 7, STRAIGHT_FLUSH: 8
  };
  var CATEGORY_NAMES = [
    "high-card", "one-pair", "two-pair", "three-of-a-kind", "straight",
    "flush", "full-house", "four-of-a-kind", "straight-flush"
  ];
  var DISPLAY_NAMES = [
    "High Card", "One Pair", "Two Pair", "Three of a Kind", "Straight",
    "Flush", "Full House", "Four of a Kind", "Straight Flush"
  ];

  function rankValueOf(card) {
    return RANK_VALUE[card.rank];
  }

  function compareNumberArrays(left, right) {
    var length = Math.max(left.length, right.length);
    for (var index = 0; index < length; index += 1) {
      var l = index < left.length ? left[index] : 0;
      var r = index < right.length ? right[index] : 0;
      var difference = l - r;
      if (difference !== 0) return difference > 0 ? 1 : -1;
    }
    return 0;
  }

  function straightHigh(values) {
    var seen = {};
    var unique = [];
    for (var i = 0; i < values.length; i += 1) {
      if (!seen[values[i]]) {
        seen[values[i]] = true;
        unique.push(values[i]);
      }
    }
    unique.sort(function (a, b) { return b - a; });
    if (seen[14]) unique.push(1);
    for (var index = 0; index <= unique.length - 5; index += 1) {
      var start = unique[index];
      if (
        unique[index + 1] === start - 1 &&
        unique[index + 2] === start - 2 &&
        unique[index + 3] === start - 3 &&
        unique[index + 4] === start - 4
      ) {
        return start;
      }
    }
    return null;
  }

  function makeValue(category, tiebreak, cards) {
    var royal = category === HAND_CATEGORY.STRAIGHT_FLUSH && tiebreak[0] === 14;
    var copied = [];
    for (var i = 0; i < cards.length; i += 1) {
      copied.push({ rank: cards[i].rank, suit: cards[i].suit });
    }
    return {
      category: category,
      categoryName: CATEGORY_NAMES[category],
      displayName: royal ? "Royal Flush" : DISPLAY_NAMES[category],
      tiebreak: tiebreak,
      cards: copied
    };
  }

  function evaluateFive(cards) {
    if (cards.length !== 5) throw new Error("evaluateFive requires exactly five cards");
    var values = [];
    for (var i = 0; i < cards.length; i += 1) values.push(rankValueOf(cards[i]));
    values.sort(function (a, b) { return b - a; });
    var flush = true;
    for (var f = 1; f < cards.length; f += 1) {
      if (cards[f].suit !== cards[0].suit) { flush = false; break; }
    }
    var highStraight = straightHigh(values);

    if (flush && highStraight !== null) {
      return makeValue(HAND_CATEGORY.STRAIGHT_FLUSH, [highStraight], cards);
    }

    var counts = {};
    for (var c = 0; c < values.length; c += 1) {
      counts[values[c]] = (counts[values[c]] || 0) + 1;
    }
    var groups = [];
    for (var key in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, key)) {
        groups.push([Number(key), counts[key]]);
      }
    }
    groups.sort(function (a, b) {
      return b[1] - a[1] || b[0] - a[0];
    });

    if (groups[0][1] === 4) {
      return makeValue(HAND_CATEGORY.FOUR_OF_A_KIND, [groups[0][0], groups[1][0]], cards);
    }
    if (groups[0][1] === 3 && groups[1][1] === 2) {
      return makeValue(HAND_CATEGORY.FULL_HOUSE, [groups[0][0], groups[1][0]], cards);
    }
    if (flush) {
      return makeValue(HAND_CATEGORY.FLUSH, values, cards);
    }
    if (highStraight !== null) {
      return makeValue(HAND_CATEGORY.STRAIGHT, [highStraight], cards);
    }
    if (groups[0][1] === 3) {
      var tripsKickers = [];
      for (var g = 1; g < groups.length; g += 1) tripsKickers.push(groups[g][0]);
      tripsKickers.sort(function (a, b) { return b - a; });
      return makeValue(HAND_CATEGORY.THREE_OF_A_KIND, [groups[0][0]].concat(tripsKickers), cards);
    }
    var pairs = [];
    for (var p = 0; p < groups.length; p += 1) {
      if (groups[p][1] === 2) pairs.push(groups[p][0]);
    }
    pairs.sort(function (a, b) { return b - a; });
    if (pairs.length === 2) {
      var kicker = 0;
      for (var k = 0; k < groups.length; k += 1) {
        if (groups[k][1] === 1) { kicker = groups[k][0]; break; }
      }
      return makeValue(HAND_CATEGORY.TWO_PAIR, [pairs[0], pairs[1], kicker], cards);
    }
    if (pairs.length === 1) {
      var onePairKickers = [];
      for (var o = 0; o < groups.length; o += 1) {
        if (groups[o][1] === 1) onePairKickers.push(groups[o][0]);
      }
      onePairKickers.sort(function (a, b) { return b - a; });
      return makeValue(HAND_CATEGORY.ONE_PAIR, [pairs[0]].concat(onePairKickers), cards);
    }
    return makeValue(HAND_CATEGORY.HIGH_CARD, values, cards);
  }

  function combinationsOfFive(items) {
    var output = [];
    var size = 5;
    function visit(start, selected) {
      if (selected.length === size) {
        output.push(selected.slice());
        return;
      }
      for (var index = start; index <= items.length - (size - selected.length); index += 1) {
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
      return left.category > right.category ? 1 : -1;
    }
    return compareNumberArrays(left.tiebreak, right.tiebreak);
  }

  function evaluateBestHand(cards) {
    if (cards.length < 5 || cards.length > 7) {
      throw new Error("A poker hand evaluator requires five to seven cards");
    }
    var best = null;
    var combos = combinationsOfFive(cards);
    for (var i = 0; i < combos.length; i += 1) {
      var value = evaluateFive(combos[i]);
      if (best === null || compareHandValues(value, best) > 0) best = value;
    }
    if (best === null) throw new Error("Unable to evaluate hand");
    return best;
  }

  function assertUniqueCards(cards) {
    var seen = {};
    for (var i = 0; i < cards.length; i += 1) {
      var key = cardKey(cards[i]);
      if (seen[key]) throw new Error("Duplicate card detected");
      seen[key] = true;
    }
  }

  function parseCards(raw) {
    if (!raw || Object.prototype.toString.call(raw) !== "[object Array]") return null;
    var cards = [];
    for (var i = 0; i < raw.length; i += 1) {
      var entry = raw[i];
      if (!entry || RANK_VALUE[entry.rank] === undefined || SUITS.indexOf(entry.suit) < 0) {
        return null;
      }
      cards.push({ rank: entry.rank, suit: entry.suit });
    }
    return cards;
  }

  // ---------------------------------------------------------------------------
  // Quiz answer parsing — mirrors src/lib/localeNumbers.ts for the en-US
  // resource (accepts "." and "," as decimal separators, ":" ratio separator).
  // ---------------------------------------------------------------------------

  var MAX_INPUT_LENGTH = 128;
  var MAX_QUIZ_INPUT_MAGNITUDE = 1000000000000;
  // Grouping separators accepted in quiz entry: space, NBSP, narrow NBSP, apostrophe.
  var GROUP_CHARACTERS = new RegExp("[ \\u00a0\\u202f']");
  var ALL_GROUP_CHARACTERS = new RegExp("[ \\u00a0\\u202f']", "g");
  var ACCEPTED_DECIMAL_SEPARATORS = [".", ","];

  function countChar(value, token) {
    return value.split(token).length - 1;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function parseLocaleDecimal(input) {
    if (typeof input !== "string") return undefined;
    var token = input.trim();
    if (!token || token.length > MAX_INPUT_LENGTH) return undefined;

    var sign = "";
    var unsigned = token;
    if (unsigned.charAt(0) === "+" || unsigned.charAt(0) === "-") {
      sign = unsigned.charAt(0);
      unsigned = unsigned.slice(1);
    }
    if (!unsigned || sign === "-") return undefined;

    var commaCount = countChar(unsigned, ",");
    var pointCount = countChar(unsigned, ".");
    if (commaCount > 0 && pointCount > 0) return undefined;
    if (commaCount > 1 || pointCount > 1) return undefined;

    var punctuation = commaCount === 1 ? "," : pointCount === 1 ? "." : "";
    if (punctuation && ACCEPTED_DECIMAL_SEPARATORS.indexOf(punctuation) < 0) {
      return undefined;
    }

    var integerPart = punctuation
      ? unsigned.slice(0, unsigned.indexOf(punctuation))
      : unsigned;
    var fractionalPart = punctuation
      ? unsigned.slice(unsigned.indexOf(punctuation) + 1)
      : undefined;
    if (fractionalPart !== undefined && !/^\d+$/.test(fractionalPart)) {
      return undefined;
    }
    if (
      fractionalPart !== undefined &&
      fractionalPart.length === 3 &&
      /^[1-9]\d{0,2}$/.test(integerPart) &&
      !GROUP_CHARACTERS.test(integerPart)
    ) {
      return undefined;
    }

    if (GROUP_CHARACTERS.test(integerPart)) {
      var match = integerPart.match(GROUP_CHARACTERS);
      var grouping = match ? match[0] : null;
      if (!grouping) return undefined;
      var escaped = escapeRegExp(grouping);
      if (!new RegExp("^\\d{1,3}(?:" + escaped + "\\d{3})+$").test(integerPart)) {
        return undefined;
      }
      integerPart = integerPart.replace(ALL_GROUP_CHARACTERS, "");
    } else if (integerPart && !/^\d+$/.test(integerPart)) {
      return undefined;
    }

    if (!integerPart && fractionalPart === undefined) return undefined;
    var normalized = sign + (integerPart || "0") +
      (fractionalPart === undefined ? "" : "." + fractionalPart);
    var value = Number(normalized);
    return isFinite(value) && value >= 0 && value <= MAX_QUIZ_INPUT_MAGNITUDE
      ? value
      : undefined;
  }

  function splitOnce(value, separator) {
    if (value.indexOf(separator) < 0) return undefined;
    var pieces = value.split(separator);
    if (
      pieces.length !== 2 ||
      pieces[0].trim().length === 0 ||
      pieces[1].trim().length === 0
    ) {
      return ["", ""];
    }
    return [pieces[0], pieces[1]];
  }

  function parseQuizMathAnswer(input, unit) {
    if (typeof input !== "string" || input.length > MAX_INPUT_LENGTH) return undefined;
    var normalized = input.trim();
    if (!normalized) return undefined;

    var percentMarked = normalized.charAt(normalized.length - 1) === "%";
    if (percentMarked && unit !== "%") return undefined;
    var valueText = percentMarked ? normalized.slice(0, -1).trim() : normalized;
    if (!valueText || valueText.indexOf("%") >= 0) return undefined;

    var fractionParts = splitOnce(valueText, "/");
    var ratioParts = splitOnce(valueText, ":");
    if (fractionParts && ratioParts) return undefined;

    var value;
    if (fractionParts) {
      var numerator = parseLocaleDecimal(fractionParts[0]);
      var denominator = parseLocaleDecimal(fractionParts[1]);
      if (numerator === undefined || denominator === undefined || denominator === 0) {
        return undefined;
      }
      value = numerator / denominator;
      if (unit === "%") value *= 100;
    } else if (ratioParts) {
      var first = parseLocaleDecimal(ratioParts[0]);
      var second = parseLocaleDecimal(ratioParts[1]);
      if (first === undefined || second === undefined) return undefined;
      if (unit === "%") {
        var total = first + second;
        if (total === 0) return undefined;
        value = (second / total) * 100;
      } else {
        if (second === 0) return undefined;
        value = first / second;
      }
    } else {
      var parsed = parseLocaleDecimal(valueText);
      if (parsed === undefined) return undefined;
      value = parsed;
      if (unit === "%" && !percentMarked && value > 0 && value < 1) {
        value *= 100;
      }
    }

    return isFinite(value) && value >= 0 && value <= MAX_QUIZ_INPUT_MAGNITUDE
      ? value
      : undefined;
  }

  // ---------------------------------------------------------------------------
  // Training grading + Elo — mirrors src/lib/trainingEngine.ts.
  // ---------------------------------------------------------------------------

  var TABLE_CLOCK_MS = 30000;
  var EPSILON = 2.220446049250313e-16;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function stableBestAction(actionEvs) {
    var entries = [];
    for (var action in actionEvs) {
      if (Object.prototype.hasOwnProperty.call(actionEvs, action)) {
        var ev = actionEvs[action];
        if (isFinite(ev)) entries.push([action, ev]);
      }
    }
    if (entries.length === 0) {
      throw new Error("A rated scenario must provide at least one finite action EV.");
    }
    entries.sort(function (a, b) {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    return entries[0];
  }

  function evaluateAction(params, action) {
    var best = stableBestAction(params.actionEvs);
    var bestAction = best[0];
    var bestEv = best[1];
    var chosenEv = params.actionEvs[action];
    var hasChosen = chosenEv !== undefined && isFinite(chosenEv);
    var regret = hasChosen ? Math.max(0, bestEv - chosenEv) : Infinity;

    var acceptable = params.acceptableActions || [];
    var explicitlyAccepted = acceptable.indexOf(action) >= 0;
    var fullCredit = explicitlyAccepted || regret <= params.actionEpsilon + EPSILON;
    var partialCredit = !fullCredit && regret <= params.partialCreditRegret + EPSILON;
    var score = fullCredit ? 1 : partialCredit ? 0.5 : 0;

    return {
      action: action,
      bestAction: bestAction,
      bestEv: bestEv,
      chosenEv: hasChosen ? chosenEv : null,
      regret: regret === Infinity ? null : regret,
      score: score,
      correct: fullCredit,
      close: partialCredit,
      explanation: params.actionReason || ""
    };
  }

  function evaluateMathAnswer(params, answer) {
    var correctValue = params.correctValue;
    var tolerance = params.tolerance;
    var unit = params.unit;
    var hasAnswer = answer !== undefined && answer !== null && isFinite(answer);
    var error = hasAnswer ? Math.abs(answer - correctValue) : Infinity;
    var nearMissTolerance = tolerance > 0 ? tolerance * 2 : unit === "outs" ? 1 : 0;
    var fullCredit = error <= tolerance + EPSILON;
    var partialCredit = !fullCredit && error <= nearMissTolerance + EPSILON;
    var score = fullCredit ? 1 : partialCredit ? 0.5 : 0;
    return {
      answer: hasAnswer ? answer : null,
      correctValue: correctValue,
      error: error === Infinity ? null : error,
      tolerance: tolerance,
      score: score,
      correct: fullCredit,
      close: partialCredit,
      explanation: params.mathExplanation || ""
    };
  }

  function expectedEloScore(rating, difficulty) {
    return 1 / (1 + Math.pow(10, (difficulty - rating) / 400));
  }

  function calculateEloDelta(rating, difficulty, score, attempts) {
    var a = attempts || 0;
    if (a < 0) throw new Error("attempts cannot be negative.");
    var kFactor = a < 30 ? 32 : 16;
    var expected = expectedEloScore(rating, difficulty);
    return Math.round(kFactor * (clamp(score, 0, 1) - expected));
  }

  function measureAttemptTiming(params, actionElapsedMs, mathElapsedMs) {
    var actionMs = Math.round(Math.max(0, actionElapsedMs));
    var mathMs = Math.round(Math.max(0, mathElapsedMs));
    var totalMs = actionMs + mathMs;
    var actionTargetRatio = actionMs / params.targetDecisionMs;
    var mathTargetRatio = mathMs / params.targetMathMs;
    var averageRatio = (actionTargetRatio + mathTargetRatio) / 2;
    var pace = averageRatio <= 0.75 ? "fast" : averageRatio <= 1.35 ? "steady" : "deliberate";
    return {
      actionMs: actionMs,
      mathMs: mathMs,
      totalMs: totalMs,
      actionTargetRatio: actionTargetRatio,
      mathTargetRatio: mathTargetRatio,
      pace: pace,
      withinTableClock: totalMs <= TABLE_CLOCK_MS
    };
  }

  function gradeTraining(payload) {
    var params = {
      actionEvs: payload.actionEvs,
      actionEpsilon: Number(payload.actionEpsilon),
      partialCreditRegret: Number(payload.partialCreditRegret),
      acceptableActions: payload.acceptableActions || [],
      actionReason: payload.actionReason || "",
      correctValue: Number(payload.correctValue),
      tolerance: Number(payload.tolerance),
      unit: payload.unit,
      mathExplanation: payload.mathExplanation || "",
      targetDecisionMs: Number(payload.targetDecisionMs),
      targetMathMs: Number(payload.targetMathMs)
    };

    var mathAnswer;
    if (payload.mathAnswer !== undefined && payload.mathAnswer !== null) {
      mathAnswer = Number(payload.mathAnswer);
    } else if (typeof payload.mathInput === "string") {
      mathAnswer = parseQuizMathAnswer(payload.mathInput, params.unit);
    } else {
      mathAnswer = undefined;
    }

    var action = evaluateAction(params, payload.action);
    var math = evaluateMathAnswer(params, mathAnswer);
    var timing = measureAttemptTiming(
      params,
      Number(payload.actionElapsedMs),
      Number(payload.mathElapsedMs)
    );

    var decisionElo = Number(payload.decisionElo);
    var mathElo = Number(payload.mathElo);
    var decisionEloDelta = calculateEloDelta(
      decisionElo,
      Number(payload.decisionDifficulty),
      action.score,
      Number(payload.decisionAttempts) || 0
    );
    var mathEloDelta = calculateEloDelta(
      mathElo,
      Number(payload.mathDifficulty),
      math.score,
      Number(payload.mathAttempts) || 0
    );

    return {
      action: action,
      math: math,
      timing: timing,
      decisionEloDelta: decisionEloDelta,
      mathEloDelta: mathEloDelta,
      decisionEloAfter: decisionElo + decisionEloDelta,
      mathEloAfter: mathElo + mathEloDelta,
      eloDelta: decisionEloDelta + mathEloDelta,
      mathAnswer: math.answer
    };
  }

  // ---------------------------------------------------------------------------
  // AI decision timing — mirrors src/modes/decisionTiming.ts. Mobile surface
  // uses shorter animation budgets. Pausing is a controller responsibility;
  // this never advances while the app is inactive/backgrounded.
  // ---------------------------------------------------------------------------

  var STREET_WEIGHT = { preflop: 0, flop: 90, turn: 150, river: 210 };
  var ACTION_WEIGHT = { fold: 0, check: 20, call: 85, raise: 190, "all-in": 230 };

  function splitMix32(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x9e3779b9) >>> 0;
      var value = state;
      value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
      value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
      value ^= value >>> 15;
      return (value >>> 0) / 0x100000000;
    };
  }

  function hashText(value) {
    var hash = 0x811c9dc5;
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function calculateAiDecisionTiming(input) {
    if (!String(input.seed).trim() || !String(input.decisionId).trim()) {
      throw new Error("Decision timing requires non-empty seed and decision id.");
    }
    var closeness = clamp(Number(input.cutoffCloseness), 0, 1);
    var uncertainty = clamp(Number(input.uncertainty), 0, 1);
    var tempo = clamp(Number(input.tempo), -1, 1);
    var presentationRate = clamp(Number(input.presentationRate), 0.5, 3);
    var surface = input.surface === "mobile" ? "mobile" : input.surface === "desktop" ? "desktop" : "mobile";
    var random = splitMix32(hashText(input.seed + "|" + input.decisionId));

    var boundedDifficultyMs = Math.round(Math.min(300, closeness * 165 + uncertainty * 135));
    var broadJitter = Math.round((random() * 0.72 + random() * 0.28) * 1850);
    var falseTank = random() < 0.14 ? Math.round(random() * 620) : 0;
    var antiTellNoiseMs = broadJitter + falseTank;

    var desktopDelay =
      820 +
      STREET_WEIGHT[input.street] +
      ACTION_WEIGHT[input.action] +
      boundedDifficultyMs +
      Math.round(tempo * 130) +
      antiTellNoiseMs;
    var surfaceDelay =
      surface === "mobile"
        ? clamp(Math.round(desktopDelay * 0.66), 480, 2800)
        : clamp(desktopDelay, 650, 4300);
    var delayMs = Math.max(180, Math.round(surfaceDelay / presentationRate));

    return {
      delayMs: delayMs,
      unscaledDelayMs: surfaceDelay,
      surface: surface,
      presentationRate: presentationRate,
      antiTellNoiseMs: antiTellNoiseMs,
      boundedDifficultyMs: boundedDifficultyMs
    };
  }

  // ---------------------------------------------------------------------------
  // Timed Table blind director — mirrors src/modes/timedBlindDirector.ts.
  // ---------------------------------------------------------------------------

  var MIN_DURATION_MINUTES = 5;
  var MAX_DURATION_MINUTES = 180;

  function smoothstep(value) {
    var clamped = Math.max(0, Math.min(1, value));
    return clamped * clamped * (3 - 2 * clamped);
  }
  function friendlyStep(value) {
    if (value < 500) return 25;
    if (value < 2000) return 50;
    if (value < 10000) return 100;
    if (value < 50000) return 500;
    return 1000;
  }
  function roundUpFriendly(value) {
    var safe = Math.max(1, value);
    var step = friendlyStep(safe);
    return Math.ceil(safe / step) * step;
  }
  function phaseForProgress(progress) {
    if (progress >= 1) return "deadline";
    if (progress < 0.25) return "opening";
    if (progress < 0.72) return "pressure";
    return "closing";
  }
  function reviewCadenceMs(durationMs, phase) {
    var normalCadence = Math.max(20000, Math.min(90000, Math.round(durationMs / 24)));
    if (phase === "opening") return normalCadence;
    if (phase === "pressure") return Math.max(15000, normalCadence * 0.8);
    if (phase === "closing") return Math.max(10000, normalCadence * 0.55);
    return Math.max(5000, normalCadence * 0.3);
  }

  function directTimedBlinds(input) {
    if (
      !isFinite(input.durationMinutes) ||
      Math.floor(input.durationMinutes) !== input.durationMinutes ||
      input.durationMinutes < MIN_DURATION_MINUTES ||
      input.durationMinutes > MAX_DURATION_MINUTES
    ) {
      throw new Error("durationMinutes must be an integer from 5 to 180.");
    }
    if (!isFinite(input.elapsedMs) || input.elapsedMs < 0) {
      throw new Error("elapsedMs must be a non-negative finite number.");
    }
    var current = input.current;
    var liveStacks = [];
    for (var i = 0; i < input.players.length; i += 1) {
      var player = input.players[i];
      if (!player.eliminated && player.stack > 0) liveStacks.push(player.stack);
    }
    liveStacks.sort(function (a, b) { return b - a; });

    var durationMs = input.durationMinutes * 60000;
    var progress = input.elapsedMs / durationMs;
    var phase = phaseForProgress(progress);
    var currentBigBlind = current.bigBlind;
    var currentSmallBlind = current.smallBlind;
    var nextReviewMs = reviewCadenceMs(durationMs, phase);

    if (liveStacks.length <= 1) {
      return {
        smallBlind: current.smallBlind,
        bigBlind: current.bigBlind,
        bigBlindAnte: current.bigBlindAnte,
        phase: phase,
        progress: progress,
        livePlayers: liveStacks.length,
        nextReviewMs: nextReviewMs,
        forcedAllInStack: null,
        reason: "The table is complete, so the blind level is held."
      };
    }

    var chipsInPlay = 0;
    for (var s = 0; s < liveStacks.length; s += 1) chipsInPlay += liveStacks[s];
    var averageStack = chipsInPlay / liveStacks.length;
    var secondLargestStack = liveStacks[1];
    var targetBigBlind = currentBigBlind;
    var reason = "Opening levels are intentionally stable so the table begins like normal tournament poker.";

    if (phase === "pressure") {
      var pressureProgress = smoothstep((progress - 0.25) / 0.47);
      var desiredAvgP = 42 - pressureProgress * 26;
      var stackTargetP = averageStack / desiredAvgP;
      var populationPressure = 1 + Math.max(0, liveStacks.length - 3) * 0.055 * pressureProgress;
      targetBigBlind = stackTargetP * populationPressure;
      reason = "Blinds rise gradually from public time, field size, and the average live stack.";
    } else if (phase === "closing") {
      var closingProgress = smoothstep((progress - 0.72) / 0.28);
      var desiredAvgC = 14 - closingProgress * 10;
      var stackTargetC = averageStack / desiredAvgC;
      var deadlineTarget = currentBigBlind + (secondLargestStack - currentBigBlind) * Math.pow(closingProgress, 1.65);
      targetBigBlind = Math.max(stackTargetC, deadlineTarget);
      reason = "Closing pressure accelerates toward the second-largest stack without decreasing the current level.";
    } else if (phase === "deadline") {
      targetBigBlind = secondLargestStack;
      reason = "The deadline safety level covers the second-largest stack, forcing every player except the chip leader all-in.";
    }

    if (phase !== "deadline") {
      var jumpCap = phase === "opening" ? currentBigBlind : currentBigBlind * (phase === "pressure" ? 2 : 3);
      targetBigBlind = Math.min(targetBigBlind, jumpCap);
    }

    var bigBlind = Math.max(currentBigBlind, roundUpFriendly(targetBigBlind));
    var smallBlind = Math.max(currentSmallBlind, roundUpFriendly(bigBlind / 2));
    var bigBlindAnte = Math.max(current.bigBlindAnte, bigBlind);

    return {
      smallBlind: smallBlind,
      bigBlind: bigBlind,
      bigBlindAnte: bigBlindAnte,
      phase: phase,
      progress: progress,
      livePlayers: liveStacks.length,
      nextReviewMs: nextReviewMs,
      forcedAllInStack: phase === "deadline" ? secondLargestStack : null,
      reason: reason
    };
  }

  // ---------------------------------------------------------------------------
  // On-device capped equity + bot decision for Normal and Rational modes.
  //
  // This is a phone-conservative equity adaptation. Opponents are sampled from
  // the unseen deck (uniform hole cards) with a hard simulation ceiling so a
  // single decision stays cheap. It is deterministic per seed. The full
  // desktop range-weighted Rational policy and Normal personality engine
  // remain a documented desktop-side responsibility; see docs/ios.
  // ---------------------------------------------------------------------------

  function boundedSimulations(requested) {
    var value = Math.floor(Number(requested));
    if (!isFinite(value) || value < 20) value = DEFAULT_MOBILE_SIMULATIONS;
    return Math.min(MAX_MOBILE_SIMULATIONS, Math.max(20, value));
  }

  function boundedSlice(requested) {
    var value = Math.floor(Number(requested));
    if (!isFinite(value) || value < 1) value = DEFAULT_SIMULATIONS_PER_SLICE;
    return Math.min(MAX_SIMULATIONS_PER_SLICE, Math.max(1, value));
  }

  function estimateEquity(hero, board, opponentCount, seed, requestedSimulations, requestedSlice) {
    if (!hero || hero.length !== 2) throw new Error("Equity requires exactly two hero cards.");
    if (board.length > 5) throw new Error("Board cannot exceed five cards.");
    if (opponentCount < 1 || opponentCount > 8) {
      throw new Error("Equity requires 1 to 8 opponents.");
    }
    var simulations = boundedSimulations(requestedSimulations);
    var perSlice = boundedSlice(requestedSlice);

    var known = {};
    var i;
    for (i = 0; i < hero.length; i += 1) known[cardKey(hero[i])] = true;
    for (i = 0; i < board.length; i += 1) known[cardKey(board[i])] = true;
    assertUniqueCards(hero.concat(board));

    var fullDeck = createDeck();
    var random = createSeededRandom(deriveSeed(seed, "mobile-equity", opponentCount));

    var wins = 0, ties = 0, losses = 0, equityPoints = 0, slices = 0, handEvaluations = 0;
    var completed = 0;
    while (completed < simulations) {
      var stop = Math.min(simulations, completed + perSlice);
      while (completed < stop) {
        var used = {};
        for (var uk in known) {
          if (Object.prototype.hasOwnProperty.call(known, uk)) used[uk] = true;
        }
        // Build an available pool then Fisher-Yates draw for opponents + runout.
        var pool = [];
        for (var d = 0; d < fullDeck.length; d += 1) {
          if (!used[cardKey(fullDeck[d])]) pool.push(fullDeck[d]);
        }
        // Partial shuffle: draw the number of cards we need.
        var need = opponentCount * 2 + (5 - board.length);
        for (var n = 0; n < need; n += 1) {
          var swap = n + Math.floor(random() * (pool.length - n));
          var tmp = pool[n];
          pool[n] = pool[swap];
          pool[swap] = tmp;
        }
        var cursor = 0;
        var opponents = [];
        for (var o = 0; o < opponentCount; o += 1) {
          opponents.push([pool[cursor], pool[cursor + 1]]);
          cursor += 2;
        }
        var runout = board.slice();
        for (var rr = 0; rr < 5 - board.length; rr += 1) {
          runout.push(pool[cursor]);
          cursor += 1;
        }

        var heroValue = evaluateBestHand(hero.concat(runout));
        handEvaluations += 1;
        var heroBeat = false;
        var tiedCount = 1;
        var heroLoses = false;
        for (var op = 0; op < opponents.length; op += 1) {
          var oppValue = evaluateBestHand(opponents[op].concat(runout));
          handEvaluations += 1;
          var cmp = compareHandValues(heroValue, oppValue);
          if (cmp < 0) { heroLoses = true; break; }
          if (cmp === 0) tiedCount += 1;
        }
        if (heroLoses) {
          losses += 1;
        } else if (tiedCount === 1) {
          wins += 1;
          equityPoints += 1;
        } else {
          ties += 1;
          equityPoints += 1 / tiedCount;
        }
        completed += 1;
      }
      slices += 1;
    }

    return {
      equity: equityPoints / simulations,
      wins: wins,
      ties: ties,
      losses: losses,
      simulations: simulations,
      work: {
        workVersion: "mobile-equity-work-v1",
        requestedSimulations: simulations,
        completedSimulations: completed,
        simulationsPerSlice: perSlice,
        slices: slices,
        handEvaluations: handEvaluations,
        maximumSimulationsPerDecision: MAX_MOBILE_SIMULATIONS,
        maximumSimulationsPerSlice: MAX_SIMULATIONS_PER_SLICE,
        schedulingBasis: "completed-simulation-count"
      }
    };
  }

  function decideBotAction(payload) {
    var hero = parseCards(payload.hero);
    var board = parseCards(payload.board || []);
    if (!hero || !board) throw new Error("Bot decision requires valid hero and board cards.");
    var opponentCount = Math.floor(Number(payload.opponents));
    var pot = Math.max(0, Number(payload.pot) || 0);
    var toCall = Math.max(0, Number(payload.toCall) || 0);
    var bigBlind = Math.max(1, Number(payload.bigBlind) || 1);
    var style = payload.style === "rational" ? "rational" : "normal";
    var seed = payload.seed !== undefined ? payload.seed : "mobile-bot";

    var defaultSims = style === "rational" ? MAX_MOBILE_SIMULATIONS : DEFAULT_MOBILE_SIMULATIONS;
    var estimate = estimateEquity(
      hero,
      board,
      opponentCount,
      seed,
      payload.simulations !== undefined ? payload.simulations : defaultSims,
      payload.simulationsPerSlice
    );

    var equity = estimate.equity;
    var potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    // Normal accepts a small strategic premium; Rational is threshold-strict.
    var premium = style === "rational" ? 0 : 0.02;
    var requiredEquity = clamp(potOdds + premium, 0, 0.98);

    var canRaise = payload.legalRaiseTo !== undefined && payload.legalRaiseTo !== null;
    var raiseTo = canRaise ? Math.floor(Number(payload.legalRaiseTo)) : null;

    var action;
    var rationale;
    if (toCall === 0) {
      if (equity >= 0.62 && canRaise) {
        action = "raise";
        rationale = "Strong estimated equity bets for value.";
      } else {
        action = "check";
        rationale = "Checking realizes equity without committing chips.";
      }
    } else if (equity + EPSILON < requiredEquity) {
      action = "fold";
      rationale = "Estimated equity trails the price to continue.";
    } else if (equity >= Math.max(0.66, requiredEquity + 0.16) && canRaise) {
      action = "raise";
      rationale = "Equity clears the value-raise threshold.";
    } else {
      action = "call";
      rationale = "Estimated equity meets the pot-odds threshold.";
    }

    return {
      style: style,
      action: action,
      raiseTo: action === "raise" ? raiseTo : null,
      equity: equity,
      potOdds: potOdds,
      requiredEquity: requiredEquity,
      effectiveStackBigBlinds: Math.max(0, Number(payload.effectiveStack) || 0) / bigBlind,
      rationale: rationale,
      work: estimate.work
    };
  }

  // ---------------------------------------------------------------------------
  // Envelope + dispatch.
  // ---------------------------------------------------------------------------

  function success(request, result) {
    return JSON.stringify({
      contractVersion: CONTRACT_VERSION,
      requestID: request.requestID,
      ok: true,
      result: result,
      error: null
    });
  }

  function failure(request, code, message) {
    return JSON.stringify({
      contractVersion: CONTRACT_VERSION,
      requestID: request && request.requestID ? request.requestID : "unknown",
      ok: false,
      result: null,
      error: { code: code, message: message }
    });
  }

  var OPERATIONS = [
    "health", "dealPreview", "evaluateHand", "compareHands", "parseMathAnswer",
    "gradeTraining", "eloDelta", "decisionTiming", "timedBlinds", "estimateEquity",
    "botDecision"
  ];

  function handle(request) {
    var payload = request.payload || {};
    switch (request.operation) {
      case "health":
        return success(request, {
          deterministic: true,
          engineVersion: ENGINE_VERSION,
          contractVersion: CONTRACT_VERSION,
          operations: OPERATIONS,
          equityCaps: {
            defaultSimulations: DEFAULT_MOBILE_SIMULATIONS,
            maximumSimulations: MAX_MOBILE_SIMULATIONS,
            defaultSimulationsPerSlice: DEFAULT_SIMULATIONS_PER_SLICE,
            maximumSimulationsPerSlice: MAX_SIMULATIONS_PER_SLICE
          }
        });

      case "dealPreview": {
        if (typeof request.seed !== "string" || request.seed.length === 0) {
          return failure(request, "SEED_REQUIRED", "dealPreview requires a non-empty seed.");
        }
        var deck = shuffleDeck(createDeck(), createSeededRandom(request.seed));
        return success(request, { hero: deck.slice(0, 2), board: deck.slice(2, 5) });
      }

      case "evaluateHand": {
        var cards = parseCards(payload.cards);
        if (!cards) return failure(request, "INVALID_CARDS", "evaluateHand requires valid cards.");
        try {
          assertUniqueCards(cards);
          return success(request, evaluateBestHand(cards));
        } catch (error) {
          return failure(request, "EVALUATION_FAILED", String(error && error.message ? error.message : error));
        }
      }

      case "compareHands": {
        var left = parseCards(payload.left);
        var right = parseCards(payload.right);
        if (!left || !right) return failure(request, "INVALID_CARDS", "compareHands requires valid left and right cards.");
        try {
          assertUniqueCards(left);
          assertUniqueCards(right);
          return success(request, { result: compareHandValues(evaluateBestHand(left), evaluateBestHand(right)) });
        } catch (error) {
          return failure(request, "EVALUATION_FAILED", String(error && error.message ? error.message : error));
        }
      }

      case "parseMathAnswer": {
        if (typeof payload.input !== "string") {
          return failure(request, "INVALID_INPUT", "parseMathAnswer requires a string input.");
        }
        var parsed = parseQuizMathAnswer(payload.input, payload.unit);
        return success(request, { value: parsed === undefined ? null : parsed });
      }

      case "gradeTraining": {
        try {
          return success(request, gradeTraining(payload));
        } catch (error) {
          return failure(request, "GRADING_FAILED", String(error && error.message ? error.message : error));
        }
      }

      case "eloDelta": {
        try {
          var delta = calculateEloDelta(
            Number(payload.rating),
            Number(payload.difficulty),
            Number(payload.score),
            Number(payload.attempts) || 0
          );
          return success(request, {
            delta: delta,
            expected: expectedEloScore(Number(payload.rating), Number(payload.difficulty))
          });
        } catch (error) {
          return failure(request, "ELO_FAILED", String(error && error.message ? error.message : error));
        }
      }

      case "decisionTiming": {
        try {
          var timingInput = {
            seed: payload.seed !== undefined ? payload.seed : request.seed,
            decisionId: payload.decisionId,
            street: payload.street,
            action: payload.action,
            cutoffCloseness: payload.cutoffCloseness,
            uncertainty: payload.uncertainty,
            tempo: payload.tempo,
            presentationRate: payload.presentationRate,
            surface: payload.surface
          };
          return success(request, calculateAiDecisionTiming(timingInput));
        } catch (error) {
          return failure(request, "TIMING_FAILED", String(error && error.message ? error.message : error));
        }
      }

      case "timedBlinds": {
        try {
          return success(request, directTimedBlinds({
            durationMinutes: Number(payload.durationMinutes),
            elapsedMs: Number(payload.elapsedMs),
            current: payload.current,
            players: payload.players || [],
            startingTotalChips: Number(payload.startingTotalChips)
          }));
        } catch (error) {
          return failure(request, "TIMED_BLINDS_FAILED", String(error && error.message ? error.message : error));
        }
      }

      case "estimateEquity": {
        var eqHero = parseCards(payload.hero);
        var eqBoard = parseCards(payload.board || []);
        if (!eqHero || !eqBoard) return failure(request, "INVALID_CARDS", "estimateEquity requires valid hero and board cards.");
        try {
          return success(request, estimateEquity(
            eqHero,
            eqBoard,
            Math.floor(Number(payload.opponents)),
            request.seed !== undefined ? request.seed : (payload.seed !== undefined ? payload.seed : "mobile-equity"),
            payload.simulations,
            payload.simulationsPerSlice
          ));
        } catch (error) {
          return failure(request, "EQUITY_FAILED", String(error && error.message ? error.message : error));
        }
      }

      case "botDecision": {
        try {
          var withSeed = {};
          for (var key in payload) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) withSeed[key] = payload[key];
          }
          if (withSeed.seed === undefined && request.seed !== undefined) withSeed.seed = request.seed;
          return success(request, decideBotAction(withSeed));
        } catch (error) {
          return failure(request, "DECISION_FAILED", String(error && error.message ? error.message : error));
        }
      }

      default:
        return failure(request, "UNKNOWN_OPERATION", "Unsupported engine operation.");
    }
  }

  function invoke(requestJSON) {
    var request;
    try {
      request = JSON.parse(requestJSON);
    } catch (_error) {
      return failure(null, "INVALID_JSON", "Request must be valid JSON.");
    }
    if (request.contractVersion !== CONTRACT_VERSION) {
      return failure(request, "CONTRACT_MISMATCH", "Unsupported contract version.");
    }
    try {
      return handle(request);
    } catch (error) {
      return failure(request, "ENGINE_ERROR", String(error && error.message ? error.message : error));
    }
  }

  root.PokerTrainingEngine = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    invoke: invoke
  });
})(this);
