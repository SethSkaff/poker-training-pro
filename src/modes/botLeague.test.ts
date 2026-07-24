import { describe, expect, it } from "vitest";
import baseline from "./fixtures/bot-league-baseline.json";
import {
  runBotLeague,
  serializeBotLeagueReport,
  type BotLeagueReport,
} from "./botLeague";

const report = runBotLeague();
if (process.env.BOT_LEAGUE_PRINT === "1") {
  console.log(`BOT_LEAGUE_REPORT_START\n${serializeBotLeagueReport(report)}BOT_LEAGUE_REPORT_END`);
}

describe("deterministic bot league", () => {
  it("matches the frozen pre-balance policy baseline exactly", () => {
    expect(report).toEqual(baseline);
    expect(serializeBotLeagueReport(report)).toBe(
      serializeBotLeagueReport(baseline as BotLeagueReport),
    );
  });

  it("covers every requested policy slice with normalized actions", () => {
    expect(report.frozenInputs.matrixFixtures).toBe(3 * 3 * 4);
    const slices = [
      report.policies.rational.overall,
      ...Object.values(report.policies.rational.byPosition),
      ...Object.values(report.policies.rational.byStack),
      ...Object.values(report.policies.rational.byStreet),
    ];
    for (const slice of slices) {
      const chosenTotal = Object.values(slice.chosenActions).reduce(
        (sum, value) => sum + value,
        0,
      );
      const expectedTotal = Object.values(slice.expectedActions).reduce(
        (sum, value) => sum + value,
        0,
      );
      expect(chosenTotal).toBeCloseTo(1, 5);
      expect(expectedTotal).toBeCloseTo(1, 5);
      expect(slice.meanEquity).toBeGreaterThanOrEqual(0);
      expect(slice.meanEquity).toBeLessThanOrEqual(1);
    }
  });

  it("fails if any Normal profile breaches its EV-loss contract", () => {
    for (const profile of Object.values(report.policies.normalProfiles)) {
      expect(profile.decisions).toBe(
        report.frozenInputs.matrixFixtures *
          report.frozenInputs.matrixSeedsPerProfile,
      );
      expect(profile.evBudgetBreaches).toBe(0);
      expect(profile.selectedBestRate).toBeGreaterThanOrEqual(0.86);
      expect(profile.selectedBestRate).toBeLessThanOrEqual(0.98);
    }
  });

  it("keeps decision difficulty below the anti-tell leakage threshold", () => {
    expect(Math.abs(report.timingLeakage.cutoffDelayCorrelation)).toBeLessThan(
      0.18,
    );
    expect(
      Math.abs(report.timingLeakage.uncertaintyDelayCorrelation),
    ).toBeLessThan(0.18);
    expect(
      Math.abs(report.timingLeakage.actionClassDelayCorrelation),
    ).toBeLessThan(0.2);
    expect(report.timingLeakage.minDelayMs).toBeGreaterThanOrEqual(650);
    expect(report.timingLeakage.maxDelayMs).toBeLessThanOrEqual(4_300);
  });

  it("completes every frozen tournament inside the policy-decision cap", () => {
    for (const mode of Object.values(report.tournaments)) {
      expect(mode.completed).toBe(report.frozenInputs.tournamentSeeds.length);
      expect(mode.maxDecisions).toBeLessThanOrEqual(
        report.runtimeBounds.tournamentDecisionCap,
      );
      expect(
        Object.values(mode.finishDistribution).reduce(
          (sum, finishes) => sum + finishes,
          0,
        ),
      ).toBe(mode.completed);
    }
  });
});
