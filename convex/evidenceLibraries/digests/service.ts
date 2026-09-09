import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { internalMutation, httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { authenticateLibraryServiceCredential } from "../credentials";
import { rateLimit } from "../../lib/rateLimit";
import { createError, readConvexErrorData } from "../../lib/errors";
import { jsonResponse, readBearerCredential } from "../../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../../lib/opaqueTokenDigest";
import { digestRequestSchema } from "./contract";
import { generateLibraryDigest } from "./generate";

export const authorize = internalMutation({
  args: {libraryId: v.string(), credentialDigest: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId) throw createError("FORBIDDEN", "Invalid library credential");
    await authenticateLibraryServiceCredential(ctx, {libraryId, credentialDigest: args.credentialDigest});
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library || library.state !== "active") throw createError("FORBIDDEN", "Library is unavailable");
    await rateLimit(ctx, {name: "library-digest", key: libraryId, throws: true});
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
  try {
    await ctx.runMutation(internal.evidenceLibraries.digests.service.authorize, {
      libraryId: body.data.libraryId,
      credentialDigest: await digestOpaqueToken(credential),
    });
    const digest = await generateLibraryDigest(body.data, AbortSignal.timeout(180_000));
    return jsonResponse(200, {digest});
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
    console.error("Library digest generation failed", {libraryId: body.data.libraryId, editionId: body.data.editionId, error});
    return jsonResponse(503, {error: "digest_generation_failed"});
  }
});
