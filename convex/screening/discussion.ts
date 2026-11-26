/**
 * What a screening's reviewers say to each other about a paper (plans/screening-reviewers). A line can be put to one
 * person, and then waits with them until they write on the paper. What is written about a paper is kept from a
 * reviewer while the paper still waits for their own vote, as the other votes are.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { assistantQuery, defineUserQuery, userQuery, workspaceMutation } from "../lib/userActions";
import type { InWorkspace } from "../workspaces/actor";
import { seesVotes } from "../../lib/screening/rules";
import { standingOn } from "./access";
import { votesOf } from "./dealing";
import { logChange } from "./log";
import { SCREENING_TEXT } from "./validators";

/** Lines one page of a paper's discussion holds at most, and questions answered by one line. */
const LINES = 100;
const ANSWERED = 200;

/** The paper and what the person is to its screening, where they may read what was written about it. */
async function readable(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, jobId: Id<"screeningJobs">, paperId: Id<"screeningResults">) {
  const standing = await standingOn(ctx, actor, jobId);
  const paper = standing?.job.shape === 2 ? await ctx.db.get("screeningResults", paperId) : null;
  if (!standing || paper?.jobId !== jobId) return null;
  const mine = standing.reviewer ? (await votesOf(ctx, paperId)).find((vote) => vote.reviewerId === standing.reviewer!._id) : undefined;
  return seesVotes(standing.job.rule?.blind ?? "after", paper.result, mine?.status === "waiting" ? "waiting" : undefined) ? { ...standing, paper } : null;
}

const person = v.object({ id: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()) });

export const threadAction = defineUserQuery({
  path: "screening/discussion:thread",
  description: "Reads what a screening's reviewers wrote to each other about one paper, a page at a time, the latest first, each line with who wrote it, when, and who it asks where it is a question that still waits. Empty for a reviewer while the paper waits for their own vote.",
  args: { jobId: v.id("screeningJobs"), paperId: v.id("screeningResults"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("screeningMessages"), by: person, at: v.number(), text: v.string(), to: v.optional(person), open: v.optional(v.boolean()) })),
  run: async (ctx, actor, { jobId, paperId, paginationOpts }) => {
    if (!(await readable(ctx, actor, jobId, paperId))) return { page: [], isDone: true, continueCursor: "" };
    const read = await ctx.db.query("screeningMessages").withIndex("by_result", (q) => q.eq("resultId", paperId)).order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LINES) });
    const lines = read.page;
    const people = new Map<Id<"users">, { id: Id<"users">; name: string; imageUrl?: string }>();
    for (const id of new Set(lines.flatMap((line) => [line.by, ...(line.to ? [line.to] : [])]))) {
      const user = await ctx.db.get("users", id);
      people.set(id, user ? { id, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}) } : { id, name: "Someone who left" });
    }
    return { ...read, page: lines.map((line) => ({ id: line._id, by: people.get(line.by)!, at: line._creationTime, text: line.text, ...(line.to ? { to: people.get(line.to)! } : {}), ...(line.open ? { open: true } : {}) })) };
  },
});
export const thread = userQuery(threadAction);
export const threadForAssistant = assistantQuery(threadAction);

export const allAction = defineUserQuery({
  path: "screening/discussion:all",
  description: "Lists everything a screening's reviewers wrote to each other about its papers, a page at a time, each line with the paper it is about, who wrote it, when, and who it asks where it is a question. What was written about a paper is left out for a reviewer while that paper waits for their own vote.",
  args: { jobId: v.id("screeningJobs"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("screeningMessages"), paperId: v.id("screeningResults"), by: person, at: v.number(), text: v.string(), to: v.optional(person) })),
  run: async (ctx, actor, { jobId, paginationOpts }) => {
    const standing = await standingOn(ctx, actor, jobId);
    if (!standing || standing.job.shape !== 2) return { page: [], isDone: true, continueCursor: "" };
    const read = await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LINES) });
    // Each paper the page speaks of is looked at once: whether the person may read what was written about it.
    const seen = new Map<Id<"screeningResults">, boolean>();
    for (const paperId of new Set(read.page.map((line) => line.resultId))) seen.set(paperId, (await readable(ctx, actor, jobId, paperId)) !== null);
    const lines = read.page.filter((line) => seen.get(line.resultId));
    const people = new Map<Id<"users">, { id: Id<"users">; name: string; imageUrl?: string }>();
    for (const id of new Set(lines.flatMap((line) => [line.by, ...(line.to ? [line.to] : [])]))) {
      const user = await ctx.db.get("users", id);
      people.set(id, user ? { id, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}) } : { id, name: "Someone who left" });
    }
    return { ...read, page: lines.map((line) => ({ id: line._id, paperId: line.resultId, by: people.get(line.by)!, at: line._creationTime, text: line.text, ...(line.to ? { to: people.get(line.to)! } : {}) })) };
  },
});
export const all = userQuery(allAction);
export const allForAssistant = assistantQuery(allAction);

/**
 * Writes a line in the discussion of one paper of a screening, for one of its reviewers or whoever settles its
 * conflicts. With `to`, it is a question put to that person, who is on the screening: it waits on their list until
 * they write on the paper.
 */
export const say = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), paperId: v.id("screeningResults"), text: v.string(), to: v.optional(v.id("users")) },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, paperId, text, to }) => {
    const place = await readable(ctx, actor, jobId, paperId);
    if (!place) throw createError("NOT_FOUND", "Paper not found");
    const { job, reviewer, paper } = place;
    if (!reviewer && job.rule?.resolver !== actor.userId) throw createError("FORBIDDEN", "Only this screening's reviewers, and whoever settles its conflicts, write here.");
    const words = text.trim();
    if (!words || words.length > SCREENING_TEXT.message) throw createError("VALIDATION_ERROR", "Write up to 4,000 characters.");
    if (to) {
      if (to === actor.userId) throw createError("VALIDATION_ERROR", "Ask someone else.");
      const asked = await ctx.db.query("screeningReviewers").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId).eq("userId", to)).first();
      if (job.rule?.resolver !== to && (!asked || asked.left !== undefined)) throw createError("VALIDATION_ERROR", "Only someone on this screening can be asked.");
    }
    // Writing on the paper answers every question that waited there for the writer.
    const waiting = await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId).eq("to", actor.userId).eq("open", true)).take(ANSWERED);
    for (const line of waiting) if (line.resultId === paperId) await ctx.db.patch("screeningMessages", line._id, { open: undefined });
    await ctx.db.insert("screeningMessages", { jobId, resultId: paperId, by: actor.userId, text: words, ...(to ? { to, open: true as const } : {}) });
    await ctx.db.patch("screeningResults", paperId, { messages: (paper.messages ?? 0) + 1 });
    if (to) {
      // A question put to one reviewer is written into the screening's activity too, where someone looks for what was asked lately.
      const asked = await ctx.db.get("users", to);
      await logChange(ctx, actor, job, "asked", { detail: asked ? personName(asked) || asked.email : "", more: [{ code: "paper", detail: paper.title }] });
    }
    return null;
  },
});
