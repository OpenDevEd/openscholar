/**
 * Screening export functions - pure formatting for CSV, JSON, and XLSX.
 * These receive already-fetched ScreeningExportData and produce downloadable files.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreeningExportData {
  job: {
    _id: string;
    status: string;
    questions: Array<{ key: string; question: string }>;
    scoringConfig: {
      rules: Array<{
        questionKey: string;
        yesPoints: number;
        noPoints: number;
        nullPoints: number;
      }>;
      starThresholds: Array<{
        minScore: number;
        maxScore: number;
        stars: number;
      }>;
      minimumScore?: number;
    };
    totalPapers: number;
    qualifiedPapers: number;
    createdAt: number;
    completedAt?: number;
  };
  results: Array<{
    openalexId: string;
    title: string;
    authors?: string[];
    publicationYear?: number;
    doi?: string;
    status: string;
    answers?: Record<string, boolean | null>;
    score?: number;
    stars?: number;
    qualified?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Triggers a browser file download.
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
 * Formats a screening answer for display.
 * true -> "Yes", false -> "No", null/undefined -> "N/A"
 */
export function formatScreeningAnswer(
  answer: boolean | null | undefined,
): string {
  if (answer === true) return 'Yes';
  if (answer === false) return 'No';
  return 'N/A';
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
 * Builds the date-based filename prefix.
 */
function buildFilename(
  data: ScreeningExportData,
  ext: string,
): string {
  const date = new Date(data.job.createdAt).toISOString().slice(0, 10);
  return `screening-export-${date}-${data.job.status}.${ext}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Generates a CSV string from screening export data.
 */
export function generateScreeningCSV(data: ScreeningExportData): string {
  const { job, results } = data;

  // Build headers
  const headers: string[] = [
    'Title',
    'Authors',
    'Year',
    'DOI',
    'OpenAlex ID',
  ];
  job.questions.forEach((q) => headers.push(q.question));
  headers.push('Score', 'Stars', 'Qualified', 'Status');

  // Build rows
  const rows = results.map((result) => {
    const row: string[] = [
      result.title,
      result.authors?.join('; ') ?? '',
      result.publicationYear?.toString() ?? '',
      result.doi ?? '',
      result.openalexId,
    ];

    // Question answers
    job.questions.forEach((q) => {
      row.push(formatScreeningAnswer(result.answers?.[q.key]));
    });

    // Scoring columns
    row.push(
      result.score !== undefined ? result.score.toString() : '',
      result.stars !== undefined ? result.stars.toString() : '',
      result.qualified !== undefined
        ? result.qualified
          ? 'Yes'
          : 'No'
        : '',
      result.status,
    );

    return row;
  });

  // Build CSV with escaping
  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCSVCell(String(cell))).join(','))
    .join('\n');
}

/**
 * Exports screening data as a CSV file download.
 */
export function exportScreeningToCSV(data: ScreeningExportData): void {
  const csv = generateScreeningCSV(data);
  downloadFile(csv, buildFilename(data, 'csv'), 'text/csv');
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/**
 * Generates a JSON string from screening export data.
 */
export function generateScreeningJSON(data: ScreeningExportData): string {
  const { job, results } = data;

  const envelope = {
    exportedAt: new Date().toISOString(),
    job: {
      status: job.status,
      createdAt: new Date(job.createdAt).toISOString(),
      completedAt: job.completedAt
        ? new Date(job.completedAt).toISOString()
        : null,
      totalPapers: job.totalPapers,
      qualifiedPapers: job.qualifiedPapers,
      questions: job.questions,
      scoringConfig: job.scoringConfig,
    },
    results: results.map((r) => ({
      openalexId: r.openalexId,
      title: r.title,
      authors: r.authors ?? [],
      publicationYear: r.publicationYear ?? null,
      doi: r.doi ?? null,
      status: r.status,
      answers: r.answers ?? null,
      score: r.score ?? null,
      stars: r.stars ?? null,
      qualified: r.qualified ?? null,
    })),
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Exports screening data as a JSON file download.
 */
export function exportScreeningToJSON(data: ScreeningExportData): void {
  const json = generateScreeningJSON(data);
  downloadFile(json, buildFilename(data, 'json'), 'application/json');
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/**
 * Generates an ExcelJS Workbook from screening export data.
 * Returns the workbook for testability.
 */
export async function generateScreeningXLSXWorkbook(
  data: ScreeningExportData,
): Promise<import('exceljs').Workbook> {
  const { job, results } = data;

  // Dynamic import to keep ExcelJS out of the initial bundle
  const mod = await import('exceljs');
  const ExcelJSModule =
    'default' in mod
      ? (mod as unknown as { default: typeof mod }).default
      : mod;
  const workbook = new ExcelJSModule.Workbook();

  // ---- Results sheet ----
  const resultsSheet = workbook.addWorksheet('Results');

  const headers: string[] = [
    'Title',
    'Authors',
    'Year',
    'DOI',
    'OpenAlex ID',
  ];
  job.questions.forEach((q) => headers.push(q.question));
  headers.push('Score', 'Stars', 'Qualified', 'Status');

  resultsSheet.addRow(headers);

  results.forEach((result) => {
    const row: (string | number)[] = [
      result.title,
      result.authors?.join('; ') ?? '',
      result.publicationYear?.toString() ?? '',
      result.doi ?? '',
      result.openalexId,
    ];

    job.questions.forEach((q) => {
      row.push(formatScreeningAnswer(result.answers?.[q.key]));
    });

    row.push(
      result.score !== undefined ? result.score : '',
      result.stars !== undefined ? result.stars : '',
      result.qualified !== undefined
        ? result.qualified
          ? 'Yes'
          : 'No'
        : '',
      result.status,
    );

    resultsSheet.addRow(row);
  });

  // ---- Summary sheet ----
  const summarySheet = workbook.addWorksheet('Summary');

  // Section 1: Job Info
  summarySheet.addRow(['Job Info']);
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
  summarySheet.addRow(['Qualified Papers', job.qualifiedPapers]);
  summarySheet.addRow([]); // spacer

  // Section 2: Screening Questions
  summarySheet.addRow(['Screening Questions']);
  job.questions.forEach((q) => {
    summarySheet.addRow([q.key, q.question]);
  });
  summarySheet.addRow([]); // spacer

  // Section 3: Scoring Rules
  summarySheet.addRow(['Scoring Rules']);
  summarySheet.addRow([
    'Question Key',
    'Yes Points',
    'No Points',
    'Null Points',
  ]);
  job.scoringConfig.rules.forEach((rule) => {
    summarySheet.addRow([
      rule.questionKey,
      rule.yesPoints,
      rule.noPoints,
      rule.nullPoints,
    ]);
  });
  summarySheet.addRow([]); // spacer

  // Section 4: Star Thresholds
  summarySheet.addRow(['Star Thresholds']);
  summarySheet.addRow(['Min Score', 'Max Score', 'Stars']);
  job.scoringConfig.starThresholds.forEach((t) => {
    summarySheet.addRow([t.minScore, t.maxScore, t.stars]);
  });
  summarySheet.addRow([]); // spacer

  // Section 5: Statistics
  summarySheet.addRow(['Statistics']);
  const qualifiedRate =
    job.totalPapers > 0
      ? Math.round((job.qualifiedPapers / job.totalPapers) * 100)
      : 0;
  summarySheet.addRow(['Qualified Rate', `${qualifiedRate}%`]);

  const scoredResults = results.filter((r) => r.score !== undefined);
  const avgScore =
    scoredResults.length > 0
      ? scoredResults.reduce((sum, r) => sum + r.score!, 0) /
        scoredResults.length
      : 0;
  summarySheet.addRow([
    'Average Score',
    Math.round(avgScore * 100) / 100,
  ]);

  return workbook;
}

/**
 * Exports screening data as an XLSX file download.
 */
export async function exportScreeningToXLSX(
  data: ScreeningExportData,
): Promise<void> {
  const workbook = await generateScreeningXLSXWorkbook(data);
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
