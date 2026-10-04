/**
 * A screening job's export: what each format writes for the job and for one result. The
 * server streams CSV and JSON a page of results at a time (convex/exports.ts); the browser
 * builds the XLSX, since a workbook can't be written in parts.
 */
import type { ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { SearchSnapshot } from "@/convex/paperSets/openalex";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreeningExportJob {
  _id?: string;
  revision?: string;
  set?: { kind: string; searchId?: string; jobId?: string; collectionId?: string };
  snapshot?: SearchSnapshot;
  serverEffort?: string;
  first?: number;
  last?: number;
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
      stars: number;
    }>;
    minimumScore?: number;
  };
  totalPapers: number;
  qualifiedPapers: number;
  createdAt: number;
  completedAt?: number;
}

export interface ScreeningExportResult {
  resultId?: string;
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
  modelAnswers?: Record<string, boolean | null>;
  modelConfidences?: Record<string, number>;
  decisions?: Record<string, { by: "model" | "person" | "assistant" | "unrecorded"; at?: number }>;
  outcome?: string;
  model?: string;
  completedAt?: number;
}

type Questions = ScreeningExportJob["questions"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a screening answer for display.
 * Missing answers differ from answers the model or reviewer marked unclear.
 */
export function formatScreeningAnswer(
  answer: boolean | null | undefined,
): string {
  if (answer === true) return 'Yes';
  if (answer === false) return 'No';
  return answer === null ? 'Unclear' : 'Not answered';
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

/** The export's name without its extension: the day the job was made and how it ended. */
export function screeningExportName(job: Pick<ScreeningExportJob, "createdAt" | "status">): string {
  const date = new Date(job.createdAt).toISOString().slice(0, 10);
  return `screening-export-${date}-${job.status}`;
}

/** The columns of the results table: the paper, an answer per question, then the scoring. */
export function screeningHeaders(questions: Questions): string[] {
  return ['Title', 'Authors', 'Year', 'DOI', 'OpenAlex ID', ...questions.map((q) => `${q.key}: ${q.question}`), 'Score', 'Stars', 'Qualified', 'Status', 'Outcome', 'Result ID', 'Model', 'Completed at', ...questions.flatMap((q) => [`${q.key}: model answer`, `${q.key}: model confidence`, `${q.key}: decided by`, `${q.key}: decided at`])];
}

/** One result under those columns. Score and stars stay numbers, for a spreadsheet. */
export function screeningCells(questions: Questions, result: ScreeningExportResult): Array<string | number> {
  return [
    result.title,
    result.authors?.join('; ') ?? '',
    result.publicationYear?.toString() ?? '',
    result.doi ?? '',
    result.openalexId,
    ...questions.map((q) => formatScreeningAnswer(result.answers?.[q.key])),
    result.score ?? '',
    result.stars ?? '',
    result.qualified === undefined ? '' : result.qualified ? 'Yes' : 'No',
    result.status,
    result.outcome ?? '',
    result.resultId ?? '',
    result.model ?? '',
    result.completedAt === undefined ? '' : new Date(result.completedAt).toISOString(),
    ...questions.flatMap(({ key }) => [formatScreeningAnswer(result.modelAnswers?.[key]), result.modelConfidences?.[key] ?? '', result.decisions?.[key]?.by ?? 'unrecorded', result.decisions?.[key]?.at === undefined ? '' : new Date(result.decisions[key].at!).toISOString()]),
  ];
}

const csvLine = (cells: Array<string | number>) => cells.map((cell) => escapeCSVCell(String(cell))).join(',');
/** `text`, a value printed with two-space indentation, moved `by` spaces in. */
const indented = (text: string, by: number) => text.replace(/\n/g, `\n${' '.repeat(by)}`);

type Run = Pick<ScreeningExportJob, '_id' | 'revision' | 'set' | 'snapshot' | 'first' | 'last' | 'serverEffort' | 'scoringConfig'>;
const runProvenance = (job: Run) => ({ jobId: job._id ?? null, revision: job.revision ?? null, source: job.set ?? null, searchSnapshot: job.snapshot ?? null, first: job.first ?? null, last: job.last ?? null, effort: job.serverEffort ?? null, scoringConfig: job.scoringConfig });

/** Keep long metadata below Excel's cell limit without splitting a Unicode character. */
function metadataCells(value: unknown): string[] {
  const cells = [''];
  for (const character of JSON.stringify(value)) {
    if (cells[cells.length - 1].length + character.length > 32_000) cells.push('');
    cells[cells.length - 1] += character;
  }
  return cells;
}

/** One result in each format, as it follows the results before it. */
export const screeningItems = (questions: Questions, job: Run) => {
  const provenance = metadataCells(runProvenance(job));
  return {
  csv: (result: ScreeningExportResult, index: number) => `\n${csvLine([...screeningCells(questions, result), ...(index === 0 ? provenance : provenance.map((_, part) => part === 0 ? JSON.stringify({ jobId: job._id ?? null, revision: job.revision ?? null }) : ''))])}`,
  json: (result: ScreeningExportResult, index: number) =>
    `${index === 0 ? '' : ','}\n    ${indented(JSON.stringify({
      openalexId: result.openalexId,
      title: result.title,
      authors: result.authors ?? [],
      publicationYear: result.publicationYear ?? null,
      doi: result.doi ?? null,
      status: result.status,
      // Keys in one order whichever way the answers were read, as the export has always had them.
      answers: result.answers ? Object.fromEntries(Object.entries(result.answers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : null,
      score: result.score ?? null,
      stars: result.stars ?? null,
      qualified: result.qualified ?? null,
      outcome: result.outcome ?? null,
      resultId: result.resultId ?? null,
      model: result.model ?? null,
      completedAt: result.completedAt === undefined ? null : new Date(result.completedAt).toISOString(),
      modelAnswers: result.modelAnswers ?? null,
      modelConfidences: result.modelConfidences ?? null,
      decisions: result.decisions ?? null,
    }, null, 2), 4)}`,
  };
};

/**
 * A job's export as the server writes it: a start, each result, and an end. Put together
 * they are the file: for JSON, the same text as the whole export printed with two-space
 * indentation.
 */
export function screeningExportFiles(job: ScreeningExportJob) {
  const items = screeningItems(job.questions, job);
  return {
    name: () => screeningExportName(job),
    csv: {
      contentType: 'text/csv; charset=utf-8',
      start: () => `\ufeff${csvLine([...screeningHeaders(job.questions), ...metadataCells(runProvenance(job)).map((_, index) => index === 0 ? 'Run provenance' : `Run provenance continuation ${index + 1}`)])}`,
      item: items.csv,
      end: () => '',
    },
    json: {
      contentType: 'application/json; charset=utf-8',
      start: (exportedAt: Date) =>
        JSON.stringify({
          exportedAt: exportedAt.toISOString(),
          job: {
            id: job._id ?? null,
            revision: job.revision ?? null,
            source: job.set ?? null,
            searchSnapshot: job.snapshot ?? null,
            first: job.first ?? null,
            last: job.last ?? null,
            effort: job.serverEffort ?? null,
            status: job.status,
            createdAt: new Date(job.createdAt).toISOString(),
            completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : null,
            totalPapers: job.totalPapers,
            qualifiedPapers: job.qualifiedPapers,
            questions: job.questions,
            scoringConfig: job.scoringConfig,
          },
          results: [],
        }, null, 2).replace(/\[\]\n\}$/, '['),
      item: items.json,
      end: (count: number) => (count === 0 ? ']\n}' : '\n  ]\n}'),
    },
  };
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/**
 * Builds the workbook from a job and its results as they arrive, a page at a time: each
 * page's rows go straight into the sheet.
 */
export async function generateScreeningXLSXWorkbook(
  job: ScreeningExportJob,
  pages: AsyncIterable<ScreeningExportResult[]>,
): Promise<import('exceljs').Workbook> {
  // Dynamic import to keep ExcelJS out of the initial bundle
  const mod = await import('exceljs');
  const ExcelJSModule =
    'default' in mod
      ? (mod as unknown as { default: typeof mod }).default
      : mod;
  const workbook = new ExcelJSModule.Workbook();

  // ---- Results sheet ----
  const resultsSheet = workbook.addWorksheet('Results');
  resultsSheet.addRow(screeningHeaders(job.questions));
  let scored = 0;
  let scoreSum = 0;
  for await (const results of pages) {
    for (const result of results) {
      resultsSheet.addRow(screeningCells(job.questions, result));
      if (result.score !== undefined) {
        scored += 1;
        scoreSum += result.score;
      }
    }
  }

  // ---- Summary sheet ----
  const summarySheet = workbook.addWorksheet('Summary');

  // Section 1: Job Info
  summarySheet.addRow(['Job Info']);
  summarySheet.addRow(['Status', job.status]);
  summarySheet.addRow(['Job ID', job._id ?? '']);
  summarySheet.addRow(['Revision', job.revision ?? '']);
  summarySheet.addRow(['Minimum score', job.scoringConfig.minimumScore ?? '']);
  summarySheet.addRow(['Source', JSON.stringify(job.set ?? null)]);
  metadataCells(job.snapshot ?? null).forEach((cell, index) => summarySheet.addRow([index === 0 ? 'Search snapshot' : `Search snapshot continuation ${index + 1}`, cell]));
  summarySheet.addRow(['First paper', job.first ?? '']);
  summarySheet.addRow(['Last paper', job.last ?? '']);
  summarySheet.addRow(['Model effort', job.serverEffort ?? '']);
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
  summarySheet.addRow(['Min Score', 'Stars']);
  job.scoringConfig.starThresholds.forEach((t) => {
    summarySheet.addRow([t.minScore, t.stars]);
  });
  summarySheet.addRow([]); // spacer

  // Section 5: Statistics
  summarySheet.addRow(['Statistics']);
  const qualifiedRate =
    job.totalPapers > 0
      ? Math.round((job.qualifiedPapers / job.totalPapers) * 100)
      : 0;
  summarySheet.addRow(['Qualified Rate', `${qualifiedRate}%`]);

  const avgScore = scored > 0 ? scoreSum / scored : 0;
  summarySheet.addRow([
    'Average Score',
    Math.round(avgScore * 100) / 100,
  ]);

  return workbook;
}

/** Results one read takes while the workbook is built. */
const XLSX_PAGE_SIZE = 200;

/**
 * Downloads a job's results as an XLSX file, read a page at a time.
 * ponytail: the workbook is built whole in the browser, as XLSX needs. A job holds at most
 * MAX_SCREENING_PAPERS_PER_JOB papers; larger jobs would need a format that streams.
 */
export async function exportScreeningToXLSX(convex: ConvexReactClient, jobId: Id<"screeningJobs">): Promise<void> {
  const job = await convex.query(api.screening.queries.getScreeningJob, { jobId });
  if (!job) return;
  async function* pages() {
    let cursor: string | null = null;
    do {
      const page: { page: ScreeningExportResult[]; isDone: boolean; continueCursor: string } =
        await convex.query(api.screening.queries.listScreeningResults, { jobId, revision: job!.revision, paginationOpts: { cursor, numItems: XLSX_PAGE_SIZE } });
      yield page.page;
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
  }
  const workbook = await generateScreeningXLSXWorkbook(job, pages());
  const latest = await convex.query(api.screening.queries.getScreeningJob, { jobId });
  if (!latest || latest.revision !== job.revision) throw new Error('Screening changed during export. Download it again.');
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${screeningExportName(job)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
