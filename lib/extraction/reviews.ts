export type ReviewState =
  | "unreviewed"
  | "accepted"
  | "rejected"
  | "needs_followup";

export function getReviewState(result: any): ReviewState | undefined {
  const state = (result as { reviewState?: string })?.reviewState;
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

export function isReviewed(result: any): boolean {
  const state = getReviewState(result);
  return state === "accepted" || state === "rejected" || state === "needs_followup";
}

export function getReviewLabel(state?: ReviewState): string | null {
  if (!state) return null;
  if (state === "accepted") return "Reviewed: accepted";
  if (state === "rejected") return "Reviewed: rejected";
  if (state === "needs_followup") return "Reviewed: follow-up";
  return "Unreviewed";
}
