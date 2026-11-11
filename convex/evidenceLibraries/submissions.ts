import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { SUBMISSIONS_COUNTED, paperHref, recordHref } from "../../lib/evidence-libraries/added-papers";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { libraryEmailSender } from "./invitations";
import { getIdentity } from "../lib/auth";
import { authenticate } from "../topics/auth";
import { cardFacts, libraryOwner, ownerName, readLibraryRole, readLibraryViewRole } from "./access";
import { PAPER_SENT_TO, RECENT_COMMUNITIES, recentCommunitiesValidator, sentPaperSummaryValidator, sentPapersValidator, sentToValidator, submissionOwnerValidator, submissionStatusValidator } from "./validators";

/** Submissions a page of Your submissions shows at most. */
const SUBMISSIONS_PAGE_MAX = 50;
/** Everyone who sent the same paper to a community, a page of whose rows a change from it updates at a time. */
const SENDERS_PER_PAPER = 100;
/** The latest submissions Add to community looks through for its recent communities. */
const RECENT_SUBMISSIONS_READ = 50;


const byPaper = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, libraryId: Id<"evidenceLibraries">, itemKey: string) =>
  ctx.db.query("paperSubmissions").withIndex("by_user_and_library_and_itemKey", (q) => q.eq("userId", userId).eq("libraryId", libraryId).eq("itemKey", itemKey)).unique();

/**
 * Records the papers someone just sent to a community, published or waiting for review. One sent again by a new request
 * is sent anew; the same request replayed changes nothing, so what the community said since stands. A word from the
 * community that came before this, held until now, applies.
 */
export const recordSent = internalMutation({
  args: { userId: v.id("users"), libraryId: v.id("evidenceLibraries"), requestId: v.string(), papers: sentPapersValidator },
  returns: v.null(),
  handler: async (ctx, { userId, libraryId, requestId, papers }) => {
    const now = Date.now();
    const community = (await communityOf(ctx, libraryId)).name;
    const person = await ctx.db.get("users", userId);
    for (const paper of papers) {
      const existing = await byPaper(ctx, userId, libraryId, paper.itemKey);
      if (existing?.requestId === requestId) continue;
      const row = { ...paper, requestId, searchText: searchTextOf(paper.title, community), note: undefined, sentAt: now, updatedAt: now };
      const id = existing ? (await ctx.db.patch("paperSubmissions", existing._id, row), existing._id) : await ctx.db.insert("paperSubmissions", { ...row, userId, libraryId });
      if (person) await applyHeld(ctx, id, libraryId, paper.itemKey, person.clerkId);
    }
    return null;
  },
});

const searchTextOf = (title: string, community: string) => `${title} ${community}`.slice(0, 2000);

/** Applies a word from the community held for this paper, when it's about this sender or says it's published. */
async function applyHeld(ctx: MutationCtx, id: Id<"paperSubmissions">, libraryId: Id<"evidenceLibraries">, itemKey: string, clerkUserId: string) {
  const held = await ctx.db.query("pendingSubmissionStatus").withIndex("by_library_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", itemKey)).take(SENDERS_PER_PAPER);
  for (const event of held) {
    if (!forEveryone(event.status) && event.clerkUserId !== clerkUserId) continue;
    await ctx.db.delete("pendingSubmissionStatus", event._id);
    const row = await ctx.db.get("paperSubmissions", id);
    if (!row || (row.generation ?? 0) >= event.generation) continue;
    await ctx.db.patch("paperSubmissions", id, { status: event.status, note: event.note, generation: event.generation, updatedAt: event.at });
    await tellSender(ctx, row, event.status, event.generation);
  }
}

/**
 * The person who sent a paper hears the team's answer by email: it's live, or it wasn't added. Every such word about a
 * paper that isn't published yet is an answer, whatever the row last said: sent again, a paper can be answered before
 * Openscholar has recorded that it waits. One published as it was sent, by someone on the team, is published already
 * when the community says so, and needs no telling.
 */
async function tellSender(ctx: MutationCtx, before: Doc<"paperSubmissions">, status: Doc<"paperSubmissions">["status"], generation: number) {
  const answered = (status === "published" || status === "returned") && before.status !== "published";
  if (!answered) return;
  await ctx.scheduler.runAfter(0, internal.evidenceLibraries.submissionEmails.toSender, { submissionId: before._id, generation });
}

/**
 * What the email about a submission's answer says, and who it goes to (./submissionEmails.ts). Null once the
 * community has said something newer than the answer this email is for (`generation`): that word has its own email,
 * or needs none.
 */
export const readForEmail = internalQuery({
  args: { submissionId: v.id("paperSubmissions"), generation: v.number() },
  handler: async (ctx, { submissionId, generation }) => {
    const row = await ctx.db.get("paperSubmissions", submissionId);
    const library = row ? await ctx.db.get("evidenceLibraries", row.libraryId) : null;
    const sender = row ? await ctx.db.get("users", row.userId) : null;
    if (!row || !library || !sender?.email || row.generation !== generation || (row.status !== "published" && row.status !== "returned")) return null;
    const { name, address } = await communityOf(ctx, library._id);
    return {
      to: sender.email,
      status: row.status,
      note: row.note ?? null,
      paper: { title: row.title, authors: row.authors, year: row.year },
      libraryName: name,
      recordLink: address ? recordHref(address, row.itemKey) : null,
      ...(await libraryEmailSender(ctx, library)),
    };
  },
});

/**
 * Records a paper taken off a community through Openscholar. Withdrawn from the review queue, it's the person's own
 * submission that's withdrawn. Removed from the community, it's removed for whoever sent it, so no one's list calls it
 * published or links its deleted record.
 */
/** Submissions of one paper marked removed in one go. */
const REMOVED_AT_ONCE = 100;

export const forgetSent = internalMutation({
  args: { userId: v.id("users"), libraryId: v.id("evidenceLibraries"), itemKey: v.string(), outcome: v.union(v.literal("withdrawn"), v.literal("removed")) },
  returns: v.null(),
  handler: async (ctx, { userId, libraryId, itemKey, outcome }) => {
    const rows = outcome === "withdrawn"
      ? [await byPaper(ctx, userId, libraryId, itemKey)].filter((row) => row !== null)
      : await ctx.db.query("paperSubmissions").withIndex("by_library_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", itemKey)).filter((q) => q.neq(q.field("status"), "removed")).take(REMOVED_AT_ONCE);
    // Kept with the community's last generation, so a late repeat of an older word changes nothing.
    for (const row of rows) await ctx.db.patch("paperSubmissions", row._id, { status: outcome, note: undefined, updatedAt: Date.now() });
    // A paper many people sent is marked removed for the rest next.
    if (outcome === "removed" && rows.length === REMOVED_AT_ONCE) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.submissions.forgetSent, { userId, libraryId, itemKey, outcome });
    return null;
  },
});

/** Published, or later taken off the community's site, a paper is one record: the word is for everyone who sent it. */
const forEveryone = (status: Doc<"paperSubmissions">["status"]) => status === "published" || status === "removed";

/**
 * What a community says of a paper sent to it: approved, returned with the reviewer's note, withdrawn, or removed once
 * its team unpublished or deleted the record. It's the community's machine credential that says so, and a change older
 * than the last one applied changes nothing.
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
    /** What the paper is, when the community says so: one its own site sent has no row here until then. */
    paper: v.optional(v.object({ ...sentPaperSummaryValidator.fields, requestId: v.optional(v.string()) })),
  },
  returns: v.null(),
  handler: async (ctx, { libraryId: library, credentialDigest, itemKey, generation, clerkUserId, status, note, at, paper }) => {
    const libraryId = await authenticate(ctx, library, credentialDigest);
    // Published or removed, it is for everyone who sent it: a paper two people suggested is one record. Waiting,
    // returned or withdrawn is the submission of whoever sent it this time.
    const sender = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique();
    if (!forEveryone(status) && !sender) return null;
    // Everyone's word reads a page of those who sent the paper; the rest are paged after (applyToSenders).
    const everyone = forEveryone(status) ? await sendersPage(ctx, libraryId, itemKey, null) : null;
    const rows = everyone ? everyone.page : [await byPaper(ctx, sender!._id, libraryId, itemKey)].filter((row) => row !== null);
    // Sent from the community's own site, it becomes their submission here with the community's first word on it, which
    // is published when a reviewer approved it before the word that it waits arrived.
    // Under the request that sent it, so when that request was Openscholar's and is still finishing, it finds the
    // community's word already here and leaves it.
    // Their own row, looked up whatever rows the status read, which for published are the first of many senders.
    if (sender && paper && !(await byPaper(ctx, sender._id, libraryId, itemKey))) {
      const { requestId, ...summary } = paper;
      const community = (await communityOf(ctx, libraryId)).name;
      const id = await ctx.db.insert("paperSubmissions", { ...summary, ...(requestId ? { requestId } : {}), userId: sender._id, libraryId, itemKey, status, ...(note ? { note } : {}), generation, searchText: searchTextOf(paper.title, community), sentAt: at, updatedAt: at });
      await applyHeld(ctx, id, libraryId, itemKey, clerkUserId);
      // Published or removed, it is for the others who sent it too.
      if (!forEveryone(status) || !rows.length) return null;
    }
    // Before Openscholar recorded the paper as sent, as when the community answers first: it's held until it is.
    if (!rows.length) {
      await ctx.db.insert("pendingSubmissionStatus", { libraryId, itemKey, clerkUserId, generation, status, note: note ?? undefined, at });
      return null;
    }
    const word = { status, note: note ?? undefined, generation, at, ...(paper?.requestId && sender ? { senderId: sender._id, requestId: paper.requestId } : {}) };
    await applyTo(ctx, rows, word);
    if (everyone && !everyone.isDone) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.submissions.applyToSenders, { libraryId, itemKey, cursor: everyone.continueCursor, word });
    return null;
  },
});

/** One page of everyone who sent a paper to a community. */
const sendersPage = (ctx: QueryCtx, libraryId: Id<"evidenceLibraries">, itemKey: string, cursor: string | null) =>
  ctx.db.query("paperSubmissions").withIndex("by_library_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", itemKey)).paginate({ cursor, numItems: SENDERS_PER_PAPER });

const wordValidator = v.object({ status: submissionStatusValidator, note: v.optional(v.string()), generation: v.number(), at: v.number(), senderId: v.optional(v.id("users")), requestId: v.optional(v.string()) });
type Word = Infer<typeof wordValidator>;

/** Applies the community's word to these submissions, leaving any that already have a newer one. */
async function applyTo(ctx: MutationCtx, rows: Doc<"paperSubmissions">[], { status, note, generation, at, senderId, requestId }: Word) {
  for (const row of rows) {
    if ((row.generation ?? 0) >= generation) continue;
    // Taken back by the person who sent it, it's listed as withdrawn, and keeps its generation. Their row takes the
    // request this word is about, so that request, still finishing here, leaves the word as it is.
    const sentNow = requestId && row.userId === senderId ? { requestId } : {};
    await ctx.db.patch("paperSubmissions", row._id, { status, note, generation, updatedAt: at, ...sentNow });
    await tellSender(ctx, row, status, generation);
  }
}

/** The community's word for everyone who sent a paper, applied a page at a time past the first. */
export const applyToSenders = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), itemKey: v.string(), cursor: v.string(), word: wordValidator },
  returns: v.null(),
  handler: async (ctx, { libraryId, itemKey, cursor, word }) => {
    const page = await sendersPage(ctx, libraryId, itemKey, cursor);
    await applyTo(ctx, page.page, word);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.submissions.applyToSenders, { libraryId, itemKey, cursor: page.continueCursor, word });
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
  /** The paper's page on Openscholar, or its DOI's address for one OpenAlex doesn't have. */
  paperLink: v.string(),
  /** Its record on the community, once it's published there. */
  recordLink: v.union(v.string(), v.null()),
  community: v.object({
    libraryId: v.id("evidenceLibraries"),
    name: v.string(),
    faviconUrl: v.union(v.string(), v.null()),
    /** Where it answers, while it runs. */
    address: v.union(v.string(), v.null()),
    /** Who it belongs to, as its icon's corner shows them. */
    owner: submissionOwnerValidator,
  }),
});

/** A community as a submission names it: its directory card's name and icon, where it answers, and who it belongs to. */
export async function communityOf(ctx: QueryCtx, libraryId: Id<"evidenceLibraries">) {
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
    ? { name: shown.name ?? "", kind: "organization" as const, imageUrl: shown.imageUrl ?? null, workspaceId: owner.workspace._id, colour: owner.organization.colour ?? null }
    : { name: person, kind: "person" as const, imageUrl: shown.imageUrl ?? null, workspaceId: owner.workspace._id, colour: null };
}

const rowOf = async (ctx: QueryCtx, row: Doc<"paperSubmissions">, person: Doc<"users">) => {
  const community = await communityOf(ctx, row.libraryId);
  return {
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
    paperLink: paperHref(row),
    recordLink: row.status === "published" && community.address ? recordHref(community.address, row.itemKey) : null,
    community,
  };
};

/** The signed-in person, while their account is active. */
async function senderOf(ctx: QueryCtx) {
  const identity = await getIdentity(ctx);
  const person = identity ? await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject)).unique() : null;
  return person?.state === "active" ? person : null;
}

/** A page of the papers the person sent to communities, newest first, of one status or all; searched by title and community, best match first. */
export async function readSent(ctx: QueryCtx, person: Doc<"users">, { paginationOpts, status, search }: { paginationOpts: PaginationOptions; status?: Infer<typeof submissionStatusValidator>; search?: string }) {
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
  return { ...page, page: await Promise.all(page.page.map((row) => rowOf(ctx, row, person))) };
}

export const sentPapersPageValidator = paginationResultValidator(submissionValidator);

/** The signed-in person's sent papers, for Your submissions. */
export const mine = query({
  args: { paginationOpts: paginationOptsValidator, status: v.optional(submissionStatusValidator), search: v.optional(v.string()) },
  returns: sentPapersPageValidator,
  handler: async (ctx, args) => {
    const person = await senderOf(ctx);
    return person ? await readSent(ctx, person, args) : { page: [], isDone: true, continueCursor: "" };
  },
});

/** How many papers the signed-in person has of each status, up to SUBMISSIONS_COUNTED each, for the status filter. */
export const counts = query({
  args: {},
  returns: v.object({ queued: v.number(), published: v.number(), returned: v.number(), withdrawn: v.number(), removed: v.number(), all: v.number(), capped: v.boolean() }),
  handler: async (ctx) => {
    const person = await senderOf(ctx);
    const count = async (status: Infer<typeof submissionStatusValidator>) =>
      person ? (await ctx.db.query("paperSubmissions").withIndex("by_user_and_status_and_sentAt", (q) => q.eq("userId", person._id).eq("status", status)).take(SUBMISSIONS_COUNTED + 1)).length : 0;
    const read = await Promise.all([count("queued"), count("published"), count("returned"), count("withdrawn"), count("removed")]);
    // Past the cap, a count is at least it: `capped` says so, and the filter shows it with a plus.
    const [queued, published, returned, withdrawn, removed] = read.map((n) => Math.min(n, SUBMISSIONS_COUNTED));
    return { queued: queued!, published: published!, returned: returned!, withdrawn: withdrawn!, removed: removed!, all: queued! + published! + returned! + withdrawn! + removed!, capped: read.some((n) => n > SUBMISSIONS_COUNTED) };
  },
});

/** Submissions a community's rename refreshes per run; it schedules itself for the rest. */
const RENAME_STEP = 200;

/** Puts a community's new name in the search text of every submission to it, a step at a time. */
export const refreshCommunityName = internalMutation({
  args: { libraryId: v.id("evidenceLibraries"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { libraryId, cursor }) => {
    const community = (await communityOf(ctx, libraryId)).name;
    const page = await ctx.db.query("paperSubmissions").withIndex("by_library_and_itemKey", (q) => q.eq("libraryId", libraryId)).paginate({ cursor, numItems: RENAME_STEP });
    for (const row of page.page) await ctx.db.patch("paperSubmissions", row._id, { searchText: searchTextOf(row.title, community) });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.evidenceLibraries.submissions.refreshCommunityName, { libraryId, cursor: page.continueCursor });
    return null;
  },
});

/** The communities the signed-in person sent papers to lately, most recent first, for the top of Add to community. */
export const recentCommunities = query({
  args: {},
  returns: recentCommunitiesValidator,
  handler: async (ctx) => {
    const person = await senderOf(ctx);
    if (!person) return [];
    const rows = await ctx.db.query("paperSubmissions").withIndex("by_user_and_sentAt", (q) => q.eq("userId", person._id)).order("desc").take(RECENT_SUBMISSIONS_READ);
    const ids = [...new Set(rows.map((row) => row.libraryId))].slice(0, RECENT_COMMUNITIES);
    const recent: Infer<typeof recentCommunitiesValidator> = [];
    for (const libraryId of ids) {
      const library = await ctx.db.get("evidenceLibraries", libraryId);
      if (!library || library.state !== "active") continue;
      const community = await communityOf(ctx, libraryId);
      const role = (await readLibraryRole(ctx, library, person.clerkId)) ?? ("viewer" as const);
      recent.push({ ...community, role, workspaceId: library.workspaceId, card: cardFacts(library) });
    }
    return recent;
  },
});

/**
 * Where one paper stands in each community the signed-in person sent it to, found the way it was sent: by its OpenAlex
 * work, or by its DOI (lower case, without its address) when it has none, such as an Openscholar Report.
 */
export const sentTo = query({
  args: { openalexId: v.optional(v.string()), doi: v.optional(v.string()) },
  returns: sentToValidator,
  handler: async (ctx, { openalexId, doi }) => {
    const person = await senderOf(ctx);
    if (!person) return [];
    const submissions = ctx.db.query("paperSubmissions");
    const rows = openalexId
      ? await submissions.withIndex("by_user_and_openalexId", (q) => q.eq("userId", person._id).eq("openalexId", openalexId)).take(PAPER_SENT_TO)
      : doi
        ? await submissions.withIndex("by_user_and_doi", (q) => q.eq("userId", person._id).eq("doi", doi)).take(PAPER_SENT_TO)
        : [];
    return rows.map((row) => ({ libraryId: row.libraryId, status: row.status }));
  },
});

/** Submissions an account's deletion removes per run. */
const PURGE_SUBMISSIONS = 200;

/** Removes a deleted account's submissions a batch at a time; true once none are left. */
export async function purgeSubmissions(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("paperSubmissions").withIndex("by_user_and_sentAt", (q) => q.eq("userId", userId)).take(PURGE_SUBMISSIONS);
  for (const row of rows) await ctx.db.delete("paperSubmissions", row._id);
  return rows.length < PURGE_SUBMISSIONS;
}

/**
 * The title of a paper sent to a community, by the community's ID and its record's key, as a submission of it knows it:
 * the person's own, or anyone's when they can see the community, so a stranger learns nothing of what waits in a private one.
 * For an approval to name the paper it acts on rather than its key.
 */
export async function sentTitle(ctx: Pick<QueryCtx, "db">, person: Doc<"users">, workspaceId: Id<"workspaces"> | null, library: string, itemKey: string) {
  const libraryId = ctx.db.normalizeId("evidenceLibraries", library);
  if (!libraryId) return null;
  const sent = await ctx.db.query("paperSubmissions").withIndex("by_library_and_itemKey", (q) => q.eq("libraryId", libraryId).eq("itemKey", itemKey)).take(10);
  const own = sent.find((row) => row.userId === person._id);
  if (own) return own.title;
  const community = sent.length ? await ctx.db.get("evidenceLibraries", libraryId) : null;
  return community && (community.workspaceId === workspaceId || (await readLibraryViewRole(ctx, community, person.clerkId)) !== null) ? (sent[0]?.title ?? null) : null;
}
