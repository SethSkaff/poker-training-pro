import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyCdpFailure,
  isCdpTransportTimeout,
  reportCdpOutcome,
} from "./cdp-outcome.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const scriptsDirectory = path.join(projectRoot, "scripts");

describe("transport timeouts are told apart from product failures", () => {
  it("recognises the CDP client's own deadlines", () => {
    for (const message of [
      "CDP command Runtime.evaluate timed out.",
      "Timed out waiting for the DevTools endpoint after 30000ms",
      "WebSocket closed before the CDP session was established",
    ]) {
      expect(isCdpTransportTimeout(new Error(message))).toBe(true);
    }
  });

  it("does not swallow a product timeout, which is the failure being hunted", () => {
    // A scene stuck on its loading fallback, or a hero decision that never
    // arrives, is exactly what these audits exist to catch. A broad match on
    // "timeout" would classify both as infrastructure and hide them.
    for (const message of [
      "live table: .poker-table was not present.",
      "Safe-mode renderer did not reach the required state: {}",
      "packaged app exited during play (code 1).",
      "career event lobby did not appear before the deadline",
    ]) {
      expect(isCdpTransportTimeout(new Error(message))).toBe(false);
    }
  });

  it("never reports a run as both a failure and inconclusive", () => {
    const product = classifyCdpFailure(new Error("button was not present."));
    expect(product.failure).toBeDefined();
    expect(product.transportTimeout).toBeUndefined();

    const transport = classifyCdpFailure(
      new Error("CDP command Page.reload timed out."),
    );
    expect(transport.transportTimeout).toBeDefined();
    expect(transport.failure).toBeUndefined();
  });
});

describe("the report shape makes the distinction machine-readable", () => {
  const withExit = (
    run: () => ReturnType<typeof reportCdpOutcome>,
  ): { report: ReturnType<typeof reportCdpOutcome>; exitCode: unknown } => {
    const previous = process.exitCode;
    process.exitCode = 0;
    try {
      const report = run();
      return { report, exitCode: process.exitCode };
    } finally {
      process.exitCode = previous;
    }
  };

  it("exits 0 / 1 / 2 for passed / product failure / inconclusive", () => {
    // The exit code is the contract: a caller that cares about the difference
    // must not have to parse prose to find it.
    const passed = withExit(() => reportCdpOutcome({ schemaVersion: 1 }));
    expect(passed.report.outcome).toBe("passed");
    expect(passed.report.ok).toBe(true);
    expect(passed.exitCode).toBe(0);

    const failed = withExit(() =>
      reportCdpOutcome({ schemaVersion: 1 }, { failure: "button missing" }),
    );
    expect(failed.report.outcome).toBe("product-failure");
    expect(failed.report.ok).toBe(false);
    expect(failed.exitCode).toBe(1);

    const inconclusive = withExit(() =>
      reportCdpOutcome(
        { schemaVersion: 1 },
        { transportTimeout: "CDP command Page.enable timed out." },
      ),
    );
    expect(inconclusive.report.outcome).toBe("inconclusive-cdp-timeout");
    expect(inconclusive.report.ok).toBe(false);
    expect(inconclusive.exitCode).toBe(2);
  });
});

describe("every CDP-driven packaged audit makes the distinction", () => {
  it("leaves none of them treating a transport timeout as a regression", () => {
    // Seven of the nine did not, so the same infrastructure hiccup was
    // inconclusive in two scripts and a product failure in the rest (E25-003).
    const unclassified: string[] = [];
    for (const entry of readdirSync(scriptsDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/^audit-packaged-.*\.mjs$/.test(entry.name)) continue;
      const source = readFileSync(path.join(scriptsDirectory, entry.name), "utf8");
      if (!source.includes("CdpClient")) continue;
      const classifies =
        source.includes("cdp-outcome.mjs") ||
        source.includes("inconclusive-cdp-timeout");
      if (!classifies) unclassified.push(entry.name);
    }
    expect(unclassified).toEqual([]);
  });
});
