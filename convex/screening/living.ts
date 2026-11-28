/**
 * Looking in a screening's sources again (plans/screening-reviewers): by hand, and for a living screening on its
 * schedule. A check reads each source that gains papers again from its start, and only the papers the screening
 * doesn't have join it, at the end of the round (./gathering.ts). A file or a pasted list holds what it held.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { internalMutation, internalQuery } from "../lib/functions";
import { workspaceMutation } from "../lib/userActions";
import { requireMember } from "./access";
import { placeGuests, readAgain, reviewersOf, sourcesOf, touched } from "./dealing";
import { readOn, startCheck } from "./gathering";
import { firstCheck } from "./dealing";
import { logChange } from "./log";
import { EVERY_MS } from "./screenings";

/** The kinds of source that gain papers over time. */
const GROWS = new Set(["search", "collection", "saved", "screening", "evidenceLibrary", "zotero"]);
export const grows = (source: Doc<"screeningSources">) => source.removedAt === undefined && GROWS.has(source.set.kind);

/** Starts a check of a screening's growing sources, unless one is under way or it has none. Says whether it did. */
export async function check(ctx: MutationCtx, job: Doc<"screeningJobs">, by: Id<"users"> | undefined) {
  if (await ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", job._id).eq("state", "running")).first()) return false;
  const sources = (await sourcesOf(ctx, job._id)).filter(grows);
  if (!sources.length) return false;
  // Read again from its start, as it stands now: what it had merged and left out is counted again as it is read.
  for (const source of sources) await ctx.db.patch("screeningSources", source._id, readAgain(source));
  await startCheck(ctx, job, by, true);
  return true;
}

/**
 * Looks in a screening's sources again now for papers they gained since it last looked: a search, a collection, the
 * library, another screening's included papers, a community or a Zotero library. The new ones join the screening and
 * go to its reviewers. A finished screening that gains papers is open again.
 */
export const checkNow = workspaceMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.reading) throw createError("CONFLICT", "The papers are still arriving from the sources.");
    await check(ctx, job, actor.userId);
    return null;
  },
});

/**
 * Reads a source that couldn't be read on from where it stopped. In a look under way it is read in its turn; otherwise
 * the first look goes on, or a new look starts, so what it brings counts where the screening's other papers do.
 */
/** A source set to be read again is read: by the look under way, in its turn, or by the look the screening started with while that still runs, or by a check of its own. A finished screening reopens by its own check (`checked`). */
async function readInTurn(ctx: MutationCtx, job: Doc<"screeningJobs">, by: Id<"users">) {
  if (await ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", job._id).eq("state", "running")).first()) return;
  const [first, last] = await Promise.all([firstCheck(ctx, job._id), ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", job._id)).order("desc").first()]);
  if (last && last._id === first?._id && job.finishedAt === undefined) await readOn(ctx, job, by);
  else await startCheck(ctx, job, by);
}

export const readSourceAgain = workspaceMutation({
  args: { sourceId: v.id("screeningSources") },
  returns: v.null(),
  handler: async (ctx, actor, { sourceId }) => {
    const source = await ctx.db.get("screeningSources", sourceId);
    if (!source || source.removedAt !== undefined) throw createError("NOT_FOUND", "This source isn't in the screening any more.");
    const job = await requireMember(ctx, actor, source.jobId);
    if (source.state !== "failed") return null;
    // One that failed before its reading began begins again; one that failed part way goes on from its place. A community's records are listed again first: the list a look keeps is dropped when it ends.
    const begun = source.set.kind !== "evidenceLibrary" && (source.snapshot || source.total !== undefined || source.read);
    await ctx.db.patch("screeningSources", sourceId, { state: begun ? "reading" : "waiting", failure: undefined });
    await readInTurn(ctx, job, actor.userId);
    return null;
  },
});

/** The list of DOIs a source reads, for whoever corrects one of them (./held.ts `correctDoi`). */
export const doisOf = internalQuery({
  args: { sourceId: v.id("screeningSources"), userId: v.id("users"), workspaceId: v.id("workspaces") },
  returns: v.id("_storage"),
  handler: async (ctx, { sourceId, ...actor }) => {
    const source = await ctx.db.get("screeningSources", sourceId);
    if (!source || source.removedAt !== undefined || source.set.kind !== "dois") throw createError("NOT_FOUND", "This list of DOIs isn't in the screening any more.");
    await requireMember(ctx, actor, source.jobId);
    return source.set.file;
  },
});

/**
 * A list of DOIs kept anew with a DOI corrected, or as it was to try again: the source reads it from its start, so a
 * DOI found this time joins the screening, and the list it read before goes.
 */
export const swapDois = internalMutation({
  args: { sourceId: v.id("screeningSources"), was: v.id("_storage"), file: v.id("_storage"), from: v.optional(v.string()), to: v.optional(v.string()), userId: v.id("users"), workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { sourceId, was, file, from, to, ...actor }) => {
    const source = await ctx.db.get("screeningSources", sourceId);
    if (!source || source.removedAt !== undefined || source.set.kind !== "dois") throw createError("NOT_FOUND", "This list of DOIs isn't in the screening any more.");
    const job = await requireMember(ctx, actor, source.jobId);
    // Another correction was saved since this one read the list: this one would undo it, so it asks to be made again.
    if (source.set.file !== was) throw createError("CONFLICT", "This list was just corrected. Correct the DOI again.");
    // ponytail: the list it read before stays in storage. A copy of the screening may read the same file; delete it once nothing names it if storage ever matters.
    // A list named by its first DOI is named by that DOI corrected.
    await ctx.db.patch("screeningSources", sourceId, { set: { kind: "dois", file }, ...(from && to && source.name.includes(from) ? { name: source.name.replace(from, to) } : {}), ...readAgain(source) });
    await readInTurn(ctx, job, actor.userId);
    return null;
  },
});

/** Screenings one run of the schedule starts a check for. */
const DUE = 25;

/** The living screenings whose next check is due: each is checked, and its next check set. Run every hour (../crons.ts). */
export const due = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const jobs = await ctx.db.query("screeningJobs").withIndex("by_living_next", (q) => q.gt("living.next", 0).lte("living.next", now)).take(DUE);
    for (const job of jobs) {
      if (!job.living) continue;
      await ctx.db.patch("screeningJobs", job._id, { living: { ...job.living, next: now + EVERY_MS[job.living.every] } });
      if (job.finishedAt === undefined && !job.reading) await check(ctx, job, undefined);
    }
    // More than one run's worth were due: the rest follow at once.
    if (jobs.length === DUE) await ctx.scheduler.runAfter(0, internal.screening.living.due, {});
    return null;
  },
});

/** What a check that has ended leaves behind: its note in the screening's activity, an email to the people the new papers went to, and a finished screening open again. */
export async function checked(ctx: MutationCtx, job: Doc<"screeningJobs">, check: Doc<"screeningChecks">) {
  // The look it started with says nothing: it is the screening starting. A later look from no papers (one that started empty) is a check like any other, and reopens it.
  if ((await firstCheck(ctx, job._id))?._id === check._id) return;
  const now = Date.now();
  // Only a check asked for once it was finished reopens it: one already under way when it was marked finished doesn't undo that.
  if (check.added && job.finishedAt !== undefined && check.at >= job.finishedAt) {
    await ctx.db.patch("screeningJobs", job._id, { finishedAt: undefined, status: "processing", completedAt: undefined, ...touched(now) });
    await placeGuests(ctx, job._id);
    await ctx.scheduler.runAfter(0, internal.screening.readings.release, { jobId: job._id, cursor: null });
  }
  await logChange(ctx, { userId: check.by ?? job.createdBy }, job, check.by ? "checked" : "scheduledCheck", { count: check.found, more: [...(check.found - check.added - (check.left ?? 0) > 0 ? [{ code: "known", count: check.found - check.added - (check.left ?? 0) }] : []), ...(check.left ? [{ code: "leftOut", count: check.left }] : []), ...(check.unread?.length ? [{ code: "unread", count: check.unread.length }] : []), ...(check.added ? [{ code: "joined", count: check.added }] : []), ...(check.added && job.finishedAt !== undefined ? [{ code: "reopened" }] : [])] });
  if (!check.added) return;
  for (const reviewer of await reviewersOf(ctx, job._id)) {
    if (reviewer.kind === "person" && reviewer.userId && reviewer.left === undefined) await ctx.scheduler.runAfter(0, internal.screening.noticeMail.send, { jobId: job._id, userId: reviewer.userId, about: "papers" });
  }
}
