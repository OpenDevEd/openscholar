/**
 * Extraction export functions - pure formatting for CSV, JSON, and XLSX.
 * These receive already-fetched ExtractionExportData and produce downloadable files.
 *
 * Pattern cloned from lib/screening/export.ts (D-17, D-18).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Matches the return shape of getExtractionResultsForExport (D-20).
 * One row per paper-question pair, pre-denormalized for export serialization.
 */
export interface ExtractionExportData {
  job: {
    _id: string;
    status: string;
    questions: Array<{ key: string; question: string }>;
    totalPapers: number;
    createdAt: number;
    completedAt?: number;
  };
  results: Array<{
    paperTitle: string;
    openalexId: string;
    doi?: string;
    parsingSource?: string;
    questionKey: string;
    question: string;
    answer: string | null;
    confidence?: string;
    criticVerdict?: string;
    evidenceStartChar?: number;
    evidenceEndChar?: number;
    reasoning?: string;
    modelUsed?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Triggers a browser file download via Blob URL + link click.
 */
function downloadFile(
  content: string | Blob,
  filename: string,
  mimeType: string,
): void {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType });
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
 * Escapes a CSV cell value: wraps in quotes if it contains comma, quote, or newline.
 */
function escapeCSVCell(value: string): string {
  if (
    value.includes('"') ||
    value.includes(',') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a date-based filename for extraction exports.
 * Format: extraction-export-{YYYY-MM-DD}-{status}.{ext}
 */
function buildFilename(data: ExtractionExportData, ext: string): string {
  const date = new Date(data.job.createdAt).toISOString().slice(0, 10);
  return `extraction-export-${date}-${data.job.status}.${ext}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Generates a CSV string from extraction export data.
 * One row per paper-question result.
 */
export function generateExtractionCSV(data: ExtractionExportData): string {
  const headers: string[] = [
    'Paper Title',
    'OpenAlex ID',
    'DOI',
    'Parsing Source',
    'Question',
    'Answer',
    'Confidence',
    'Critic Verdict',
    'Reasoning',
    'Model Used',
  ];

  const rows = data.results.map((r) => [
    r.paperTitle,
    r.openalexId,
    r.doi ?? '',
    r.parsingSource ?? '',
    r.question,
    r.answer ?? '',
    r.confidence ?? '',
    r.criticVerdict ?? '',
    r.reasoning ?? '',
    r.modelUsed ?? '',
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCSVCell(String(cell))).join(','))
    .join('\n');
}

/**
 * Exports extraction data as a CSV file download.
 */
export function exportExtractionToCSV(data: ExtractionExportData): void {
  const csv = generateExtractionCSV(data);
  downloadFile(csv, buildFilename(data, 'csv'), 'text/csv');
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/**
 * Generates a JSON string from extraction export data.
 * Wraps in a metadata envelope for self-describing exports.
 */
export function generateExtractionJSON(data: ExtractionExportData): string {
  const { job, results } = data;

  const envelope = {
    metadata: {
      jobId: job._id,
      status: job.status,
      totalPapers: job.totalPapers,
      exportedAt: new Date().toISOString(),
      questionCount: job.questions.length,
    },
    results: results.map((r) => ({
      paperTitle: r.paperTitle,
      openalexId: r.openalexId,
      doi: r.doi ?? null,
      parsingSource: r.parsingSource ?? null,
      questionKey: r.questionKey,
      question: r.question,
      answer: r.answer,
      confidence: r.confidence ?? null,
      criticVerdict: r.criticVerdict ?? null,
      evidenceStartChar: r.evidenceStartChar ?? null,
      evidenceEndChar: r.evidenceEndChar ?? null,
      reasoning: r.reasoning ?? null,
      modelUsed: r.modelUsed ?? null,
    })),
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Exports extraction data as a JSON file download.
 */
export function exportExtractionToJSON(data: ExtractionExportData): void {
  const json = generateExtractionJSON(data);
  downloadFile(json, buildFilename(data, 'json'), 'application/json');
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/**
 * Generates an ExcelJS Workbook from extraction export data.
 * Returns the workbook for testability.
 *
 * Creates two sheets:
 * - "Results": one row per paper-question result (same columns as CSV)
 * - "Summary": job metadata (ID, status, paper count, question count, dates)
 */
export async function generateExtractionXLSXWorkbook(
  data: ExtractionExportData,
): Promise<import('exceljs').Workbook> {
  const { job, results } = data;

  // Dynamic import to keep ExcelJS out of the initial bundle (~500KB savings)
  const mod = await import('exceljs');
  const ExcelJSModule =
    'default' in mod
      ? (mod as unknown as { default: typeof mod }).default
      : mod;
  const workbook = new ExcelJSModule.Workbook();

  // ---- Results sheet ----
  const resultsSheet = workbook.addWorksheet('Results');

  const headers: string[] = [
    'Paper Title',
    'OpenAlex ID',
    'DOI',
    'Parsing Source',
    'Question',
    'Answer',
    'Confidence',
    'Critic Verdict',
    'Reasoning',
    'Model Used',
  ];

  resultsSheet.addRow(headers);

  results.forEach((r) => {
    resultsSheet.addRow([
      r.paperTitle,
      r.openalexId,
      r.doi ?? '',
      r.parsingSource ?? '',
      r.question,
      r.answer ?? '',
      r.confidence ?? '',
      r.criticVerdict ?? '',
      r.reasoning ?? '',
      r.modelUsed ?? '',
    ]);
  });

  // ---- Summary sheet ----
  const summarySheet = workbook.addWorksheet('Summary');

  summarySheet.addRow(['Job Info']);
  summarySheet.addRow(['Job ID', job._id]);
  summarySheet.addRow(['Status', job.status]);
  summarySheet.addRow([
    'Created',
    new Date(job.createdAt).toISOString(),
  ]);
  summarySheet.addRow([
    'Completed',
    job.completedAt ? new Date(job.completedAt).toISOString() : 'N/A',
  ]);
  summarySheet.addRow(['Total Papers', job.totalPapers]);
  summarySheet.addRow(['Question Count', job.questions.length]);
  summarySheet.addRow([]); // spacer

  // Questions list
  summarySheet.addRow(['Extraction Questions']);
  summarySheet.addRow(['Key', 'Question']);
  job.questions.forEach((q) => {
    summarySheet.addRow([q.key, q.question]);
  });

  return workbook;
}

/**
 * Exports extraction data as an XLSX file download.
 */
export async function exportExtractionToXLSX(
  data: ExtractionExportData,
): Promise<void> {
  const workbook = await generateExtractionXLSXWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadFile(
    blob,
    buildFilename(data, 'xlsx'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
