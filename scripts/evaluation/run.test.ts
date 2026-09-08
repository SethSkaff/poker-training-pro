import { describe, expect, it } from "vitest";
import { runEvaluationCli } from "./run";

describe("A15 CLI dispatcher", () => {
  it("rejects unknown flags and missing values with configuration status", async () => {
    expect(await runEvaluationCli(["verify", "--unknown"])).toBe(2);
    expect(await runEvaluationCli(["verify", "--output"])).toBe(2);
    expect(await runEvaluationCli(["tier", "unknown"])).toBe(2);
  });

  it("accepts a dry-run without claiming measurements", async () => {
    expect(await runEvaluationCli(["common", "--dry-run", "--offline"])).toBe(0);
  });
});
