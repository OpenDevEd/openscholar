import type { ScreeningQuestionEntry, ScreeningResponses } from '@/lib/types';

/**
 * Generate missing combinations grouped by paper
 * @param currentPagePapers - Array of papers on the current page
 * @param screeningQuestions - Array of screening questions
 * @param existingResponses - Existing screening responses object
 * @returns Object with paperId as key and array of missing questions as value
 */
export function generateMissingScreeningCombinationsByPaper(
  currentPagePapers: { id: string }[],
  screeningQuestions: ScreeningQuestionEntry[],
  existingResponses: ScreeningResponses
): Record<string, string[]> {
  const missingByPaper: Record<string, string[]> = {};

  // Initialize with all paper IDs
  for (const paper of currentPagePapers) {
    missingByPaper[paper.id] = [];
  }

  // Iterate through each paper and question to find missing combinations
  for (const paper of currentPagePapers) {
    const paperId = paper.id;
    const paperResponses = existingResponses[paperId] || {};

    for (const questionEntry of screeningQuestions) {
      const question = questionEntry.question;

      // If this combination doesn't have a response, add it
      if (!(question in paperResponses)) {
        missingByPaper[paperId].push(question);
      }
    }
  }

  // Remove papers with no missing questions
  Object.keys(missingByPaper).forEach(paperId => {
    if (missingByPaper[paperId].length === 0) {
      delete missingByPaper[paperId];
    }
  });

  return missingByPaper;
}

/**
 * Build a stable, order-independent batch key for screening dedup.
 *
 * The key encodes:
 *   - The set of papers actually needing work (those with non-empty missing-question lists).
 *   - For each such paper, its missing questions sorted by question text.
 *   - The current `testIndexPerQuestion` per question, so a "Test" click
 *     on a single question bumps that question's index and produces a
 *     fresh batch key (forcing the dedup-ref to allow a re-fire).
 *
 * Returns null when there is nothing to fetch — the consumer should skip the batch.
 */
export function buildScreeningBatchKey(
  papersToProcess: { id: string }[],
  missingResponses: Record<string, string[]>,
  testIndexPerQuestion: Record<string, number>,
): string | null {
  const paperIds = papersToProcess
    .map((paper) => paper.id)
    .filter((paperId) => (missingResponses[paperId]?.length ?? 0) > 0)
    .sort();

  if (paperIds.length === 0) return null;

  const keyParts = paperIds.map((id) => {
    const questions = missingResponses[id] || [];
    const questionsWithIndex = questions
      .map((question) => `${question}#${testIndexPerQuestion[question] || 0}`)
      .sort();
    return `${id}:${questionsWithIndex.join(",")}`;
  });

  return keyParts.join("|");
}
