import type { Doc } from "../../_generated/dataModel";
import { isTerminalPaperStatus } from "../paperLifecycle";

export function isInitialQueueEligible(
  paper: Doc<"extractionPapers">,
): boolean {
  if (paper.processable === false) return false;
  if (paper.questionsBilled === true) return false;
  return !isTerminalPaperStatus(paper.status);
}

export function isRetryQueueEligible(
  paper: Doc<"extractionPapers">,
): boolean {
  if (paper.processable === false) return false;
  return !isTerminalPaperStatus(paper.status);
}
