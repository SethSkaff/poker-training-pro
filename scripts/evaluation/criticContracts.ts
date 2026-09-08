import {
  assertReviewerInputSafe,
  buildBlindedCriticInput,
  validateCriticOutput,
  type ReviewerInputV2,
  type ReviewerOutputV2,
} from "./criticInput";

export { assertReviewerInputSafe, buildBlindedCriticInput, validateCriticOutput };
export type { ReviewerInputV2, ReviewerOutputV2 };

export function assertCriticAuthorityIsNonBinding(output: ReviewerOutputV2 | null): void {
  if (output && (output as unknown as Record<string, unknown>).strategyAuthority !== undefined) {
    throw new Error("Critic output may not carry strategy authority");
  }
}
