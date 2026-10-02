import { v, type Infer } from "convex/values";
import { validate } from "convex-helpers/validators";
import { httpAction, internalMutation, query } from "../lib/functions";
import { internal } from "../_generated/api";
import { createError, readConvexErrorData } from "../lib/errors";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { requireEvidenceLibraryAccess } from "./access";
import { authenticateLibraryServiceCredential } from "./credentials";
import {
  type SourceStatus,
  sourceStatusSnapshotValidator,
  sourceStatusValidator,
} from "./sourceStatusValidators";
import { MAX_LIBRARY_SOURCES as MAX_SOURCES } from "../lib/listCaps";

// A library lists its sources in its configuration; far fewer than this.
// Newest wins, so a clock far ahead would freeze a library's status.
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;

const isTime = (value: string | null) => value === null || !Number.isNaN(Date.parse(value));
const isCount = (value: number | null) => value === null || (Number.isInteger(value) && value >= 0);

/** What the validator cannot say: times that parse and counts that are whole and not negative. */
function isSensibleStatus(status: SourceStatus) {
  const counts = [
    status.searchable,
    status.searchFailed,
    status.changed,
    ...Object.values(status.issues),
    status.pdfs?.added ?? 0,
    status.pdfs?.missed ?? 0,
  ];
  const times = [status.lastSuccessAt];
  if (status.state === "running") {
    counts.push(status.done, status.total, status.minutesLeft);
    times.push(status.startedAt);
  }
  if (status.state === "failed") times.push(status.failure.at);
  return counts.every(isCount) && times.every(isTime);
}

/** Keeps the newest snapshot; a late or retried older one changes nothing. */
export const record = internalMutation({
  args: {
    libraryId: v.string(),
    credentialDigest: v.string(),
    observedAt: v.number(),
    sources: v.array(sourceStatusValidator),
  },
  returns: v.union(v.literal("saved"), v.literal("stale")),
  handler: async (ctx, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId) throw createError("UNAUTHENTICATED", "Invalid library service credential");
    await authenticateLibraryServiceCredential(ctx, { libraryId, credentialDigest: args.credentialDigest });
    const current = await ctx.db
      .query("evidenceLibrarySourceStatus")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId))
      .unique();
    if (current && current.observedAt >= args.observedAt) return "stale";
    const snapshot = { libraryId, observedAt: args.observedAt, sources: args.sources };
    if (current) await ctx.db.replace("evidenceLibrarySourceStatus", current._id, snapshot);
    else await ctx.db.insert("evidenceLibrarySourceStatus", snapshot);
    return "saved";
  },
});

/** The runtime's latest report, for the owner's configuration page. */
export const listForLibrary = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(v.null(), v.object({ observedAt: v.number(), sources: v.array(sourceStatusValidator) })),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const snapshot = await ctx.db
      .query("evidenceLibrarySourceStatus")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.libraryId))
      .unique();
    return snapshot ? { observedAt: snapshot.observedAt, sources: snapshot.sources } : null;
  },
});

/** `POST /api/v1/evidence-libraries/source-status`, called by the library's source worker. */
export const receiveSourceStatus = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) {
    return jsonResponse(401, { error: "invalid_service_credential" }, { "WWW-Authenticate": "Bearer" });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "invalid_request" });
  }
  if (!validate(sourceStatusSnapshotValidator, body)) return jsonResponse(400, { error: "invalid_request" });
  const snapshot = body as Infer<typeof sourceStatusSnapshotValidator>;
  const observedAt = Date.parse(snapshot.observedAt);
  if (
    Number.isNaN(observedAt) ||
    observedAt > Date.now() + MAX_CLOCK_AHEAD_MS ||
    snapshot.sources.length > MAX_SOURCES ||
    !snapshot.sources.every(isSensibleStatus)
  ) {
    return jsonResponse(400, { error: "invalid_request" });
  }
  try {
    const result = await ctx.runMutation(internal.evidenceLibraries.sourceStatus.record, {
      libraryId: snapshot.libraryId,
      credentialDigest: await digestOpaqueToken(credential),
      observedAt,
      sources: snapshot.sources,
    });
    return jsonResponse(200, { result });
  } catch (error) {
    const code = readConvexErrorData(error)?.code;
    if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") {
      return jsonResponse(401, { error: "invalid_service_credential" }, { "WWW-Authenticate": "Bearer" });
    }
    console.error("Source status report could not be saved", { libraryId: snapshot.libraryId, error });
    return jsonResponse(503, { error: "source_status_unavailable" });
  }
});
