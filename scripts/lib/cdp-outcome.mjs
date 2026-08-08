/**
 * Classify a packaged-audit failure as transport or product (E25-003).
 *
 * The packaged audits drive a real Electron build over the Chrome DevTools
 * Protocol. That transport has its own command deadline, and it expires for
 * reasons that have nothing to do with the product: a loaded CI box, a slow
 * cold start, a renderer that was still compositing when the deadline landed.
 *
 * Reporting those as product failures is worse than useless -- it trains
 * whoever reads the report to ignore red, which is precisely how a real
 * regression gets waved through. So a transport timeout is `inconclusive`:
 * it proves neither a passing interaction nor a regression, and it exits 2
 * rather than 1 so a caller can tell the two apart without parsing text.
 *
 * `audit-packaged-input-smoke.mjs` and `audit-packaged-flash-capture.mjs` had
 * this logic inline and the other seven CDP audits did not, meaning the same
 * infrastructure hiccup was an inconclusive result in two scripts and a
 * product failure in the rest. This is that logic, in one place.
 */

/**
 * True when the message is the CDP client's own command deadline rather than
 * anything the product did.
 *
 * Deliberately narrow. A broad match on "timeout" would swallow genuine
 * product timeouts -- a scene that never leaves its loading fallback, a hero
 * decision that never arrives -- which are exactly the failures these audits
 * exist to catch.
 */
export function isCdpTransportTimeout(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /^CDP command .* timed out\.$/.test(message) ||
    /^Timed out waiting for the DevTools endpoint\b/.test(message) ||
    /^WebSocket (closed|error) before the CDP session was established\b/.test(
      message,
    )
  );
}

/**
 * Split a caught error into the two report fields.
 *
 * Returns `{ failure }` or `{ transportTimeout }`, never both, so a report
 * built from the result cannot claim to be simultaneously a product failure
 * and inconclusive.
 */
export function classifyCdpFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return isCdpTransportTimeout(error)
    ? { transportTimeout: message }
    : { failure: message };
}

/**
 * Finish a packaged audit: write the outcome, print it, and set the exit code.
 *
 * Exit codes are the contract: 0 passed, 1 product failure, 2 inconclusive
 * transport timeout. A caller that treats non-zero as failure still stops on
 * both, but one that cares about the difference does not have to parse prose.
 */
export function reportCdpOutcome(report, { failure, transportTimeout } = {}) {
  const finished = {
    ...report,
    ok: !failure && !transportTimeout,
    outcome: failure
      ? "product-failure"
      : transportTimeout
        ? "inconclusive-cdp-timeout"
        : "passed",
    ...(failure ? { failure } : {}),
    ...(transportTimeout ? { transportTimeout } : {}),
  };
  const serialized = `${JSON.stringify(finished, null, 2)}\n`;
  if (failure) {
    process.stderr.write(serialized);
    process.exitCode = 1;
  } else if (transportTimeout) {
    process.stderr.write(serialized);
    process.exitCode = 2;
  } else {
    process.stdout.write(serialized);
  }
  return finished;
}
