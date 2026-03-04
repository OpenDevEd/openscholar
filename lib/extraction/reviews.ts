export type ReviewState =
  | "unreviewed"
  | "accepted"
  | "rejected"
  | "needs_followup";

/** Minimal shape for extraction result fields used by review helpers. */
interface ReviewResultLike {
  reviewState?: string;
}

export function getReviewState(result: ReviewResultLike | null | undefined): ReviewState | undefined {
  const state = result?.reviewState;
  if (
    state === "unreviewed" ||
    state === "accepted" ||
    state === "rejected" ||
    state === "needs_followup"
  ) {
    return state;
  }
  return undefined;
}

export function isReviewed(result: ReviewResultLike | null | undefined): boolean {
  const state = getReviewState(result);
  return state === "accepted" || state === "rejected" || state === "needs_followup";
}

export type ReviewLabelKey =
  | "reviewedAccepted"
  | "reviewedRejected"
  | "reviewedFollowUp";

export function getReviewLabel(state?: ReviewState): ReviewLabelKey | null {
  if (!state) return null;
  if (state === "accepted") return "reviewedAccepted";
  if (state === "rejected") return "reviewedRejected";
  if (state === "needs_followup") return "reviewedFollowUp";
  return null;
}
