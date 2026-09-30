import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, httpAction, type MutationCtx } from "../../lib/functions";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { authenticateLibraryServiceCredential } from "../credentials";
import { evidenceLibraryDigestResultValidator } from "../validators";
import { rateLimit } from "../../lib/rateLimit";
import { createError, readConvexErrorData } from "../../lib/errors";
import { jsonResponse, readBearerCredential } from "../../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../../lib/opaqueTokenDigest";
import { digestRequestSchema } from "./contract";
import { generateLibraryDigest } from "./generate";

// Writing runs in the background, so a proxy timeout in front of this route
// cannot cut it off. A job still pending after STALE_AFTER_MS lost its action.
const GENERATION_TIMEOUT_MS = 480_000;
const STALE_AFTER_MS = 900_000;
// Every job, collected or not, is removed after a day.
const EXPIRE_AFTER_MS = 86_400_000;

const jobArgs = {libraryId: v.string(), editionId: v.string(), credentialDigest: v.string()};

async function authorizeLibrary(ctx: MutationCtx, args: {libraryId: string; credentialDigest: string}) {
  const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
  if (!libraryId) throw createError("FORBIDDEN", "Invalid library credential");
  await authenticateLibraryServiceCredential(ctx, {libraryId, credentialDigest: args.credentialDigest});
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library || library.state !== "active") throw createError("FORBIDDEN", "Library is unavailable");
  return libraryId;
}

function findJob(ctx: MutationCtx, libraryId: Id<"evidenceLibraries">, editionId: string) {
  return ctx.db.query("evidenceLibraryDigestJobs")
    .withIndex("by_libraryId_and_editionId", q => q.eq("libraryId", libraryId).eq("editionId", editionId))
    .unique();
}

/** Returns a finished digest until it expires, reports a failure once, or asks the caller to start one. */
export const poll = internalMutation({
  args: jobArgs,
  returns: v.union(
    v.object({status: v.literal("succeeded"), digest: evidenceLibraryDigestResultValidator}),
    v.object({status: v.union(v.literal("pending"), v.literal("failed"), v.literal("start"))}),
  ),
  handler: async (ctx, args) => {
    const libraryId = await authorizeLibrary(ctx, args);
    const job = await findJob(ctx, libraryId, args.editionId);
    if (!job) return {status: "start" as const};
    // Kept after a hand-over, so a retry after a lost response gets the same digest.
    if (job.status === "succeeded" && job.result) return {status: "succeeded" as const, digest: job.result};
    if (job.status === "pending" && job.startedAt > Date.now() - STALE_AFTER_MS) return {status: "pending" as const};
    if (job.requestId) await ctx.storage.delete(job.requestId);
    await ctx.db.delete("evidenceLibraryDigestJobs", job._id);
    return {status: "failed" as const};
  },
});

export const start = internalMutation({
  args: {...jobArgs, requestId: v.id("_storage")},
  returns: v.null(),
  handler: async (ctx, args) => {
    const libraryId = await authorizeLibrary(ctx, args);
    if (await findJob(ctx, libraryId, args.editionId)) {
      await ctx.storage.delete(args.requestId);
      return null;
    }
    await rateLimit(ctx, {name: "library-digest", key: libraryId, throws: true});
    const jobId = await ctx.db.insert("evidenceLibraryDigestJobs", {libraryId, editionId: args.editionId, requestId: args.requestId, status: "pending", startedAt: Date.now()});
    await ctx.scheduler.runAfter(0, internal.evidenceLibraries.digests.service.run, {jobId});
    await ctx.scheduler.runAfter(EXPIRE_AFTER_MS, internal.evidenceLibraries.digests.service.expire, {jobId});
    return null;
  },
});

export const expire = internalMutation({
  args: {jobId: v.id("evidenceLibraryDigestJobs")},
  returns: v.null(),
  handler: async (ctx, {jobId}) => {
    const job = await ctx.db.get("evidenceLibraryDigestJobs", jobId);
    if (!job) return null;
    if (job.requestId) await ctx.storage.delete(job.requestId);
    await ctx.db.delete("evidenceLibraryDigestJobs", jobId);
    return null;
  },
});

export const readJob = internalQuery({
  args: {jobId: v.id("evidenceLibraryDigestJobs")},
  returns: v.union(v.null(), v.object({libraryId: v.id("evidenceLibraries"), editionId: v.string(), requestId: v.optional(v.id("_storage"))})),
  handler: async (ctx, {jobId}) => {
    const job = await ctx.db.get("evidenceLibraryDigestJobs", jobId);
    return job && {libraryId: job.libraryId, editionId: job.editionId, requestId: job.requestId};
  },
});

export const finish = internalMutation({
  args: {jobId: v.id("evidenceLibraryDigestJobs"), result: v.union(v.null(), evidenceLibraryDigestResultValidator)},
  returns: v.null(),
  handler: async (ctx, {jobId, result}) => {
    const job = await ctx.db.get("evidenceLibraryDigestJobs", jobId);
    if (!job || job.status !== "pending") return null;
    if (job.requestId) await ctx.storage.delete(job.requestId);
    await ctx.db.patch("evidenceLibraryDigestJobs", jobId, result ? {status: "succeeded", result, requestId: undefined} : {status: "failed", requestId: undefined});
    return null;
  },
});

export const run = internalAction({
  args: {jobId: v.id("evidenceLibraryDigestJobs")},
  returns: v.null(),
  handler: async (ctx, {jobId}) => {
    const job = await ctx.runQuery(internal.evidenceLibraries.digests.service.readJob, {jobId});
    if (!job?.requestId) return null;
    let result = null;
    try {
      const blob = await ctx.storage.get(job.requestId);
      if (!blob) throw new Error("The stored digest request is missing");
      const request = digestRequestSchema.parse(JSON.parse(await blob.text()));
      result = await generateLibraryDigest(request, AbortSignal.timeout(GENERATION_TIMEOUT_MS));
    } catch (error) {
      console.error("Library digest generation failed", {libraryId: job.libraryId, editionId: job.editionId, error});
    }
    await ctx.runMutation(internal.evidenceLibraries.digests.service.finish, {jobId, result});
    return null;
  },
});

export const generate = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) return jsonResponse(401, {error: "invalid_service_credential"});
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_000_000) return jsonResponse(413, {error: "digest_too_large"});
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return jsonResponse(400, {error: "invalid_request"}); }
  const body = digestRequestSchema.safeParse(parsed);
  if (!body.success) return jsonResponse(400, {error: "invalid_request"});
  const job = {libraryId: body.data.libraryId, editionId: body.data.editionId, credentialDigest: await digestOpaqueToken(credential)};
  try {
    const state = await ctx.runMutation(internal.evidenceLibraries.digests.service.poll, job);
    if (state.status === "succeeded") return jsonResponse(200, {digest: state.digest});
    if (state.status === "pending") return jsonResponse(202, {status: "pending"});
    if (state.status === "failed") return jsonResponse(503, {error: "digest_generation_failed"});
    const requestId = await ctx.storage.store(new Blob([JSON.stringify(body.data)], {type: "application/json"}));
    try {
      await ctx.runMutation(internal.evidenceLibraries.digests.service.start, {...job, requestId});
    } catch (error) {
      await ctx.storage.delete(requestId);
      throw error;
    }
    return jsonResponse(202, {status: "pending"});
  } catch (error) {
    if (error instanceof ConvexError) {
      let details: unknown = error.data;
      if (typeof details === "string") {try {details = JSON.parse(details);} catch {details = null;}}
      if (details && typeof details === "object" && "kind" in details && details.kind === "RateLimited") {
        const retryAt = "retryAt" in details && typeof details.retryAt === "number" ? details.retryAt : Date.now() + 60_000;
        return jsonResponse(429, {error: "digest_rate_limited"}, {"Retry-After": String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)))});
      }
    }
    const data = readConvexErrorData(error);
    if (data?.code === "FORBIDDEN" || data?.code === "UNAUTHENTICATED") return jsonResponse(403, {error: "invalid_service_credential"});
    console.error("Library digest request failed", {libraryId: body.data.libraryId, editionId: body.data.editionId, error});
    return jsonResponse(503, {error: "digest_generation_failed"});
  }
});
