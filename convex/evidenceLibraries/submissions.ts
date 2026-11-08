import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { getIdentity } from "../lib/auth";
import { authenticate } from "../topics/auth";
import { libraryOwner, ownerName } from "./access";
import { sentPapersValidator, submissionStatusValidator } from "./validators";

/** Submissions a page of Your submissions shows at most. */
const SUBMISSIONS_PAGE_MAX = 50;
/** The most of one status the status filter counts; past it, it says so. */
export const SUBMISSIONS_COUNTED = 500;
/** Everyone who sent the same paper to a community, whose rows a change from it updates. */
const SENDERS_PER_PAPER = 100;


const byPaper = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, libraryId: Id<"evidenceLibraries">, itemKey: string) =>
  ctx.db.query("paperSubmissions").withIndex("by_user_and_library_and_itemKey", (q) => q.eq("userId", userId).eq("libraryId", libraryId).eq("itemKey", itemKey)).unique();

/** Records the papers someone just sent to a community, published or waiting for review. One sent again is sent anew. */
export const recordSent = internalMutation({
  args: { userId: v.id("users"), libraryId: v.id("evidenceLibraries"), papers: sentPapersValidator },
  returns: v.null(),
  handler: async (ctx, { userId, libraryId, papers }) => {
    const now = Date.now();
    const community = (await communityOf(ctx, libraryId)).name;
    for (const paper of papers) {
      const existing = await byPaper(ctx, userId, libraryId, paper.itemKey);
      const row = { ...paper, searchText: `${paper.title} ${community}`.slice(0, 2000), note: undefined, sentAt: now, updatedAt: now };
      if (existing) await ctx.db.patch("paperSubmissions", existing._id, row);
      else await ctx.db.insert("paperSubmissions", { ...row, userId, libraryId });
    }
    return null;
  },
});

/** Forgets a paper the person withdrew from a community's review queue: it's no longer one of their submissions. */
export const forgetSent = internalMutation({
  args: { userId: v.id("users"), libraryId: v.id("evidenceLibraries"), itemKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, libraryId, itemKey }) => {
    const row = await byPaper(ctx, userId, libraryId, itemKey);
    if (row) await ctx.db.delete("paperSubmissions", row._id);
    return null;
  },
});

/**
 * What a community says of a paper sent to it: approved, returned with the reviewer's note, or withdrawn. It's the
 * community's machine credential that says so, and a change older than the last one applied changes nothing.
 */
export const applyStatus = internalMutation({
  args: {
    libraryId: v.string(),
    credentialDigest: v.string(),
    itemKey: v.string(),
    generation: v.number(),
    /** Who submitted the review it's about. */
    clerkUserId: v.string(),
    status: submissionStatusValidator,
    note: v.union(v.string(), v.null()),
    at: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { libraryId: library, credentialDigest, itemKey, generation, clerkUserId, status, note, at }) => {
    const libraryId = await authenticate(ctx, library, credentialDigest);
    // Published, it's published for everyone who sent it: a paper two people suggested is one record. Waiting,
    // returned or withdrawn is the submission of whoever sent it this time.
    const sender = status === "published" ? null : await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique();
    if (status !== "published" && !sender) return null;
    const rows = sender
      ? [await byPaper(ctx, sender._id, libraryId, itemKey)].filter((row) => row !== null)
      : await ctx.db.query("paperSubmissions").withIndex("by_library_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", itemKey)).take(SENDERS_PER_PAPER);
    for (const row of rows) {
      if ((row.generation ?? 0) >= generation) continue;
      // Taken back by the person who sent it, it's no longer one of their submissions.
      if (status === "withdrawn") await ctx.db.delete("paperSubmissions", row._id);
      else await ctx.db.patch("paperSubmissions", row._id, { status, note: note ?? undefined, generation, updatedAt: at });
    }
    return null;
  },
});

const submissionValidator = v.object({
  submissionId: v.id("paperSubmissions"),
  itemKey: v.string(),
  title: v.string(),
  authors: v.string(),
  year: v.union(v.number(), v.null()),
  openalexId: v.union(v.string(), v.null()),
  doi: v.union(v.string(), v.null()),
  status: submissionStatusValidator,
  note: v.union(v.string(), v.null()),
  sentAt: v.number(),
  community: v.object({
    libraryId: v.id("evidenceLibraries"),
    name: v.string(),
    faviconUrl: v.union(v.string(), v.null()),
    /** Where it answers, while it runs. */
    address: v.union(v.string(), v.null()),
    /** Who it belongs to, as its icon's corner shows them. */
    owner: v.union(
      v.object({ name: v.string(), kind: v.union(v.literal("organization"), v.literal("person")), imageUrl: v.union(v.string(), v.null()), workspaceId: v.id("workspaces") }),
      v.null(),
    ),
  }),
});

/** A community as a submission names it: its directory card's name and icon, where it answers, and who it belongs to. */
async function communityOf(ctx: QueryCtx, libraryId: Id<"evidenceLibraries">) {
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  const binding = library?.runtimeBindingId ? await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId) : null;
  return {
    libraryId,
    name: library?.card?.name ?? library?.name ?? "",
    faviconUrl: library?.card?.faviconUrl ?? null,
    address: library?.state === "active" ? (binding?.canonicalBaseUrl ?? binding?.targetBaseUrl ?? null) : null,
    owner: library ? await ownerOf(ctx, library) : null,
  };
}

/** Who a community belongs to: its organization, or the person whose own it is. */
async function ownerOf(ctx: QueryCtx, library: Doc<"evidenceLibraries">) {
  const owner = await libraryOwner(ctx, library);
  if (!owner) return null;
  const shown = await ownerName(ctx, owner);
  const person = owner.person ? [owner.person.firstName, owner.person.lastName].filter(Boolean).join(" ") : "";
  return owner.organization
    ? { name: shown.name ?? "", kind: "organization" as const, imageUrl: shown.imageUrl ?? null, workspaceId: owner.workspace._id }
    : { name: person, kind: "person" as const, imageUrl: shown.imageUrl ?? null, workspaceId: owner.workspace._id };
}

const rowOf = async (ctx: QueryCtx, row: Doc<"paperSubmissions">) => ({
  submissionId: row._id,
  itemKey: row.itemKey,
  title: row.title,
  authors: row.authors,
  year: row.year,
  openalexId: row.openalexId,
  doi: row.doi,
  status: row.status,
  note: row.note ?? null,
  sentAt: row.sentAt,
  community: await communityOf(ctx, row.libraryId),
});

/** The signed-in person, while their account is active. */
async function senderOf(ctx: QueryCtx) {
  const identity = await getIdentity(ctx);
  const person = identity ? await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject)).unique() : null;
  return person?.state === "active" ? person : null;
}

/** The papers the signed-in person sent to communities, newest first, of one status or all; searched by title and community, best match first. */
export const mine = query({
  args: { paginationOpts: paginationOptsValidator, status: v.optional(submissionStatusValidator), search: v.optional(v.string()) },
  returns: paginationResultValidator(submissionValidator),
  handler: async (ctx, { paginationOpts, status, search }) => {
    const person = await senderOf(ctx);
    if (!person) return { page: [], isDone: true, continueCursor: "" };
    const read = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, SUBMISSIONS_PAGE_MAX) };
    const needle = search?.trim().slice(0, 200);
    const page = needle
      ? await ctx.db
          .query("paperSubmissions")
          .withSearchIndex("search_text", (q) => (status ? q.search("searchText", needle).eq("userId", person._id).eq("status", status) : q.search("searchText", needle).eq("userId", person._id)))
          .paginate(read)
      : await (status
          ? ctx.db.query("paperSubmissions").withIndex("by_user_and_status_and_sentAt", (q) => q.eq("userId", person._id).eq("status", status))
          : ctx.db.query("paperSubmissions").withIndex("by_user_and_sentAt", (q) => q.eq("userId", person._id))
        )
          .order("desc")
          .paginate(read);
    return { ...page, page: await Promise.all(page.page.map((row) => rowOf(ctx, row))) };
  },
});

/** How many papers the signed-in person has of each status, up to SUBMISSIONS_COUNTED each, for the status filter. */
export const counts = query({
  args: {},
  returns: v.object({ queued: v.number(), published: v.number(), returned: v.number(), all: v.number() }),
  handler: async (ctx) => {
    const person = await senderOf(ctx);
    const count = async (status: "queued" | "published" | "returned") =>
      person ? (await ctx.db.query("paperSubmissions").withIndex("by_user_and_status_and_sentAt", (q) => q.eq("userId", person._id).eq("status", status)).take(SUBMISSIONS_COUNTED + 1)).length : 0;
    const [queued, published, returned] = await Promise.all([count("queued"), count("published"), count("returned")]);
    return { queued, published, returned, all: queued + published + returned };
  },
});
