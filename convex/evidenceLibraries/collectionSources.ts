import { v } from "convex/values";
import { paginationResultValidator } from "convex/server";
import { MAX_LIBRARY_SOURCES } from "../lib/listCaps";
import type { Doc, Id } from "../_generated/dataModel";
import {
  httpAction,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../lib/functions";
import { internal } from "../_generated/api";
import { writeAuditLogRecord } from "../lib/audit";
import { requireAuth } from "../lib/auth";
import { createError, readConvexErrorData } from "../lib/errors";
import { jsonResponse, readBearerCredential } from "../lib/libraryServiceHttp";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { readActiveOrganizationMembership, requireEvidenceLibraryAccess } from "./access";
import { authenticateLibraryServiceCredential } from "./credentials";

// Items a page carries. Each costs one read of its library item.
const ITEMS_PER_PAGE = 1_000;

type ReadCtx = Pick<QueryCtx | MutationCtx, "db">;

async function findConnection(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
  collectionId: Id<"collections">,
) {
  return await ctx.db
    .query("evidenceLibraryCollectionSources")
    .withIndex("by_libraryId_and_collectionId", (q) =>
      q.eq("libraryId", libraryId).eq("collectionId", collectionId),
    )
    .unique();
}

const collectionSourceValidator = v.object({
  collectionId: v.id("collections"),
  // Null once the collection was deleted.
  name: v.union(v.string(), v.null()),
  itemCount: v.number(),
  connectedByClerkUserId: v.string(),
  connectedAt: v.number(),
});

/** The collections the library follows, with their current names. */
const row = async (ctx: QueryCtx, connection: Doc<"evidenceLibraryCollectionSources">) => {
  const collection = await ctx.db.get("collections", connection.collectionId);
  return {
    collectionId: connection.collectionId,
    name: collection?.name ?? null,
    itemCount: collection?.itemCount ?? 0,
    connectedByClerkUserId: connection.connectedByClerkUserId,
    connectedAt: connection.connectedAt,
  };
};

/**
 * The library's connections to these collections, as one page; a collection it never
 * connected is left out. A configuration holds at most MAX_LIBRARY_SOURCES sources, so a page
 * asks for no more. Connections are kept when a source leaves a draft, so they are read by the
 * sources shown and never listed whole. The IDs come from saved configuration, so one that
 * isn't a collection's is passed over like a collection that was never connected.
 */
export const listCollectionSources = query({
  args: { libraryId: v.id("evidenceLibraries"), collectionIds: v.array(v.string()) },
  returns: paginationResultValidator(collectionSourceValidator),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    if (args.collectionIds.length > MAX_LIBRARY_SOURCES) throw createError("VALIDATION_ERROR", `Collections are read ${MAX_LIBRARY_SOURCES} at a time.`);
    const collectionIds = [...new Set(args.collectionIds)].flatMap((id) => ctx.db.normalizeId("collections", id) ?? []);
    const connections = await Promise.all(collectionIds.map((collectionId) => findConnection(ctx, args.libraryId, collectionId)));
    const page = await Promise.all(connections.flatMap((connection) => (connection ? [row(ctx, connection)] : [])));
    return { page, isDone: true, continueCursor: "" };
  },
});

/** The first 100 connections a library made. Kept for one release, while the deployed site still calls it; `listCollectionSources` replaces it. */
export const listLibraryCollectionSources = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.array(collectionSourceValidator),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const rows = await ctx.db
      .query("evidenceLibraryCollectionSources")
      .withIndex("by_libraryId_and_collectionId", (q) => q.eq("libraryId", args.libraryId))
      .take(100);
    return await Promise.all(rows.map((connection) => row(ctx, connection)));
  },
});

/**
 * Lets the library follow one of the signed-in owner's own collections. The
 * connection stays when the source leaves a draft, so a discarded draft or an
 * older revision still reads it; only the owner leaving ends the library's access.
 */
export const connectCollectionSource = mutation({
  args: { libraryId: v.id("evidenceLibraries"), collectionId: v.id("collections") },
  returns: v.object({ collectionId: v.id("collections"), name: v.string(), itemCount: v.number() }),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const user = await requireAuth(ctx);
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Only the collection's owner can add it to a library");
    }
    const fields = {
      libraryId: args.libraryId,
      collectionId: args.collectionId,
      connectedByClerkUserId: access.clerkUserId,
      connectedAt: Date.now(),
    };
    const existing = await findConnection(ctx, args.libraryId, args.collectionId);
    if (existing) await ctx.db.replace("evidenceLibraryCollectionSources", existing._id, fields);
    else await ctx.db.insert("evidenceLibraryCollectionSources", fields);
    await writeAuditLogRecord(ctx, {
      action: "evidence_library.collection_source.connected",
      userId: access.clerkUserId,
      metadata: { libraryId: args.libraryId, collectionId: args.collectionId },
    });
    return { collectionId: collection._id, name: collection.name, itemCount: collection.itemCount ?? 0 };
  },
});

const REFUSALS = ["not_configured", "owner_left", "collection_not_found"] as const;
type Refusal = (typeof REFUSALS)[number];

const collectionItemValidator = v.object({
  itemId: v.string(),
  openalexId: v.union(v.string(), v.null()),
  doi: v.union(v.string(), v.null()),
});

/** "https://openalex.org/W123" or "W123" as "W123"; anything else is not an OpenAlex work. */
function openAlexWorkId(value: string) {
  return /(?:^|\/)(W\d+)$/u.exec(value.trim())?.[1] ?? null;
}

/** Why the library may not read the collection now, or null when it may. */
async function refusal(
  ctx: ReadCtx,
  library: Doc<"evidenceLibraries">,
  collectionId: Id<"collections">,
): Promise<{ refused: Refusal } | { collection: Doc<"collections"> }> {
  const connection = await findConnection(ctx, library._id, collectionId);
  if (!connection) return { refused: "not_configured" };
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection) return { refused: "collection_not_found" };
  const owner = await ctx.db.get("users", collection.userId);
  const member =
    owner?.state !== "deleted" && owner
      ? await readActiveOrganizationMembership(ctx, library.organizationId, owner.clerkId)
      : null;
  return member ? { collection } : { refused: "owner_left" };
}

/** One page of a collection the library follows, read with its machine credential. */
export const readForLibrary = internalQuery({
  args: {
    libraryId: v.string(),
    credentialDigest: v.string(),
    collectionId: v.string(),
    knownVersion: v.union(v.string(), v.null()),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.union(
    v.object({ refused: v.union(...REFUSALS.map((code) => v.literal(code))) }),
    v.object({
      version: v.string(),
      name: v.string(),
      unchanged: v.boolean(),
      items: v.array(collectionItemValidator),
      nextCursor: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId) throw createError("UNAUTHENTICATED", "Invalid library service credential");
    await authenticateLibraryServiceCredential(ctx, { libraryId, credentialDigest: args.credentialDigest });
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    const collectionId = ctx.db.normalizeId("collections", args.collectionId);
    if (!library || !collectionId) return { refused: "not_configured" as const };
    const allowed = await refusal(ctx, library, collectionId);
    if ("refused" in allowed) return allowed;
    const { collection } = allowed;
    const version = String(collection.membershipRevision ?? 0);
    // The contract caps a source name; the collection keeps its own.
    const name = collection.name.slice(0, 255);
    if (args.knownVersion === version) {
      return { version, name, unchanged: true, items: [], nextCursor: null };
    }
    const page = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
      .paginate({ numItems: ITEMS_PER_PAGE, cursor: args.cursor });
    const items = await Promise.all(
      page.page.map(async (membership) => {
        const libraryItem = await ctx.db.get("libraryItems", membership.libraryItemId);
        return libraryItem
          ? [{ itemId: libraryItem._id, openalexId: openAlexWorkId(libraryItem.openalexId), doi: libraryItem.doi ?? null }]
          : [];
      }),
    );
    return {
      version,
      name,
      unchanged: false,
      items: items.flat(),
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

const REFUSAL_STATUS: Record<Refusal, number> = {
  not_configured: 403,
  owner_left: 403,
  collection_not_found: 404,
};

function readRequestBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const optionalText = (field: unknown) => field === undefined || field === null || (typeof field === "string" && field.length <= 512);
  if (
    body.contractVersion !== 1 ||
    typeof body.libraryId !== "string" || body.libraryId.length > 128 ||
    typeof body.collectionId !== "string" || body.collectionId.length > 128 ||
    !optionalText(body.knownVersion) || !optionalText(body.cursor)
  ) {
    return null;
  }
  return {
    libraryId: body.libraryId,
    collectionId: body.collectionId,
    knownVersion: (body.knownVersion as string | null | undefined) ?? null,
    cursor: (body.cursor as string | null | undefined) ?? null,
  };
}

/** `POST /api/v1/evidence-libraries/source-collections/items`, called by the library's source worker. */
export const readCollectionItems = httpAction(async (ctx, request) => {
  const credential = readBearerCredential(request);
  if (!credential) {
    return jsonResponse(401, { error: "invalid_service_credential" }, { "WWW-Authenticate": "Bearer" });
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse(400, { error: "invalid_request" });
  }
  const body = readRequestBody(parsed);
  if (!body) return jsonResponse(400, { error: "invalid_request" });
  try {
    const result = await ctx.runQuery(internal.evidenceLibraries.collectionSources.readForLibrary, {
      ...body,
      credentialDigest: await digestOpaqueToken(credential),
    });
    if ("refused" in result) return jsonResponse(REFUSAL_STATUS[result.refused], { error: result.refused });
    return jsonResponse(200, { contractVersion: 1, ...result });
  } catch (error) {
    const code = readConvexErrorData(error)?.code;
    if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") {
      return jsonResponse(401, { error: "invalid_service_credential" }, { "WWW-Authenticate": "Bearer" });
    }
    console.error("Collection source read failed", { libraryId: body.libraryId, collectionId: body.collectionId, error });
    return jsonResponse(503, { error: "collection_source_unavailable" });
  }
});
