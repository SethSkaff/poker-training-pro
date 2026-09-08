import { describe, expect, it } from "vitest";
import { actionSupportViewFromAssessment, canonicalReviewActionKey, type ReviewCanonicalAction } from "./reviewEvidence";
import type { ActionSupportAssessment } from "../lib/actionSupport";

const action: ReviewCanonicalAction = {
  key: "raise:300",
  kind: "raise",
  targetChips: 300,
  investedChips: 300,
  raisesCurrentBet: true,
  raiseByChips: 200,
  isActorAllIn: false,
  stackOffClass: "none",
  isFullRaise: true,
  isShortAllInIncrease: false,
};

const assessment: ActionSupportAssessment = {
  schemaVersion: 1,
  assessmentVersion: "action-support-v1",
  semanticKey: "raise:300",
  observerScope: "public",
  evidenceScopeId: "fixture-scope",
  modelId: "fixture-model",
  modelVersion: "fixture-v1",
  objective: "chip_ev",
  inputIdentity: "fixture-input",
  mechanicalValidity: "valid",
  modelSupport: "supported",
  actionEvidence: "supported_unusual",
  reasonCodes: ["fixture"],
  measurements: { size: { value: 3, unit: "pot", basis: "fixture" } },
  limitations: [],
  evidencePaths: ["fixture://support"],
  authority: "evidence_only",
};

describe("A08 browser-safe review evidence DTO", () => {
  it("projects support facts without recommendation or authority fields", () => {
    const view = actionSupportViewFromAssessment(action, assessment, ["conditioned:fixture"]);
    expect(canonicalReviewActionKey(action)).toBe("raise:300");
    expect(view.semanticFacts.targetChips).toBe(300);
    expect(view.assessment.authority).toBe("evidence_only");
    expect((view as unknown as Record<string, unknown>).recommendation).toBeUndefined();
  });
});
