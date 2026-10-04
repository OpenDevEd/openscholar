import type { PaperWithResults, Question } from './filtering';

type ResultsPage<Item> = { page: Item[]; isDone: boolean; continueCursor: string };

/**
 * Every paper of a results view, read one page per query so an export of any size stays
 * within Convex's per-query limits (#352). Pages are separate reads, so a paper whose
 * sort position or filter match changes mid-walk would be read twice or missed: the walk
 * starts again when a paper comes back twice or it ends with another number of papers
 * than the view counts, and gives up after `attempts` walks.
 */
export async function readEveryResultsPage<Item extends { _id: string }>(
  readPage: (cursor: string | null) => Promise<ResultsPage<Item>>,
  countMatching: () => Promise<number>,
  attempts = 3,
): Promise<Item[]> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const items = await walkResultsPages(readPage);
    if (items && items.length === (await countMatching())) return items;
  }
  throw new Error("The results kept changing while they were exported");
}

/** A view's pages, one read each. */
async function* resultsPages<Item>(readPage: (cursor: string | null) => Promise<ResultsPage<Item>>) {
  let cursor: string | null = null;
  do {
    const result = await readPage(cursor);
    yield result.page;
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor !== null);
}

/**
 * One walk over every page, or null when a paper came back twice.
 * ponytail: the papers are held whole in the browser, as the file formats need. A job holds
 * at most PAPER_LIMIT papers; larger jobs would need a format that streams.
 */
async function walkResultsPages<Item extends { _id: string }>(readPage: (cursor: string | null) => Promise<ResultsPage<Item>>) {
  const items: Item[] = [];
  const seen = new Set<string>();
  for await (const page of resultsPages(readPage)) {
    for (const item of page) {
      if (seen.has(item._id)) return null;
      seen.add(item._id);
      items.push(item);
    }
  }
  return items;
}

/**
 * Downloads a file with the given content
 */
function downloadFile(content: string | Blob, filename: string, mimeType: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Formats answer for CSV export
 */
export function formatAnswerForCSV(answer: string | number | boolean | string[] | null | undefined, type: string): string {
  if (answer === null || answer === undefined) return '';

  if (type === 'boolean') {
    return answer ? 'Yes' : 'No';
  }

  if (Array.isArray(answer)) {
    return answer.join('; ');
  }

  return String(answer);
}

/**
 * Formats answer for Excel export
 */
export function formatAnswerForExcel(answer: string | number | boolean | string[] | null | undefined, type: string): string | number {
  if (answer === null || answer === undefined) return '';

  if (type === 'boolean') {
    return answer ? 'Yes' : 'No';
  }

  if (Array.isArray(answer)) {
    return answer.join('; ');
  }

  if (type === 'number') {
    return Number(answer);
  }

  return String(answer);
}

export interface ExportOptions {
  includeMetadata?: boolean;
  includeConfidence?: boolean;
  includeReasoning?: boolean;
  includeCitations?: boolean;
}

const paperMetadataHeaders = ['Authors', 'Authors (unparsed)', 'Open Access', 'PDF Used', 'Venue', 'Citation Count', 'Work Type', 'Access Status', 'Open Access URL', 'PDF URL'];
const paperMetadataCells = (paper: PaperWithResults): string[] => [
  paper.authors?.join('; ') ?? '', paper.authorsUnparsed ?? '',
  paper.isOpenAccess === undefined ? 'Unknown' : paper.isOpenAccess ? 'Yes' : 'No',
  paper.pdfContentUsed ? 'Yes' : 'No', paper.venueName ?? '', paper.citedByCount?.toString() ?? '',
  paper.workType ?? '', paper.oaStatus ?? '', paper.oaUrl ?? '', paper.pdfUrl ?? '',
];

/**
 * Exports papers to CSV format
 */
export function exportToCSV(
  papers: PaperWithResults[],
  questions: Question[],
  options: ExportOptions = {}
): void {
  const {
    includeMetadata = true,
    includeConfidence = true,
  } = options;

  const headers: string[] = [
    'Paper Title',
    'DOI',
    'Year',
  ];

  if (includeMetadata) {
    headers.push(...paperMetadataHeaders);
  }

  // Add question columns
  questions.forEach(q => {
    headers.push(q.question);
  });

  // Add confidence columns
  if (includeConfidence) {
    questions.forEach(q => {
      headers.push(`${q.question} (Confidence)`);
    });
  }

  const rows = papers.map(paper => {
    const row: string[] = [
      paper.title,
      paper.doi || '',
      paper.publicationYear?.toString() || '',
    ];

    if (includeMetadata) {
      row.push(...paperMetadataCells(paper));
    }

    // Add answers
    questions.forEach(q => {
      const result = paper.results.find(r => r.questionKey === q.key);
      const answer = result?.answer;
      row.push(formatAnswerForCSV(answer, q.type));
    });

    // Add confidence scores
    if (includeConfidence) {
      questions.forEach(q => {
        const result = paper.results.find(r => r.questionKey === q.key);
        row.push(result?.confidence ? `${Math.round(result.confidence * 100)}%` : '');
      });
    }

    return row;
  });

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  downloadFile(csv, `extraction-results-${Date.now()}.csv`, 'text/csv');
}

/**
 * Exports papers to JSON format
 */
export function exportToJSON(
  papers: PaperWithResults[],
  questions: Question[],
  options: ExportOptions = {}
): void {
  const {
    includeReasoning = true,
    includeCitations = true,
  } = options;

  const data = {
    exportedAt: new Date().toISOString(),
    totalPapers: papers.length,
    questions: questions.map(q => ({
      key: q.key,
      question: q.question,
      type: q.type,
      description: q.description,
    })),
    papers: papers.map(paper => ({
      id: paper._id,
      title: paper.title,
      doi: paper.doi,
      year: paper.publicationYear,
      authors: paper.authors,
      authorsUnparsed: paper.authorsUnparsed,
      venue: paper.venueName,
      citedByCount: paper.citedByCount,
      workType: paper.workType,
      oaStatus: paper.oaStatus,
      oaUrl: paper.oaUrl,
      pdfUrl: paper.pdfUrl,
      openAccess: paper.isOpenAccess,
      pdfUsed: paper.pdfContentUsed,
      results: paper.results.map(r => ({
        questionKey: r.questionKey,
        answer: r.answer,
        confidence: r.confidence,
        ...(includeReasoning && { reasoning: r.reasoning }),
        ...(includeCitations && {
          citations: r.citations ?? [],
          citationStatus: r.citationStatus,
        }),
      })),
    })),
  };

  const json = JSON.stringify(data, null, 2);
  downloadFile(json, `extraction-results-${Date.now()}.json`, 'application/json');
}

/**
 * Exports papers to Excel format using ExcelJS (dynamically imported).
 */
export async function exportToExcel(
  papers: PaperWithResults[],
  questions: Question[],
  options: ExportOptions = {}
): Promise<void> {
  const {
    includeMetadata = true,
    includeConfidence = true,
    includeReasoning = false,
  } = options;

  // Dynamic import to keep ExcelJS (~500KB) out of the initial bundle
  const mod = await import('exceljs');
  const ExcelJSModule = 'default' in mod ? (mod as unknown as { default: typeof mod }).default : mod;
  const workbook = new ExcelJSModule.Workbook();

  // Sheet 1: Results
  const resultsSheet = workbook.addWorksheet('Results');

  // Build headers
  const headers: string[] = ['Title', 'DOI', 'Year'];
  if (includeMetadata) {
    headers.push(...paperMetadataHeaders);
  }
  questions.forEach(q => {
    headers.push(q.question);
    if (includeConfidence) {
      headers.push(`${q.question} (Confidence)`);
    }
    if (includeReasoning) {
      headers.push(`${q.question} (Reasoning)`);
    }
  });
  resultsSheet.addRow(headers);

  // Add data rows
  papers.forEach(paper => {
    const row: (string | number | undefined)[] = [
      paper.title,
      paper.doi || '',
      paper.publicationYear || '',
    ];

    if (includeMetadata) {
      row.push(...paperMetadataCells(paper));
    }

    questions.forEach(q => {
      const result = paper.results.find(r => r.questionKey === q.key);
      const answer = result?.answer;
      row.push(formatAnswerForExcel(answer, q.type));

      if (includeConfidence) {
        row.push(
          result?.confidence
            ? Math.round(result.confidence * 100) / 100
            : ''
        );
      }

      if (includeReasoning) {
        row.push(result?.reasoning || '');
      }
    });

    resultsSheet.addRow(row);
  });

  // Sheet 2: Questions
  const questionsSheet = workbook.addWorksheet('Questions');
  questionsSheet.addRow(['Key', 'Question', 'Type', 'Description']);
  questions.forEach(q => {
    questionsSheet.addRow([q.key, q.question, q.type, q.description || '']);
  });

  // Sheet 3: Summary statistics
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.addRow(['Question', 'Average Confidence', 'Completed', 'Total Papers', 'Completion Rate']);
  const totalPapers = papers.length;
  questions.forEach(q => {
    const results = papers.map(p => p.results.find(r => r.questionKey === q.key));
    const validResults = results.filter(r => r?.confidence !== undefined);
    const avg = validResults.reduce((sum, r) => sum + (r!.confidence || 0), 0) / (validResults.length || 1);
    summarySheet.addRow([
      q.question,
      Math.round(avg * 100) / 100,
      validResults.length,
      totalPapers,
      `${Math.round((validResults.length / totalPapers) * 100)}%`,
    ]);
  });

  // Write to buffer and trigger download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadFile(
    blob,
    `extraction-results-${Date.now()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}
