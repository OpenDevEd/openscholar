/**
 * The public directory of Evidence Communities (#1090): every live community its owners haven't
 * unlisted, as cards. What a card shows is kept on the community's own row, written when a version
 * goes live and its record count refreshed after it and daily, so the directory reads one row per
 * card and sorts by an index, without calling the communities.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, query } from "../lib/functions";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import schema from "../schema";
import { libraryOwner, ownerActive, ownerName } from "./access";
import { loadRevisionConfigurationSnapshot } from "./configurationSnapshot";
import { readLibraryPeople } from "./queries";
import { COUNTRIES_KEPT, countriesValidator } from "./validators";

/** Most cards one page of the directory holds, and the rows one read passes over looking for a search's matches. */
const PAGE_MAX = 100;
const ROWS_READ = 500;
/** Communities one step of the daily count refresh asks about, a second apart so the communities aren't asked all at once. */
const REFRESH_STEP = 50;

export const directorySortValidator = v.union(v.literal("newest"), v.literal("name"), v.literal("records"));

const cardValidator = v.object({
  _id: v.id("evidenceLibraries"),
  name: v.string(),
  /** Its tagline, or its description when it has none; null when it has neither. */
  tagline: v.union(v.string(), v.null()),
  accentColor: v.union(v.string(), v.null()),
  faviconUrl: v.union(v.string(), v.null()),
  address: v.string(),
  /** Who it belongs to. A person is named by their name alone: null when they have none, never their email. */
  owner: v.object({
    name: v.union(v.string(), v.null()),
    kind: v.union(v.literal("person"), v.literal("organization")),
    imageUrl: v.union(v.string(), v.null()),
    /** Its workspace, and the colour an organization's admins picked: the switcher's mark for one with no logo is made from them. */
    workspaceId: v.id("workspaces"),
    colour: v.union(v.string(), v.null()),
  }),
  records: v.union(v.number(), v.null()),
  /** The countries most of its public records are about, most first; empty until its runtime names them. */
  countries: countriesValidator,
  /** How many people work on it: its owners and everyone given a role in it; null until counted. */
  people: v.union(v.number(), v.null()),
  liveAt: v.union(v.number(), v.null()),
  /** When its last version went live. */
  publishedAt: v.union(v.number(), v.null()),
});

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

/** What a community's card shows, from a version of its settings: its name, tagline, description, accent colour and favicon. */
async function cardOf(ctx: QueryCtx, revisionId: Id<"evidenceLibraryConfigRevisions">) {
  const sections = new Map((await loadRevisionConfigurationSnapshot(ctx, revisionId, { requireComplete: false })).migration.snapshot.sections.map((section) => [section.sectionKey, section.payload]));
  const identity = sections.get("identity") as { name?: unknown; tagline?: unknown; description?: unknown; assets?: { favicon?: unknown } } | undefined;
  const theme = sections.get("theme") as { colors?: { accent?: unknown } } | undefined;
  const name = text(identity?.name);
  const tagline = text(identity?.tagline);
  const description = text(identity?.description);
  const accentColor = text(theme?.colors?.accent);
  const faviconUrl = text(identity?.assets?.favicon);
  // The name the directory sorts by: in lower case, so "new lib" comes before "OpenDevEd".
  return { ...(name ? { name, nameKey: name.toLowerCase() } : {}), ...(tagline ? { tagline } : {}), ...(description ? { description } : {}), ...(accentColor ? { accentColor } : {}), ...(faviconUrl ? { faviconUrl } : {}) };
}

/**
 * Whether an operation is its owners putting their settings live: a setup, or an activation of their
 * draft or of an earlier version, which carries the draft's edit version (and may update the software
 * or a domain on the way). A software update, an address move or a domain change alone puts the same
 * settings live again, even when it saves them as a new version in a newer format.
 */
export function publishesSettings(operation: Doc<"evidenceLibraryConfigOperations">) {
  return operation.kind === "setup" || (operation.kind === "publish" && operation.activationEditVersion !== undefined);
}

/**
 * Keeps a community's card on its row once `revisionId` runs and when it first went live, then asks it
 * for its record count. Called where a setup or a publish is put live; `published` when its owners put
 * their settings live (`publishesSettings`), which is the time its card shows.
 */
export async function noteLive(ctx: MutationCtx, library: Doc<"evidenceLibraries">, revisionId: Id<"evidenceLibraryConfigRevisions">, now: number, published: boolean) {
  await ctx.db.patch("evidenceLibraries", library._id, { card: await cardOf(ctx, revisionId), ...(published || library.publishedAt === undefined ? { publishedAt: now } : {}), ...(library.liveAt === undefined ? { liveAt: now } : {}) });
  await ctx.scheduler.runAfter(0, internal.evidenceLibraries.sourceActions.refreshRecords, { libraryId: library._id });
  await ctx.scheduler.runAfter(0, internal.evidenceLibraries.directory.recountPeople, { libraryId: library._id });
}

/** The record count a community just gave, and the countries most of its records are about when its runtime names them. */
export const setRecords = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), records: v.number(), countries: v.optional(v.array(v.string())) },
  returns: v.null(),
  handler: async (ctx, { libraryId, records, countries }) => {
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (library) await ctx.db.patch("evidenceLibraries", libraryId, { records, recordsAt: Date.now(), ...(countries ? { countries: countries.map((code) => code.toLowerCase()).slice(0, COUNTRIES_KEPT) } : {}) });
    return null;
  },
});

/** How many people work on a community, as its card says: its owners, everyone given a role in it, and the members of the organizations it's shared with. Run when its team changes (./peopleCount.ts) and daily. */
export const recountPeople = internalMutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, { libraryId }) => {
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library || library.state === "disabled") return null;
    const people = (await readLibraryPeople(ctx, library, { organizations: true })).filter((person) => person.role === "owner" || person.role === "editor" || person.role === "creator").length;
    if (library.people !== people) await ctx.db.patch("evidenceLibraries", libraryId, { people });
    return null;
  },
});

/** Recounts the people of each of an organization's communities, a page at a time: its admins, who own them, changed. */
export const recountOrganization = internalMutation({
  args: { workspaceId: v.id("workspaces"), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, cursor = null }) => {
    const page = await ctx.db.query("evidenceLibraries").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).paginate({ cursor, numItems: REFRESH_STEP });
    for (const library of page.page) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.directory.recountPeople, { libraryId: library._id });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.directory.recountOrganization, { workspaceId, cursor: page.continueCursor });
    return null;
  },
});

/** Recounts the people of each community shared with an organization, a page at a time: someone joined it or left (#1091). */
export const recountShared = internalMutation({
  args: { organizationId: v.id("organizations"), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { organizationId, cursor = null }) => {
    const page = await ctx.db.query("libraryOrganizationGrants").withIndex("by_organization_and_grantedAt", (q) => q.eq("organizationId", organizationId)).paginate({ cursor, numItems: REFRESH_STEP });
    for (const grant of page.page) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.directory.recountPeople, { libraryId: grant.libraryId });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.directory.recountShared, { organizationId, cursor: page.continueCursor });
    return null;
  },
});

/** Asks every live community for its record count, a step at a time: the daily refresh, and the backstop for an import we aren't told of. */
export const refreshAllRecords = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor = null }) => {
    const page = await ctx.db.query("evidenceLibraries").withIndex("by_state_and_unlisted_and_liveAt", (q) => q.eq("state", "active")).paginate({ cursor, numItems: REFRESH_STEP });
    for (const [at, library] of page.page.entries()) {
      await ctx.scheduler.runAfter(at * 1000, internal.evidenceLibraries.sourceActions.refreshRecords, { libraryId: library._id });
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.directory.recountPeople, { libraryId: library._id });
    }
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
    tagline: library.card?.tagline ?? library.card?.description ?? null,
    accentColor: library.card?.accentColor ?? null,
    faviconUrl: library.card?.faviconUrl ?? null,
    address: binding?.canonicalBaseUrl ?? binding?.targetBaseUrl ?? "",
    owner: owner.organization
      ? { name: shown.name, kind: "organization" as const, imageUrl: shown.imageUrl, workspaceId: owner.workspace._id, colour: owner.organization.colour ?? null }
      : { name: person || null, kind: "person" as const, imageUrl: shown.imageUrl, workspaceId: owner.workspace._id, colour: null },
    records: library.records ?? null,
    countries: library.countries ?? [],
    people: library.people ?? null,
    liveAt: library.liveAt ?? null,
    publishedAt: library.publishedAt ?? library.liveAt ?? null,
  };
}

const directoryArgs = { paginationOpts: paginationOptsValidator, sort: directorySortValidator, search: v.optional(v.string()) };

/**
 * The public directory, a page at a time: every live community its owners haven't unlisted. Nothing in a card is
 * anyone's private business (the owner's email never is), so it's read signed in or not.
 */
async function readDirectory(ctx: QueryCtx, { paginationOpts, sort, search }: Infer<ReturnType<typeof v.object<typeof directoryArgs>>>) {
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
}

export const listPublicAction = defineUserQuery({
  path: "evidenceLibraries/directory:listPublic",
  description:
    "Lists the public Evidence Communities, a page at a time: every live community its owners haven't unlisted, the person's own included, with its tagline, address, owner and how many records it holds. " +
    "`sort` is newest (when it went live), name, or records (most first); given `search`, those whose name, tagline or owner contains it.",
  args: directoryArgs,
  returns: paginationResultValidator(cardValidator),
  run: async (ctx, _actor, args) => await readDirectory(ctx, args),
});
export const listPublic = userQuery(listPublicAction);
export const listPublicForAssistant = assistantQuery(listPublicAction);

/** The same directory for the Communities page, which anyone opens, signed in or not. */
export const directory = query({
  args: directoryArgs,
  returns: paginationResultValidator(cardValidator),
  handler: async (ctx, args) => await readDirectory(ctx, args),
});

/** The latest activations by its owners the backfill reads for the last that went live. */
const OPERATIONS_READ = 10;

/**
 * The card, when it went live and when its owners last put their settings live, for a live community whose
 * row doesn't say so (../migrations/communityDirectory.ts). One that already does is left alone.
 */
export async function backfillCard(ctx: MutationCtx, library: Doc<"evidenceLibraries">) {
  if (library.state !== "active" || !library.activeRevisionId) return;
  // Its owners' activations, newest first, and its setup when none went live.
  const activations = await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_activationEditVersion", (q) => q.eq("libraryId", library._id).gte("activationEditVersion", 0)).order("desc").take(OPERATIONS_READ);
  const published = activations.find((operation) => operation.status === "succeeded" && operation.kind === "publish")
    ?? await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_kind_and_createdAt", (q) => q.eq("libraryId", library._id).eq("kind", "setup")).order("desc").first();
  const publishedAt = published?.completedAt ?? library.liveAt ?? library.createdAt;
  if (library.publishedAt === publishedAt && library.liveAt !== undefined && library.card && (!library.card.name || library.card.nameKey)) return;
  // When it went live: its first settings' publish, which a setup puts live.
  const first = library.liveAt === undefined ? await ctx.db.query("evidenceLibraryConfigRevisions").withIndex("by_libraryId_and_revisionNumber", (q) => q.eq("libraryId", library._id)).first() : null;
  await ctx.db.patch("evidenceLibraries", library._id, { card: await cardOf(ctx, library.activeRevisionId), liveAt: library.liveAt ?? first?.createdAt ?? publishedAt, publishedAt });
  if (library.records === undefined) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.sourceActions.refreshRecords, { libraryId: library._id });
  if (library.people === undefined) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.directory.recountPeople, { libraryId: library._id });
}
