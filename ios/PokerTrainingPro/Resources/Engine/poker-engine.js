(function (root) {
  "use strict";

  var CONTRACT_VERSION = "1.0.0";
  var SUITS = ["clubs", "diamonds", "hearts", "spades"];
  var RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

  function hashSeed(seed) {
    var input = String(seed);
    var hash = 0x811c9dc5;
    for (var index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    var state = hashSeed(seed);
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffledDeck(seed) {
    var deck = [];
    SUITS.forEach(function (suit) {
      RANKS.forEach(function (rank) {
        deck.push({ rank: rank, suit: suit });
      });
    });

    var random = seededRandom(seed);
    for (var index = deck.length - 1; index > 0; index -= 1) {
      var swapIndex = Math.floor(random() * (index + 1));
      var temporary = deck[index];
      deck[index] = deck[swapIndex];
      deck[swapIndex] = temporary;
    }
    return deck;
  }

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

    if (request.operation === "health") {
      return success(request, { deterministic: true, engineVersion: "scaffold-1" });
    }

    if (request.operation === "dealPreview") {
      if (typeof request.seed !== "string" || request.seed.length === 0) {
        return failure(request, "SEED_REQUIRED", "dealPreview requires a non-empty seed.");
      }
      var deck = shuffledDeck(request.seed);
      return success(request, {
        hero: deck.slice(0, 2),
        board: deck.slice(2, 5)
      });
    }

    return failure(request, "UNKNOWN_OPERATION", "Unsupported engine operation.");
  }

  root.PokerTrainingEngine = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    invoke: invoke
  });
})(this);

