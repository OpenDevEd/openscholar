import type { ScreeningDocument, ScreeningQuestion, ScreeningQuestionEntry, ScreeningResponses } from '@/lib/types';

// Batch processing configuration
export const DEFAULT_BATCH_SIZE = 5; // Process 5 documents at a time
export const MAX_PARALLEL_REQUESTS = 3; // Maximum parallel requests per batch

// Generate system prompt for screening
export function generateSystemPrompt(questions: ScreeningQuestion[]): string {
  const questionDescriptions = questions.map(q => 
    `- ${q.key} (${q.type}): ${q.question}`
  ).join('\n');

  return `You are an expert research assistant conducting systematic literature screening. 

Always output responses as **valid JSON** that conforms exactly to the provided schema, with no additional keys or explanations. Do NOT wrap JSON in markdown or code fences.
 
Your task is to carefully analyze academic papers and answer specific screening questions based on their content.

SCREENING QUESTIONS:
${questionDescriptions}

INSTRUCTIONS:
1. Read the document title, abstract, and any available content carefully
2. Answer each question based on the evidence in the document
3. For boolean questions: answer true/false based on clear evidence
4. For string questions: provide concise, specific answers
5. For number questions: extract or estimate numerical values when possible
6. For array questions: provide relevant items as a list
7. Be conservative - if unclear, err on the side of exclusion
8. If the required information is not mentioned or not applicable, respond with the single em-dash character "—" (for arrays, return an empty list [])
9. Provide reasoning for your decisions
10. Flag any concerns or limitations in the document
11. Rate your confidence in the screening results

Remember: This is a systematic review screening, so accuracy and consistency are crucial.`;
}

// Generate user prompt for a specific document
export function generateUserPrompt(document: ScreeningDocument, questions: ScreeningQuestion[], usePdfs: boolean = false): string {
  const questionList = questions.map(q => 
    `${q.key}: ${q.question} (Expected type: ${q.type})`
  ).join('\n');

  let documentContent = `TITLE: ${document.title}

AUTHORS: ${document.authorships?.map(a => a.author.display_name).join(', ') || 'Not available'}

PUBLICATION YEAR: ${document.publication_year || 'Not available'}

ABSTRACT: ${document.abstract || 'Abstract not available'}

DOI: ${document.doi || 'Not available'}`;

  // Only add PDF status information if PDFs are requested but not available
  // When PDFs are available, they will be included as file attachments
  if (usePdfs && !document.open_access?.oa_url) {
    documentContent += `

PDF STATUS: Not available - Analysis based on metadata only`;
  }

  return `Please screen this document:

${documentContent}

QUESTIONS TO ANSWER:
${questionList}

RESPONSE FORMAT (JSON):
{
  "responses": { /* answers corresponding to each key */ },
  "reasoning": "string",
  "confidence": number,  // 0-1
  "flags": [ "string", ... ]
}

Return ONLY this JSON object, without any markdown or additional keys.`;
}

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