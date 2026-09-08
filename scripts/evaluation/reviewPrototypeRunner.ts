import {
  deriveHandReviewEvidence,
  type ReviewReplayEvidenceOptions,
} from "../../src/modes/handReviewPrototype";
import type {
  ReviewDecisionEvidenceV2,
  ReviewEvidenceEnvelopeV2,
  ReviewValueProvider,
} from "../../src/modes/reviewEvidence";
import { aggregateActionAudit, type ActionAuditInput } from "./metrics";
import type { ActionAuditReport } from "./report";
import type { TournamentRunnerReplay } from "../../src/modes/tournamentRunner";

export interface ReviewPrototypeRun {
  envelope: ReviewEvidenceEnvelopeV2;
  auditRows: ActionAuditInput[];
  actionAudit: ActionAuditReport;
  status: "complete" | "insufficient_evidence" | "cancelled";
}

function rowFor(decision: ReviewDecisionEvidenceV2): ActionAuditInput {
  const action = decision.playedAction;
  const support = action
    ? decision.candidateActionSupport.find((entry) => entry.opaquePublicActionId === action.key)
    : undefined;
  return {
    canonicalKind: action?.kind ?? "check",
    encounterId: decision.decisionId,
    familyId: decision.handId,
    blockId: decision.handId,
    objective: decision.objective,
    gradeEligible: decision.summaryEligibility.eligible,
    gradeReason: decision.summaryEligibility.exclusionReason ?? "eligible",
    supportStatus: support?.assessment.modelSupport ?? "unavailable",
    regretLower: decision.regretInterval?.lower ?? null,
    regretUpper: decision.regretInterval?.upper ?? null,
    grade: decision.grading.quality,
    traceLink: `offline-review:${decision.handId}:${decision.index}`,
    decisionStatus: decision.decisionStatus,
  };
}

export function reviewEnvelopeToActionAuditRows(
  envelope: ReviewEvidenceEnvelopeV2,
): ActionAuditInput[] {
  return envelope.decisions.map(rowFor);
}

export async function runReviewPrototype(
  replay: TournamentRunnerReplay,
  valueProvider: ReviewValueProvider,
  options: Omit<ReviewReplayEvidenceOptions, "valueProvider"> = {},
): Promise<ReviewPrototypeRun> {
  const envelope = await deriveHandReviewEvidence(replay, { ...options, valueProvider });
  const auditRows = reviewEnvelopeToActionAuditRows(envelope);
  const actionAudit = aggregateActionAudit(auditRows);
  return {
    envelope,
    auditRows,
    actionAudit,
    status: envelope.cancelled
      ? "cancelled"
      : envelope.supportedGradeCount > 0
        ? "complete"
        : "insufficient_evidence",
  };
}

export const runHandReviewPrototype = runReviewPrototype;
