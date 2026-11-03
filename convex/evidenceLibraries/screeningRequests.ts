/**
 * An owner's request to grade a screening source's records (new-el `POST .../screening/grade`). A new subject reaches
 * the library only when the owner activates the settings, so the request waits here until the library's status report
 * names that subject, then goes to the library as the owner who made it.
 */
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { internalMutation, internalQuery } from "../lib/functions";
import { MAX_LIBRARY_SOURCES } from "../lib/listCaps";
import type { SourceStatus } from "./sourceStatusValidators";

// A send that never came back is tried again on a later report.
const SEND_STALE_MS = 2 * 60_000;
// The library says it isn't ready while it starts with new settings: asked again this often, for this long. A report
// naming the subject sends it too, so this only covers a library whose reports stopped changing.
const NOT_READY_RETRY_MS = 60_000;
const NOT_READY_GIVE_UP_MS = 60 * 60_000;

/** The source's waiting request, if any: one per source, a new one replacing it. */
export async function readScreeningRequest(ctx: QueryCtx, libraryId: Id<"evidenceLibraries">, sourceKey: string) {
  return await ctx.db
    .query("evidenceLibraryScreeningRequests")
    .withIndex("by_library_source", (q) => q.eq("libraryId", libraryId).eq("sourceKey", sourceKey))
    .unique();
}

/**
 * Keeps the owner's request, and sends it at once when the library already screens against its subject. A library holds
 * one request a source, and no more than it can have sources.
 */
export async function requestScreeningGrade(
  ctx: MutationCtx,
  request: { libraryId: Id<"evidenceLibraries">; sourceKey: string; subject: string; requestedBy: Id<"users"> },
) {
  const previous = await readScreeningRequest(ctx, request.libraryId, request.sourceKey);
  if (previous) await ctx.db.delete("evidenceLibraryScreeningRequests", previous._id);
  else {
    const waiting = await ctx.db
      .query("evidenceLibraryScreeningRequests")
      .withIndex("by_library_source", (q) => q.eq("libraryId", request.libraryId))
      .take(MAX_LIBRARY_SOURCES);
    if (waiting.length >= MAX_LIBRARY_SOURCES) throw createError("CONFLICT", "Every source of this community already has a grading request waiting.");
  }
  const requestId = await ctx.db.insert("evidenceLibraryScreeningRequests", { ...request, requestedAt: Date.now() });
  const report = await ctx.db
    .query("evidenceLibrarySourceStatus")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", request.libraryId))
    .unique();
  await sendDueScreeningGrades(ctx, request.libraryId, report?.sources ?? [], [requestId]);
}

/**
 * Sends the library's waiting requests whose subject its latest report names, as the report arrives, and lets go of
 * one the library took once its report shows the grading under way or done. `only` limits it to the requests just made.
 */
export async function sendDueScreeningGrades(
  ctx: MutationCtx,
  libraryId: Id<"evidenceLibraries">,
  sources: readonly SourceStatus[],
  only?: readonly Id<"evidenceLibraryScreeningRequests">[],
) {
  const requests = await ctx.db
    .query("evidenceLibraryScreeningRequests")
    .withIndex("by_library_source", (q) => q.eq("libraryId", libraryId))
    .take(MAX_LIBRARY_SOURCES);
  const now = Date.now();
  for (const request of requests) {
    if (only && !only.includes(request._id)) continue;
    const reported = sources.find((source) => source.key === request.sourceKey)?.screening;
    // A source the library hasn't screened for an hour, or no longer reports, takes its request with it: re-adding the
    // source later never sends a request nobody made for it.
    if (!reported && only === undefined && now - request.requestedAt > NOT_READY_GIVE_UP_MS) {
      await ctx.db.delete("evidenceLibraryScreeningRequests", request._id);
      continue;
    }
    if (request.sentAt !== undefined) {
      if (reported && (reported.grading !== null || reported.ungraded === 0)) await ctx.db.delete("evidenceLibraryScreeningRequests", request._id);
      continue;
    }
    if (request.error !== undefined || (request.sendingAt !== undefined && now - request.sendingAt < SEND_STALE_MS)) continue;
    if (reported?.subject?.trim() !== request.subject.trim()) continue;
    await ctx.db.patch("evidenceLibraryScreeningRequests", request._id, { sendingAt: now });
    await ctx.scheduler.runAfter(0, internal.zotero.runtimeReadActions.sendScreeningGrade, { requestId: request._id });
  }
}

export const get = internalQuery({
  args: { requestId: v.id("evidenceLibraryScreeningRequests") },
  returns: v.union(v.null(), v.object({ libraryId: v.id("evidenceLibraries"), sourceKey: v.string(), subject: v.string(), requestedBy: v.id("users") })),
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get("evidenceLibraryScreeningRequests", requestId);
    return request ? { libraryId: request.libraryId, sourceKey: request.sourceKey, subject: request.subject, requestedBy: request.requestedBy } : null;
  },
});

/**
 * What the library said: a queued request is sent, and waits for the report that shows its grading; "not-ready" is
 * asked again in a minute, for up to an hour; a refusal stays on the source with its reason.
 */
export const settle = internalMutation({
  args: {
    requestId: v.id("evidenceLibraryScreeningRequests"),
    outcome: v.union(v.literal("queued"), v.literal("not-ready"), v.literal("refused")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { requestId, outcome, error }) => {
    const request = await ctx.db.get("evidenceLibraryScreeningRequests", requestId);
    if (!request) return null;
    const now = Date.now();
    if (outcome === "not-ready" && now - request.requestedAt < NOT_READY_GIVE_UP_MS) {
      await ctx.db.patch("evidenceLibraryScreeningRequests", requestId, { sendingAt: now });
      await ctx.scheduler.runAfter(NOT_READY_RETRY_MS, internal.zotero.runtimeReadActions.sendScreeningGrade, { requestId });
      return null;
    }
    await ctx.db.patch("evidenceLibraryScreeningRequests", requestId, {
      sendingAt: undefined,
      ...(outcome === "queued" ? { sentAt: now } : {}),
      ...(outcome === "refused" ? { error } : {}),
      ...(outcome === "not-ready" ? { error: "The community didn't take the request within an hour. Check that the settings were activated and the community is running, then ask again." } : {}),
    });
    return null;
  },
});
