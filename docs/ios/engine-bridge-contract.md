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

The checked-in `poker-engine.js` is an executable scaffold adapter mirroring the TypeScript deck's FNV-1a seed hash and Mulberry32 shuffle. Replace it with the production shared-engine IIFE once an explicit browserless export exists.

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

## Scaffold operations

### `health`

Input: no seed required.

Result:

```json
{
  "deterministic": true,
  "engineVersion": "scaffold-1"
}
```

### `dealPreview`

Input: non-empty `seed`.

Result:

```json
{
  "hero": [
    { "rank": "A", "suit": "spades" },
    { "rank": "K", "suit": "hearts" }
  ],
  "board": [
    { "rank": "T", "suit": "clubs" },
    { "rank": "7", "suit": "diamonds" },
    { "rank": "2", "suit": "spades" }
  ]
}
```

Ranks are `2` through `9`, then `T`, `J`, `Q`, `K`, `A`. Suits are `clubs`, `diamonds`, `hearts`, and `spades`.

## Production conformance gate

Before replacing the scaffold artifact:

- Generate a corpus in TypeScript containing at least 100 fixed seeds, shuffled deck order, deals, evaluator results, betting transitions, side pots, and tournament transitions.
- Execute the same corpus against the exact bundled IIFE in JavaScriptCore.
- Compare canonical JSON results byte-for-byte where ordering is defined and structurally otherwise.
- Test unknown operations, invalid JSON, missing seeds, version mismatches, invalid cards, and engine exceptions.
- Record the source revision and SHA-256 of the exact JS artifact in release evidence.
- Run on a physical iPhone and iPad in addition to Simulator.

Contract additions should be backward compatible within `1.x`. Breaking envelope, card, numeric, or state semantics require a new major version and coordinated Swift + JavaScript release.

