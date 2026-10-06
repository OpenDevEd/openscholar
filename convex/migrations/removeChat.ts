import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Takes the paper chat out of the data (#325). The chat jobs go with what points at them:
 * their sources, `chatPapers` and `chatSourceEvents` (the job delete cascade), and the agent
 * threads their `chatThreadId` names. Credit transactions keep their job ID, as they do when
 * any job is deleted. Extraction jobs lose `mode` and the chat's fields, and saved searches
 * and their revisions the chats started from them, and the chat's switch its row. Every other
 * record stays.
 *
 *   npx convex run migrations/removeChat:dryRun                      what goes, and every extraction job's ID
 *   npx convex run migrations/removeChat:deleteChats '{"count": N}'  the N chat jobs the dry run listed
 *   npx convex run migrations/removeChat:run                         the fields, once the chats are gone
 *   npx convex run migrations/removeChat:verify '{"jobIds": [...], "threadIds": [...]}'
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** Shared dev had 9 on 2026-10-04, and nothing can make more. */
const CHATS_MAX = 100;
const ROWS_COUNTED = 2000;
/** A reply's lock older than this belongs to one that died (the chat's old STALE_LOCK_MS). */
const LIVE_REPLY_MS = 5 * 60 * 1000;

const hasChatFields = (job: Doc<"extractionJobs">) =>
  job.mode !== undefined || job.chatThreadId !== undefined || job.chatModelId !== undefined || job.chatEffort !== undefined ||
  job.messageCount !== undefined || job.isGenerating !== undefined || job.generatingStartedAt !== undefined ||
  job.chatGenerationAttemptId !== undefined || job.webSearchEnabled !== undefined;

const chatValidator = v.object({
  jobId: v.id("extractionJobs"), userId: v.id("users"), name: v.string(), threadId: v.optional(v.string()),
  replyingSince: v.optional(v.number()), chatPapers: v.number(), sourceEvents: v.number(), sources: v.number(),
});

/** The chat jobs, with how many rows point at each. */
export const chatJobs = internalQuery({
  args: {},
  returns: v.array(chatValidator),
  handler: async (ctx) => {
    const jobs = await ctx.db.query("extractionJobs").withIndex("by_mode", (q) => q.eq("mode", "chat")).take(CHATS_MAX);
    return await Promise.all(jobs.map(async (job) => ({
      jobId: job._id, userId: job.userId, name: job.name, threadId: job.chatThreadId,
      replyingSince: job.isGenerating ? job.generatingStartedAt : undefined,
      chatPapers: (await ctx.db.query("chatPapers").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(ROWS_COUNTED)).length,
      sourceEvents: (await ctx.db.query("chatSourceEvents").withIndex("by_job_createdAt", (q) => q.eq("jobId", job._id)).take(ROWS_COUNTED)).length,
      sources: (await ctx.db.query("extractionJobSources").withIndex("by_job_and_position", (q) => q.eq("jobId", job._id)).take(ROWS_COUNTED)).length,
    })));
  },
});

/** One page of jobs: the extraction jobs' IDs, the chats among them, and the extraction jobs still carrying a chat field. */
export const jobPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ ids: v.array(v.id("extractionJobs")), chats: v.number(), withFields: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("extractionJobs").paginate({ cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 });
    const extraction = page.page.filter((job) => job.mode !== "chat");
    return { ids: extraction.map((job) => job._id), chats: page.page.length - extraction.length, withFields: extraction.filter(hasChatFields).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** One page of saved searches or their revisions, and how many still name a chat. */
export const searchPage = internalQuery({
  args: { table: v.union(v.literal("searches"), v.literal("searchRevisions")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ linked: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 });
    return { linked: page.page.filter((row) => row.data.chatJobIdsByAccountId !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

const tallyValidator = v.object({
  extractionJobIds: v.array(v.id("extractionJobs")), chatJobs: v.number(), jobsWithChatFields: v.number(), searchesLinked: v.number(), revisionsLinked: v.number(),
});
type Tally = typeof tallyValidator.type;

async function tally(ctx: ActionCtx): Promise<Tally> {
  const result: Tally = { extractionJobIds: [], chatJobs: 0, jobsWithChatFields: 0, searchesLinked: 0, revisionsLinked: 0 };
  for (let cursor: string | null = null; ;) {
    const page: { ids: Array<Id<"extractionJobs">>; chats: number; withFields: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.removeChat.jobPage, { cursor });
    result.extractionJobIds.push(...page.ids);
    result.chatJobs += page.chats;
    result.jobsWithChatFields += page.withFields;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  for (const table of ["searches", "searchRevisions"] as const) {
    for (let cursor: string | null = null; ;) {
      const page: { linked: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.removeChat.searchPage, { table, cursor });
      result[table === "searches" ? "searchesLinked" : "revisionsLinked"] += page.linked;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  }
  return result;
}

/** Changes nothing: lists the chat jobs and what points at them, and counts the rest. */
export const dryRun = internalAction({
  args: {},
  returns: v.object({ chats: v.array(chatValidator), tally: tallyValidator }),
  handler: async (ctx): Promise<{ chats: Array<typeof chatValidator.type>; tally: Tally }> => ({
    chats: await ctx.runQuery(internal.migrations.removeChat.chatJobs, {}),
    tally: await tally(ctx),
  }),
});

/** Deletes one chat job, its agent thread, and (scheduled, a batch at a time) the rows that point at it. */
export const deleteChat = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("extractionJobs", jobId);
    if (!job) return null;
    if (job.mode !== "chat") throw new Error(`${jobId} is not a chat job`);
    if (job.chatThreadId) await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: job.chatThreadId });
    await ctx.db.delete("extractionJobs", jobId);
    await ctx.scheduler.runAfter(0, internal.extraction.mutations.internal.admin.deleteExtractionInternal, { jobId });
    return null;
  },
});

/** Deletes the chat's switch, which nothing reads now. */
export const deleteChatFlag = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const flag = await ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "extraction.chat")).unique();
    if (flag) await ctx.db.delete("featureFlags", flag._id);
    return null;
  },
});

/** Deletes the chat jobs, only when there are `count` of them, as the dry run said, and none is writing a reply. */
export const deleteChats = internalAction({
  args: { count: v.number() },
  returns: v.array(v.id("extractionJobs")),
  handler: async (ctx, { count }): Promise<Array<Id<"extractionJobs">>> => {
    const chats: Array<typeof chatValidator.type> = await ctx.runQuery(internal.migrations.removeChat.chatJobs, {});
    if (chats.length !== count) throw new Error(`${chats.length} chat jobs, not the ${count} expected: run the dry run again`);
    const replying = chats.filter((chat) => chat.replyingSince !== undefined && Date.now() - chat.replyingSince < LIVE_REPLY_MS);
    if (replying.length) throw new Error(`Still replying: ${replying.map((chat) => chat.jobId).join(", ")}`);
    for (const chat of chats) await ctx.runMutation(internal.migrations.removeChat.deleteChat, { jobId: chat.jobId });
    await ctx.runMutation(internal.migrations.removeChat.deleteChatFlag, {});
    return chats.map((chat) => chat.jobId);
  },
});

// A small batch: a job holds its sources' summary, with no byte limit of its own.
export const jobs = migrations.define({
  table: "extractionJobs",
  batchSize: 20,
  migrateOne: (_ctx, job) => {
    if (job.mode === "chat" || !hasChatFields(job)) return;
    return {
      mode: undefined, chatThreadId: undefined, chatModelId: undefined, chatEffort: undefined, messageCount: undefined,
      isGenerating: undefined, generatingStartedAt: undefined, chatGenerationAttemptId: undefined, webSearchEnabled: undefined,
    };
  },
});

const withoutChats = <T extends { chatJobIdsByAccountId?: unknown }>({ chatJobIdsByAccountId: _chats, ...data }: T) => data;

export const searches = migrations.define({
  table: "searches",
  batchSize: 20,
  migrateOne: (_ctx, search) => (search.data.chatJobIdsByAccountId === undefined ? undefined : { data: withoutChats(search.data) }),
});

export const revisions = migrations.define({
  table: "searchRevisions",
  batchSize: 20,
  migrateOne: (_ctx, revision) => (revision.data.chatJobIdsByAccountId === undefined ? undefined : { data: withoutChats(revision.data) }),
});

export const run = migrations.runner([internal.migrations.removeChat.jobs, internal.migrations.removeChat.searches, internal.migrations.removeChat.revisions]);

/** What is left: 0 of everything when done, `jobIds` (the dry run's) all still there, and none of `threadIds`. */
export const verify = internalAction({
  args: { jobIds: v.array(v.id("extractionJobs")), threadIds: v.array(v.string()) },
  returns: v.object({ chatJobs: v.number(), jobsWithChatFields: v.number(), searchesLinked: v.number(), revisionsLinked: v.number(), missingJobs: v.array(v.id("extractionJobs")), threadsLeft: v.array(v.string()) }),
  handler: async (ctx, { jobIds, threadIds }) => {
    const now = await tally(ctx);
    const kept = new Set(now.extractionJobIds);
    const threadsLeft: string[] = [];
    for (const threadId of threadIds) {
      if (await ctx.runQuery(components.agent.threads.getThread, { threadId })) threadsLeft.push(threadId);
    }
    const { extractionJobIds: _ids, ...counts } = now;
    return { ...counts, missingJobs: jobIds.filter((id) => !kept.has(id)), threadsLeft };
  },
});
