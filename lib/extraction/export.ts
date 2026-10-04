import type { PaperWithResults, Question } from './filtering';
import { PAPER_LIMIT } from './limits';

export class ExtractionExportError extends Error {
  constructor(readonly code: "exportChanged" | "excelCellLimit" | "excelRowLimit") { super(code); }
}

type ResultsPage<Item> = { page: Item[]; isDone: boolean; continueCursor: string };

/** Metadata and all pages belong to one saved revision, including same-count edits. */
export async function readExtractionExport<Item extends { _id: string }, Metadata extends object>(
  readPage: (cursor: string | null) => Promise<ResultsPage<Item>>,
  readState: () => Promise<{ matching: number; revision: number | null }>,
  readMetadata: () => Promise<Metadata>,
  options: { attempts?: number; signal?: AbortSignal } = {},
): Promise<Metadata & { papers: Item[] }> {
  for (let attempt = 1; attempt <= (options.attempts ?? 3); attempt++) {
    options.signal?.throwIfAborted();
    const before = await readState();
    if (before.revision === null) throw new ExtractionExportError("exportChanged");
    const metadata = await readMetadata();
    const items = await walkResultsPages(async cursor => { options.signal?.throwIfAborted(); return readPage(cursor); });
    const after = await readState();
    options.signal?.throwIfAborted();
    if (items && items.length === after.matching && before.revision === after.revision) return { ...metadata, papers: items };
  }
  throw new ExtractionExportError("exportChanged");
}

/** A view's pages, one read each. */
async function* resultsPages<Item>(readPage: (cursor: string | null) => Promise<ResultsPage<Item>>) {
  let cursor: string | null = null;
  let pages = 0;
  do {
    const result = await readPage(cursor);
    yield result.page;
    if (!result.isDone && (!result.continueCursor || result.continueCursor === cursor || ++pages > PAPER_LIMIT)) throw new ExtractionExportError("exportChanged");
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
      if (items.length > PAPER_LIMIT) throw new ExtractionExportError("exportChanged");
    }
  }
  return items;
}

/** All formats use the same saved facts. Missing historical facts stay null. */
export interface ExportOptions {
  includeMetadata?: boolean;
  includeConfidence?: boolean;
  includeReasoning?: boolean;
  includeCitations?: boolean;
  job?: Pick<import("@/convex/_generated/dataModel").Doc<"extractionJobs">, "_id" | "name" | "status" | "runEpoch" | "usePdfs" | "sourceType" | "serverModelId" | "serverEffort" | "decisionModelId" | "createdAt" | "updatedAt">;
  signal?: AbortSignal;
}

export type ExtractionExport = { papers: PaperWithResults[]; questions: Question[]; job?: ExportOptions["job"] };

function exportRecord(papers: PaperWithResults[], questions: Question[], options: ExportOptions) {
  const { includeMetadata = true, includeConfidence = true, includeReasoning = true, includeCitations = true, job } = options;
  return {
    format: "openscholar.extraction",
    version: 2,
    exportedAt: new Date().toISOString(),
    totalPapers: papers.length,
    job: {
      id: job?._id ?? papers[0]?.jobId ?? null,
      name: job?.name ?? null,
      status: job?.status ?? null,
      runEpoch: job?.runEpoch ?? null,
      pdfEnabled: job?.usePdfs ?? null,
      sourceType: job?.sourceType ?? null,
      selectedModelId: job?.serverModelId ?? null,
      selectedEffort: job?.serverEffort ?? null,
      selectedDecisionModelId: job?.decisionModelId ?? null,
      createdAt: job?.createdAt ?? null,
      updatedAt: job?.updatedAt ?? null,
    },
    questions: questions.map(q => ({ key: q.key, question: q.question, type: q.type, description: q.description ?? null })),
    papers: papers.map(paper => ({
      id: paper._id,
      openalexId: paper.openalexId,
      title: paper.title,
      doi: paper.doi ?? null,
      year: paper.publicationYear ?? null,
      ...(includeMetadata && {
        authors: paper.authors ?? null,
        authorsUnparsed: paper.authorsUnparsed ?? null,
        abstract: paper.abstract ?? null,
        venue: paper.venueName ?? null,
        citedByCount: paper.citedByCount ?? null,
        workType: paper.workType ?? null,
        oaStatus: paper.oaStatus ?? null,
        oaUrl: paper.oaUrl ?? null,
        pdfUrl: paper.pdfUrl ?? null,
        openAccess: paper.isOpenAccess ?? null,
        pdfUsed: paper.pdfContentUsed ?? null,
      }),
      results: questions.map(q => {
        const r = paper.results.find(result => result.questionKey === q.key);
        const sources = [...new Set((r?.citations ?? []).map(c => c.source ?? "pdf"))];
        return {
          questionKey: q.key,
          questionType: q.type,
          answer: r?.answer ?? null,
          status: r ? r.status ?? "unknown" : "missing",
          citationStatus: r?.citationStatus ?? null,
          source: sources.length ? sources.join("+") : r?.pdfContentUsed === true ? "pdf" : r?.pdfContentUsed === false ? "abstract" : null,
          model: r?.model ?? null,
          provider: r?.provider ?? null,
          runEpoch: r?.runEpoch ?? null,
          processedAt: r?.processedAt ?? null,
          pdfUsed: r?.pdfContentUsed ?? null,
          ...(includeConfidence && { confidence: r?.confidence ?? null, modelConfidence: r?.modelConfidence ?? null }),
          ...(includeReasoning && { reasoning: r?.reasoning ?? null }),
          ...(includeCitations && { citations: r?.citations ?? [] }),
        };
      }),
    })),
  };
}

type ExportRecord = ReturnType<typeof exportRecord>;
type Cell = string | number;
const yesNoUnknown = (value: boolean | null | undefined) => value == null ? "Unknown" : value ? "Yes" : "No";

/** Arrays use JSON so commas, semicolons and Unicode survive a round trip. */
export function formatAnswerForCSV(answer: string | number | boolean | string[] | null | undefined, type: string): string {
  return String(formatAnswerForExcel(answer, type));
}

export function formatAnswerForExcel(answer: string | number | boolean | string[] | null | undefined, type: string): Cell {
  if (answer == null) return "";
  if (Array.isArray(answer)) return JSON.stringify(answer);
  if (type === "boolean" && typeof answer === "boolean") return answer ? "Yes" : "No";
  if (type === "number" && typeof answer === "number" && Number.isFinite(answer)) return answer;
  return String(answer);
}

function wideTable(data: ExportRecord, options: ExportOptions, citationMode: "json" | "count" = "json") {
  const { includeMetadata = true, includeConfidence = true, includeReasoning = true, includeCitations = true } = options;
  const headers = ["Paper ID", "OpenAlex ID", "Paper Title", "DOI", "Year", "Job ID", "Run Epoch", "PDF Enabled", "Job Name", "Job Status", "Source Type", "Selected Model ID", "Selected Effort", "Selected Decision Model ID", "Export Version", "Exported At"];
  if (includeMetadata) headers.push("Authors", "Authors (unparsed)", "Abstract", "Open Access", "PDF Used", "Venue", "Citation Count", "Work Type", "Access Status", "Open Access URL", "PDF URL");
  for (const q of data.questions) {
    const label = "[" + q.key + "] " + q.question;
    headers.push(label, label + " (Type)", label + " (Status)", label + " (Evidence status)", label + " (Source)", label + " (Model)", label + " (Provider)", label + " (Run epoch)", label + " (Processed at)", label + " (PDF used)");
    if (includeConfidence) headers.push(label + " (Confidence)", label + " (Model confidence)");
    if (includeReasoning) headers.push(label + " (Reasoning)");
    if (includeCitations) headers.push(label + (citationMode === "count" ? " (Citation count)" : " (Citations)"));
  }
  const rows: Cell[][] = data.papers.map(paper => {
    const row: Cell[] = [paper.id, paper.openalexId, paper.title, paper.doi ?? "", paper.year ?? "", data.job.id ?? "", data.job.runEpoch ?? "", yesNoUnknown(data.job.pdfEnabled), data.job.name ?? "", data.job.status ?? "", data.job.sourceType ?? "", data.job.selectedModelId ?? "", data.job.selectedEffort ?? "", data.job.selectedDecisionModelId ?? "", data.version, data.exportedAt];
    if (includeMetadata) row.push(paper.authors == null ? "" : JSON.stringify(paper.authors), paper.authorsUnparsed ?? "", paper.abstract ?? "", yesNoUnknown(paper.openAccess), yesNoUnknown(paper.pdfUsed), paper.venue ?? "", paper.citedByCount ?? "", paper.workType ?? "", paper.oaStatus ?? "", paper.oaUrl ?? "", paper.pdfUrl ?? "");
    for (const r of paper.results) {
      row.push(formatAnswerForExcel(r.answer, r.questionType), r.questionType, r.status, r.citationStatus ?? "", r.source ?? "", r.model ?? "", r.provider ?? "", r.runEpoch ?? "", r.processedAt == null ? "" : new Date(r.processedAt).toISOString(), yesNoUnknown(r.pdfUsed));
      if (includeConfidence) row.push(r.confidence ?? "", r.modelConfidence ?? "");
      if (includeReasoning) row.push(r.reasoning ?? "");
      if (includeCitations) row.push(citationMode === "count" ? r.citations?.length ?? 0 : JSON.stringify(r.citations ?? []));
    }
    return row;
  });
  return { headers, rows };
}

function downloadFile(content: string | Blob, extension: string, mimeType: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "extraction-results-" + Date.now() + "." + extension;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCSV(papers: PaperWithResults[], questions: Question[], options: ExportOptions = {}): void {
  const { headers, rows } = wideTable(exportRecord(papers, questions, options), options);
  const csv = [headers, ...rows].map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  downloadFile("\uFEFF" + csv, "csv", "text/csv;charset=utf-8", options.signal);
}

export function exportToJSON(papers: PaperWithResults[], questions: Question[], options: ExportOptions = {}): void {
  downloadFile(JSON.stringify(exportRecord(papers, questions, options), null, 2), "json", "application/json", options.signal);
}

export async function exportToExcel(papers: PaperWithResults[], questions: Question[], options: ExportOptions = {}): Promise<void> {
  options.signal?.throwIfAborted();
  if (options.includeCitations !== false) {
    const keys = new Set(questions.map(q => q.key));
    const evidenceRows = papers.reduce((total, paper) => total + paper.results.reduce((count, result) => count + (keys.has(result.questionKey) ? result.citations?.length ?? 0 : 0), 0), 0);
    if (evidenceRows > 1_048_575) throw new ExtractionExportError("excelRowLimit");
  }
  const data = exportRecord(papers, questions, options);
  const { headers, rows } = wideTable(data, options, "count");
  const mod = await import("exceljs");
  const ExcelJS = "default" in mod ? mod.default : mod;
  const workbook = new ExcelJS.Workbook();
  const addSheet = (name: string, values: Cell[][]) => {
    const sheet = workbook.addWorksheet(name);
    for (const row of values) {
      if (row.some(cell => typeof cell === "string" && cell.length > 32767)) throw new ExtractionExportError("excelCellLimit");
      sheet.addRow(row);
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    return sheet;
  };
  addSheet("Results", [headers, ...rows]);
  addSheet("Questions", [["Key", "Question", "Type", "Description"], ...data.questions.map(q => [q.key, q.question, q.type, q.description ?? ""])]);
  addSheet("Job", [["Field", "Value"], ...Object.entries(data.job).map(([key, value]): Cell[] => [key, value == null ? "" : typeof value === "boolean" ? yesNoUnknown(value) : value]), ["Exported at", data.exportedAt], ["Exported papers", data.totalPapers]]);
  if (options.includeCitations !== false) {
    addSheet("Evidence", [
      ["Paper ID", "Question Key", "Source", "Evidence ID", "Source Hash", "Page", "Start", "End", "Quote"],
      ...data.papers.flatMap(p => p.results.flatMap(r => (r.citations ?? []).map(c => [p.id, r.questionKey, c.source ?? "pdf", c.evidenceId, c.sourceHash ?? "", c.source === "abstract" ? "" : c.page, c.charRange[0], c.charRange[1], c.quote]))),
    ]);
  }
  const summaryHeaders = ["Question Key", "Question", "Completed", "Answered", "Failed", "Missing", "Total Papers", "Completion Rate"];
  if (options.includeConfidence !== false) summaryHeaders.push("Average Confidence");
  addSheet("Summary", [summaryHeaders, ...data.questions.map(q => {
    const results = data.papers.map(p => p.results.find(r => r.questionKey === q.key)!);
    const completed = results.filter(r => r.status === "completed").length;
    const row: Cell[] = [q.key, q.question, completed, results.filter(r => r.answer !== null).length, results.filter(r => r.status === "failed").length, results.filter(r => r.status === "missing").length, data.totalPapers, data.totalPapers ? completed / data.totalPapers : 0];
    if (options.includeConfidence !== false) {
      const known = results.flatMap(r => r.status === "completed" && r.confidence != null ? [r.confidence] : []);
      row.push(known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : "");
    }
    return row;
  })]);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadFile(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", options.signal);
}
