import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { CorpusSource } from "../../lib/chat/render-corpus";
import { PAPER_LIMIT_MAX } from "../extraction/bucket/limits";
import {
  classifySourceType,
  type ChatSourceType,
} from "../../lib/chat/source-type";

export type ChatSourceRow = {
  chatPaperId: Id<"chatPapers">;
  sourceId: Id<"extractionJobSources">;
  jobId: Id<"extractionJobs">;
  position: number;
  included: boolean;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  doi: string | null;
  pdfUrl: string | null;
  openalexId: string | null;
  bucketKey: string;
  sourceType: ChatSourceType;
};

const sourceTypeValidator = v.union(
  v.literal("openalex"),
  v.literal("zotero"),
  v.literal("unknown"),
);

export const chatSourceRowValidator = v.object({
  chatPaperId: v.id("chatPapers"),
  sourceId: v.id("extractionJobSources"),
  jobId: v.id("extractionJobs"),
  position: v.number(),
  included: v.boolean(),
  title: v.string(),
  authors: v.array(v.string()),
  year: v.union(v.number(), v.null()),
  abstract: v.union(v.string(), v.null()),
  doi: v.union(v.string(), v.null()),
  pdfUrl: v.union(v.string(), v.null()),
  openalexId: v.union(v.string(), v.null()),
  bucketKey: v.string(),
  sourceType: sourceTypeValidator,
});

function toChatSourceRow(
  source: Doc<"extractionJobSources">,
  chatPaper: Doc<"chatPapers">,
): ChatSourceRow {
  return {
    chatPaperId: chatPaper._id,
    sourceId: source._id,
    jobId: source.jobId,
    position: source.position,
    included: chatPaper.included,
    title: source.title,
    authors: source.authors,
    year: source.year ?? null,
    abstract: source.abstract ?? null,
    doi: source.doi ?? null,
    pdfUrl: source.pdfUrl ?? null,
    openalexId: source.openalexId ?? null,
    bucketKey: source.bucketKey,
    sourceType: classifySourceType(source),
  };
}

export function toCorpusSource(row: ChatSourceRow): CorpusSource {
  return {
    sourceId: String(row.sourceId),
    position: row.position,
    openalexId: row.openalexId ?? undefined,
    title: row.title,
    authors: row.authors,
    year: row.year ?? undefined,
    abstract: row.abstract ?? undefined,
    doi: row.doi ?? undefined,
    pdfUrl: row.pdfUrl ?? undefined,
  };
}

export function joinChatSourceRows(
  sources: ReadonlyArray<Doc<"extractionJobSources">>,
  chatPapers: ReadonlyArray<Doc<"chatPapers">>,
): ChatSourceRow[] {
  const chatPaperBySourceId = new Map(
    chatPapers.map((chatPaper) => [chatPaper.sourceId, chatPaper] as const),
  );

  const rows: ChatSourceRow[] = [];
  for (const source of sources) {
    const chatPaper = chatPaperBySourceId.get(source._id);
    // A source row can land before its mirrored chatPapers row during
    // thread bootstrap. Skip defensively so the next reactive tick
    // fills the gap without crashing the mounted chat shell.
    if (!chatPaper) continue;
    rows.push(toChatSourceRow(source, chatPaper));
  }
  rows.sort((a, b) => a.position - b.position);
  return rows;
}

export async function readChatSourceRows(
  ctx: QueryCtx,
  jobId: Id<"extractionJobs">,
): Promise<ChatSourceRow[]> {
  const [sources, chatPapers] = await Promise.all([
    ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
      .take(PAPER_LIMIT_MAX),
    ctx.db
      .query("chatPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(PAPER_LIMIT_MAX),
  ]);

  return joinChatSourceRows(sources, chatPapers);
}
