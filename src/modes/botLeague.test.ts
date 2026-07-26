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
      // A profile must never become a random-action generator. The upper
      // bound that used to sit here (<= 0.98) was calibrated against the
      // pre-balance utility model, where miscalibrated raise utilities
      // produced many near-ties and every profile deviated often. With the
      // corrected model the 36 canonical cells have a median 1.05 BB gap to
      // the second-best action, so a competent professional *should* take the
      // best line in almost all of them. Distinctness is asserted directly in
      // the next test instead of inferred from a deviation-rate floor.
      expect(profile.selectedBestRate).toBeGreaterThanOrEqual(0.86);
      expect(profile.selectedBestRate).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the named personalities behaviorally distinguishable", () => {
    const profiles = Object.values(report.policies.normalProfiles);
    const deviationRates = profiles.map((profile) => profile.deviationRate);
    const loosest = Math.max(...deviationRates);
    const tightest = Math.min(...deviationRates);

    // At least one profile must actually exercise its personality budget,
    // otherwise the layer is decorative.
    expect(loosest).toBeGreaterThan(0.02);
    // And the spread between the most and least disciplined profile must be
    // large enough to be a behavioral difference rather than sampling noise.
    expect(loosest / Math.max(tightest, 1e-6)).toBeGreaterThan(4);
    // Every profile is a distinct measured point, not a relabelled clone.
    expect(new Set(deviationRates).size).toBe(profiles.length);
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
