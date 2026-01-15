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