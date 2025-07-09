import type { ScreeningDocument, ScreeningQuestion } from '@/lib/store';

// Batch processing configuration
export const DEFAULT_BATCH_SIZE = 5; // Process 5 documents at a time
export const MAX_PARALLEL_REQUESTS = 3; // Maximum parallel requests per batch

// AI Model constants
export const OPENAI_MODEL = 'gpt-4o-mini';
export const GOOGLE_MODEL = 'gemini-2.5-flash-lite-preview-06-17';

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
8. Provide reasoning for your decisions
9. Flag any concerns or limitations in the document
10. Rate your confidence in the screening results

Remember: This is a systematic review screening, so accuracy and consistency are crucial.`;
}

// Generate user prompt for a specific document
export function generateUserPrompt(document: ScreeningDocument, questions: ScreeningQuestion[]): string {
  const questionList = questions.map(q => 
    `${q.key}: ${q.question} (Expected type: ${q.type})`
  ).join('\n');

  return `Please screen this document:

TITLE: ${document.title}

AUTHORS: ${document.authorships?.map(a => a.author.display_name).join(', ') || 'Not available'}

PUBLICATION YEAR: ${document.publication_year || 'Not available'}

ABSTRACT: ${document.abstract || 'Abstract not available'}

DOI: ${document.doi || 'Not available'}

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

// Utility function to estimate screening time
export function estimateScreeningTime(
  documentCount: number,
  questionCount: number,
  batchSize: number = DEFAULT_BATCH_SIZE
): { estimatedMinutes: number; totalBatches: number } {
  // Rough estimates based on typical AI response times
  const avgSecondsPerDocument = 3; // Conservative estimate
  const batchOverheadSeconds = 2;
  const totalBatches = Math.ceil(documentCount / batchSize);
  
  const documentsPerBatch = Math.min(batchSize, documentCount);
  const parallelChunks = Math.ceil(documentsPerBatch / MAX_PARALLEL_REQUESTS);
  
  const estimatedSeconds = totalBatches * (
    (parallelChunks * avgSecondsPerDocument) + batchOverheadSeconds
  );
  
  return {
    estimatedMinutes: Math.ceil(estimatedSeconds / 60),
    totalBatches,
  };
} 