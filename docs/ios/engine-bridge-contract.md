# Bundled poker engine bridge contract

Contract version: `1.0.0`

Runtime: JavaScriptCore in the app process. The artifact is copied into the signed app bundle. No server, web view, or downloaded code is involved.

## Artifact requirements

The production shared-engine build must:

1. Be a browserless, self-contained ES5-compatible IIFE that JavaScriptCore can evaluate without Node, DOM, CommonJS, ESM loading, timers, storage, or networking.
2. Export exactly one global named `PokerTrainingEngine`.
3. Expose `contractVersion` and a synchronous `invoke(requestJSON)` function.
4. Return a JSON string for every handled request, including errors.
5. Produce identical results for identical inputs and seeds.
6. Never call `Math.random()` for gameplay. All randomness must derive from the request seed.
7. Be bundled at build time. The app must not fetch or replace it at runtime.
8. Avoid native Swift callbacks. This keeps the JavaScript capability surface limited to JSON input and output.

The checked-in `poker-engine.js` is an executable browserless IIFE that mirrors the deterministic desktop TypeScript primitives (FNV-1a seed hash, Mulberry32 RNG, the hand evaluator, the quiz answer parser, Training grading and Elo, the AI decision-timing model, the Timed Table blind director, and capped on-device range equity). It is byte-for-byte parity-tested against the TypeScript source of truth on Windows by `src/modes/mobileEngineBridge.test.ts`, which evaluates the exact bundle in a Node VM the same way JavaScriptCore evaluates it on device. A full production build should still replace the hand-maintained bot heuristics with the exported desktop Rational/Normal policies and run the cross-runtime conformance corpus below on a Mac.

## Global shape

```javascript
globalThis.PokerTrainingEngine = Object.freeze({
  contractVersion: "1.0.0",
  invoke: function (requestJSON) {
    // Always returns response JSON.
  }
});
```

The scaffold uses `(function (root) { ... })(this)` instead of `globalThis` so it remains compatible with older JavaScriptCore syntax.

## Request envelope

```json
{
  "contractVersion": "1.0.0",
  "requestID": "unique-correlation-id",
  "operation": "dealPreview",
  "seed": "ios-preview:training:1",
  "payload": {}
}
```

| Field | Rule |
|---|---|
| `contractVersion` | Required. Swift currently sends `1.0.0`. |
| `requestID` | Required opaque string echoed in the response. |
| `operation` | Required stable operation name. |
| `seed` | Required for any operation involving a deck or randomized simulation. |
| `payload` | Required JSON object; may be empty. |

## Response envelope

Success:

```json
{
  "contractVersion": "1.0.0",
  "requestID": "unique-correlation-id",
  "ok": true,
  "result": {},
  "error": null
}
```

Failure:

```json
{
  "contractVersion": "1.0.0",
  "requestID": "unique-correlation-id",
  "ok": false,
  "result": null,
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Human-readable diagnostic"
  }
}
```

Swift rejects missing JSON, malformed envelopes, contract mismatches, unsuccessful responses, and malformed typed results.

## Operations

Ranks are `2` through `9`, then `T`, `J`, `Q`, `K`, `A`. Suits are `clubs`, `diamonds`, `hearts`, and `spades`. A card is `{ "rank": "A", "suit": "spades" }`.

### `health`

Input: no seed required. Result reports determinism, the engine version, the supported operation list, and the on-device equity caps:

```json
{
  "deterministic": true,
  "engineVersion": "mobile-engine-1",
  "contractVersion": "1.0.0",
  "operations": ["health", "dealPreview", "evaluateHand", "..."],
  "equityCaps": {
    "defaultSimulations": 240,
    "maximumSimulations": 600,
    "defaultSimulationsPerSlice": 16,
    "maximumSimulationsPerSlice": 32
  }
}
```

### `dealPreview`

Input: non-empty `seed`. Result: `{ "hero": [card, card], "board": [card, card, card] }`. Deterministic per seed.

### `evaluateHand`

Input: `payload.cards` (five to seven cards). Result mirrors the desktop `HandValue`: `{ category, categoryName, displayName, tiebreak, cards }`.

### `compareHands`

Input: `payload.left`, `payload.right` (each five to seven cards). Result: `{ "result": -1 | 0 | 1 }`.

### `parseMathAnswer`

Input: `payload.input` (string), `payload.unit` (`"%" | "chips" | "outs" | "ratio"`). Result: `{ "value": number | null }`. Accepts the table forms `33%`, `0.33`, `1/3`, and `2:1` (odds-against for percentage questions). Mirrors `parseQuizMathAnswer` for the en-US numeric locale.

### `gradeTraining`

Input: an action, a raw `mathInput` string (or parsed `mathAnswer`), the scenario grading parameters (`actionEvs`, `actionEpsilon`, `partialCreditRegret`, `acceptableActions`, `correctValue`, `tolerance`, `unit`, difficulties, targets), the current `decisionElo`/`mathElo`, attempt counts, and elapsed times. Result: `{ action, math, timing, decisionEloDelta, mathEloDelta, decisionEloAfter, mathEloAfter, eloDelta, mathAnswer }`. Mirrors `gradeTrainingAttempt`.

### `eloDelta`

Input: `rating`, `difficulty`, `score`, `attempts`. Result: `{ delta, expected }`. Mirrors `calculateEloDelta`.

### `decisionTiming`

Input: `seed`, `decisionId`, `street`, `action`, `cutoffCloseness`, `uncertainty`, `tempo`, `presentationRate`, `surface`. Result: `{ delayMs, unscaledDelayMs, surface, presentationRate, antiTellNoiseMs, boundedDifficultyMs }`. Mirrors `calculateAiDecisionTiming`; `surface` defaults to `mobile`, which uses the shorter animation budget. The delay never encodes hand strength and must never advance while the app is inactive or backgrounded.

### `timedBlinds`

Input: `durationMinutes`, `elapsedMs`, `current` level, `players`, `startingTotalChips`. Result mirrors `directTimedBlinds` (`smallBlind`, `bigBlind`, `bigBlindAnte`, `phase`, `progress`, `livePlayers`, `nextReviewMs`, `forcedAllInStack`, `reason`).

### `estimateEquity`

Input: `seed`, `payload.hero`, `payload.board`, `payload.opponents` (1–8), optional `simulations`/`simulationsPerSlice`. Result: `{ equity, wins, ties, losses, simulations, work }`. Simulations are hard-capped to the phone ceiling (`maximumSimulations`); a caller can only lower the count. Deterministic per seed.

### `botDecision`

Input: `style` (`"normal" | "rational"`), `hero`, `board`, `opponents`, `pot`, `toCall`, `bigBlind`, optional `effectiveStack`, `legalRaiseTo`, `seed`, `simulations`. Result: `{ style, action, raiseTo, equity, potOdds, requiredEquity, effectiveStackBigBlinds, rationale, work }`. This is a phone-conservative equity-based decision built on `estimateEquity` with the same caps. It is a documented mobile adaptation, not byte-parity with the full desktop range-weighted Rational policy or Normal personality engine; a production build should bundle those exported policies.

## Production conformance gate

Before replacing the scaffold artifact:

- Generate a corpus in TypeScript containing at least 100 fixed seeds, shuffled deck order, deals, evaluator results, betting transitions, side pots, and tournament transitions.
- Execute the same corpus against the exact bundled IIFE in JavaScriptCore.
- Compare canonical JSON results byte-for-byte where ordering is defined and structurally otherwise.
- Test unknown operations, invalid JSON, missing seeds, version mismatches, invalid cards, and engine exceptions.
- Record the source revision and SHA-256 of the exact JS artifact in release evidence.
- Run on a physical iPhone and iPad in addition to Simulator.

Contract additions should be backward compatible within `1.x`. Breaking envelope, card, numeric, or state semantics require a new major version and coordinated Swift + JavaScript release.

