/**
 * The public directory of Evidence Communities (#1090): every live community its owners haven't
 * unlisted, as cards. What a card shows is kept on the community's own row, written when a version
 * goes live and its record count refreshed after it and daily, so the directory reads one row per
 * card and sorts by an index, without calling the communities.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import schema from "../schema";
import { libraryOwner, ownerActive, ownerName } from "./access";
import { loadRevisionConfigurationSnapshot } from "./configurationSnapshot";

/** Most cards one page of the directory holds, and the rows one read passes over looking for a search's matches. */
const PAGE_MAX = 24;
const ROWS_READ = 300;
/** Communities one step of the daily count refresh asks about, a second apart so the communities aren't asked all at once. */
const REFRESH_STEP = 50;

export const directorySortValidator = v.union(v.literal("newest"), v.literal("name"), v.literal("records"));

const cardValidator = v.object({
  _id: v.id("evidenceLibraries"),
  name: v.string(),
  tagline: v.union(v.string(), v.null()),
  accentColor: v.union(v.string(), v.null()),
  faviconUrl: v.union(v.string(), v.null()),
  address: v.string(),
  /** Who it belongs to. A person is named by their name alone: null when they have none, never their email. */
  owner: v.object({ name: v.union(v.string(), v.null()), kind: v.union(v.literal("person"), v.literal("organization")), imageUrl: v.union(v.string(), v.null()) }),
  records: v.union(v.number(), v.null()),
  liveAt: v.union(v.number(), v.null()),
});

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

/** What a community's card shows, from a version of its settings: its name, tagline, accent colour and favicon. */
async function cardOf(ctx: QueryCtx, revisionId: Id<"evidenceLibraryConfigRevisions">) {
  const sections = new Map((await loadRevisionConfigurationSnapshot(ctx, revisionId, { requireComplete: false })).migration.snapshot.sections.map((section) => [section.sectionKey, section.payload]));
  const identity = sections.get("identity") as { name?: unknown; tagline?: unknown; assets?: { favicon?: unknown } } | undefined;
  const theme = sections.get("theme") as { colors?: { accent?: unknown } } | undefined;
  const name = text(identity?.name);
  const tagline = text(identity?.tagline);
  const accentColor = text(theme?.colors?.accent);
  const faviconUrl = text(identity?.assets?.favicon);
  return { ...(name ? { name } : {}), ...(tagline ? { tagline } : {}), ...(accentColor ? { accentColor } : {}), ...(faviconUrl ? { faviconUrl } : {}) };
}

/**
 * Keeps a community's card on its row once `revisionId` runs, and when it first went live, then asks
 * it for its record count. Called where a setup or a publish is put live.
 */
export async function noteLive(ctx: MutationCtx, library: Doc<"evidenceLibraries">, revisionId: Id<"evidenceLibraryConfigRevisions">, now: number) {
  await ctx.db.patch("evidenceLibraries", library._id, { card: await cardOf(ctx, revisionId), ...(library.liveAt === undefined ? { liveAt: now } : {}) });
  await ctx.scheduler.runAfter(0, internal.evidenceLibraries.sourceActions.refreshRecords, { libraryId: library._id });
}

/** The record count a community just gave. */
export const setRecords = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), records: v.number() },
  returns: v.null(),
  handler: async (ctx, { libraryId, records }) => {
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (library) await ctx.db.patch("evidenceLibraries", libraryId, { records, recordsAt: Date.now() });
    return null;
  },
});

/** Asks every live community for its record count, a step at a time: the daily refresh, and the backstop for an import we aren't told of. */
export const refreshAllRecords = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor = null }) => {
    const page = await ctx.db.query("evidenceLibraries").withIndex("by_state_and_unlisted_and_liveAt", (q) => q.eq("state", "active")).paginate({ cursor, numItems: REFRESH_STEP });
    for (const [at, library] of page.page.entries()) await ctx.scheduler.runAfter(at * 1000, internal.evidenceLibraries.sourceActions.refreshRecords, { libraryId: library._id });
    if (!page.isDone) await ctx.scheduler.runAfter(REFRESH_STEP * 1000, internal.evidenceLibraries.directory.refreshAllRecords, { cursor: page.continueCursor });
    return null;
  },
});

/** One card, or null for a community whose owner is gone. */
async function cardRow(ctx: QueryCtx, library: Doc<"evidenceLibraries">) {
  const owner = await libraryOwner(ctx, library);
  if (!owner || !ownerActive(owner)) return null;
  const binding = library.runtimeBindingId ? await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId) : null;
  const shown = await ownerName(ctx, owner);
  // The directory is public: a person's email stays theirs.
  const person = owner.person ? [owner.person.firstName, owner.person.lastName].filter(Boolean).join(" ") : null;
  return {
    _id: library._id,
    // The name its site runs with; a draft's new one isn't public until it's published.
    name: library.card?.name ?? library.name,
    tagline: library.card?.tagline ?? null,
    accentColor: library.card?.accentColor ?? null,
    faviconUrl: library.card?.faviconUrl ?? null,
    address: binding?.canonicalBaseUrl ?? binding?.targetBaseUrl ?? "",
    owner: owner.organization ? { name: shown.name, kind: "organization" as const, imageUrl: shown.imageUrl } : { name: person || null, kind: "person" as const, imageUrl: shown.imageUrl },
    records: library.records ?? null,
    liveAt: library.liveAt ?? null,
  };
}

export const listPublicAction = defineUserQuery({
  path: "evidenceLibraries/directory:listPublic",
  description:
    "Lists the public Evidence Communities, a page at a time: every live community its owners haven't unlisted, the person's own included, with its tagline, address, owner and how many records it holds. " +
    "`sort` is newest (when it went live), name, or records (most first); given `search`, those whose name, tagline or owner contains it.",
  args: { paginationOpts: paginationOptsValidator, sort: directorySortValidator, search: v.optional(v.string()) },
  returns: paginationResultValidator(cardValidator),
  run: async (ctx, _actor, { paginationOpts, sort, search }) => {
    const needle = search?.trim().toLowerCase();
    const index = sort === "newest" ? "by_state_and_unlisted_and_liveAt" : sort === "name" ? "by_state_and_unlisted_and_cardName" : "by_state_and_unlisted_and_records";
    return await stream(ctx.db, schema)
      .query("evidenceLibraries")
      .withIndex(index, (q) => q.eq("state", "active").eq("unlisted", undefined))
      .order(sort === "name" ? "asc" : "desc")
      .map(async (library) => await cardRow(ctx, library))
      .filterWith(async (card) => card !== null && (!needle || `${card.name} ${card.tagline ?? ""} ${card.owner.name ?? ""}`.toLowerCase().includes(needle)))
      .map(async (card) => card!)
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX), maximumRowsRead: ROWS_READ });
  },
});
export const listPublic = userQuery(listPublicAction);
export const listPublicForAssistant = assistantQuery(listPublicAction);

/** The card and when it went live, for a community that was live before cards were kept (../migrations/communityDirectory.ts). */
export async function backfillCard(ctx: MutationCtx, library: Doc<"evidenceLibraries">) {
  if (library.state !== "active" || !library.activeRevisionId || library.card) return;
  const deployment = library.activeDeploymentOperationId ? await ctx.db.get("evidenceLibraryConfigOperations", library.activeDeploymentOperationId) : null;
  const liveAt = library.liveAt ?? deployment?.receipt?.activatedAt ?? library.createdAt;
  await ctx.db.patch("evidenceLibraries", library._id, { card: await cardOf(ctx, library.activeRevisionId), liveAt });
  await ctx.scheduler.runAfter(0, internal.evidenceLibraries.sourceActions.refreshRecords, { libraryId: library._id });
}
