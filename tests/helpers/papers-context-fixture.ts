import type { Id } from "@/convex/_generated/dataModel";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { PapersContextValue } from "@/components/extraction/chat/papers-context";
import {
  resolvePaperFromRow,
  type ResolvablePaper,
} from "@/lib/chat/resolve-paper";

const DEFAULT_JOB_ID = "job_test" as Id<"extractionJobs">;

/**
 * Shared builder for mock `ChatSourceRow` fixtures. Consolidates the
 * duplicated `row()` helpers that used to live inline in every
 * sources-panel test file.
 */
export function mkChatSourceRow(
  overrides: Partial<ChatSourceRow> = {},
): ChatSourceRow {
  return {
    chatPaperId: "cp_1" as Id<"chatPapers">,
    sourceId: "src_1" as Id<"extractionJobSources">,
    jobId: DEFAULT_JOB_ID,
    position: 1,
    included: true,
    title: "A study of citation behavior",
    authors: ["Doe, J.", "Smith, A."],
    year: 2024,
    abstract: null,
    doi: null,
    pdfUrl: null,
    openalexId: "W1234567890",
    bucketKey: "openalex:W1234567890",
    sourceType: "openalex",
    ...overrides,
  };
}

/**
 * Shared builder for mock `ResolvablePaper` fixtures.
 */
export function mkResolvablePaper(
  overrides: Partial<ResolvablePaper> = {},
): ResolvablePaper {
  return {
    sourceId: "src_1" as Id<"extractionJobSources">,
    chatPaperId: "cp_1" as Id<"chatPapers">,
    position: 1,
    title: "A study of citation behavior",
    authors: ["Doe, J.", "Smith, A."],
    year: 2024,
    abstract: null,
    openalexId: "W1234567890",
    doi: null,
    pdfUrl: null,
    included: true,
    ...overrides,
  };
}

/**
 * Build a fake `PapersContextValue` for tests that mount the chat tree
 * without spinning up the real `ChatPapersProvider`.
 *
 * If `rows` is supplied in the overrides, `rowsById` / `papersByPosition`
 * / `totalCount` / `includedCount` are derived automatically (unless they
 * are also explicitly overridden).
 */
export function fakePapersContext(
  overrides: Partial<PapersContextValue> = {},
): PapersContextValue {
  const jobId = overrides.jobId ?? DEFAULT_JOB_ID;
  const rows = overrides.rows ?? [];

  const rowsById =
    overrides.rowsById ??
    new Map<Id<"chatPapers">, ChatSourceRow>(
      rows.map((r) => [r.chatPaperId, r]),
    );

  const papersByPosition =
    overrides.papersByPosition ??
    new Map<number, ResolvablePaper>(
      rows.map((r) => [r.position, resolvePaperFromRow(r)]),
    );

  const totalCount = overrides.totalCount ?? rows.length;
  const includedCount =
    overrides.includedCount ??
    rows.reduce((n, r) => n + (r.included ? 1 : 0), 0);
  const isLoading = overrides.isLoading ?? false;

  return {
    jobId,
    rows,
    rowsById,
    papersByPosition,
    totalCount,
    includedCount,
    isLoading,
  };
}
