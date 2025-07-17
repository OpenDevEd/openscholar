import type { ScreeningDocument, ScreeningQuestion } from '@/lib/store';

// Batch processing configuration
export const DEFAULT_BATCH_SIZE = 5; // Process 5 documents at a time
export const MAX_PARALLEL_REQUESTS = 3; // Maximum parallel requests per batch

// AI Model constants
export const OPENAI_MODEL = 'o4-mini-2025-04-16';
export const GOOGLE_MODEL = 'gemini-2.5-flash';
export const PRICING = {
  [OPENAI_MODEL]: {
    input: 1.10,
    output: 4.40,
  },
  [GOOGLE_MODEL]: {
    input: 0.10,
    output: 0.40,
  },
}

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

// Utility function to estimate screening time
export function estimateScreeningTime(
  documentCount: number,
  questionCount: number,
  batchSize: number = DEFAULT_BATCH_SIZE
): { estimatedMinutes: number; totalBatches: number } {
  // Rough estimates based on typical AI response times
  const avgSecondsPerDocument = 15; // Conservative estimate
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

// ---- CSV export ----
export function generateScreeningCsv(rows: any[], questions: ScreeningQuestion[]): string {
  const csvEscape = (val: any) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    return `"${str.replace(/"/g, '""')}"`;
  };

  const hasZotero = rows.some(r => r.source === 'zotero');

  const headers = [
    'ID',
    ...(hasZotero ? ['Group ID', 'Zotero URI'] : []),
    'Title', 'Abstract', 'Authors', 'Year', 'Status', 'Completed At', 'PDF Status',
    'AI Provider', 'AI Confidence', 'AI Flags', 'AI Reasoning', 'Cost',
    ...questions.map(q => csvEscape(q.question))
  ];

  const csvLines = rows.map(row => {
    const idDisplay = row.source === 'zotero'
      ? (row.id as string).replace(/^zotero_/, '')
      : (row.id as string).split('/').pop() ?? row.id;

    const base = [
      csvEscape(idDisplay),
      ...(hasZotero ? [csvEscape(row.zotero_group_id || ''), csvEscape(row.zotero_uri || '')] : []),
      csvEscape(row.title),
      csvEscape(row.abstract || ''),
      csvEscape(Array.isArray(row.authors) ? row.authors.join('; ') : String(row.authors)),
      csvEscape(row.year),
      csvEscape(row.status),
      csvEscape(row.completedAt ? new Date(row.completedAt).toLocaleDateString() : ''),
      csvEscape(row.pdfStatus),
      csvEscape(row.aiProvider),
      csvEscape(row.aiConfidence),
      // aiFlags: always semicolon separated and escaped
      Array.isArray(row.aiFlags) ? csvEscape(row.aiFlags.join('; ')) : csvEscape(row.aiFlags),
      csvEscape(row.aiReasoning),
      csvEscape(row.cost ?? ''),
    ];

    const answerVals = questions.map(q => {
      const v = row[q.key];
      if (Array.isArray(v)) {
        if (v.length === 0) return csvEscape('—');
        const trimmed = v.map(item => (typeof item === 'string' ? item.trim() : String(item)));
        return csvEscape(trimmed.join('; '));
      }
      if (typeof v === 'string') {
        return csvEscape(v.trim() ?? '—');
      }
      return csvEscape(v ?? '—');
    });

    return [...base, ...answerVals].join(',');
  });

  return [headers.join(','), ...csvLines].join('\n');
} 