/**
 * Applying to join a community (OS-31). Anyone signed in applies to a public community that takes applications, with a
 * message; its owners and editors accept them as a Creator or decline them with a reason, and both sides get an email.
 * One row a person and community (`libraryApplications`), replaced when they apply again, so a decline's wait outlives it.
 */
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { countOf, personWaitingApplicationsOf, waitingApplicationsOf } from "../lib/listCounts";
import { APPLICATION_COOL_OFF_DAYS, MAX_APPLICATION_MESSAGE, MAX_WAITING_APPLICATIONS_PER_COMMUNITY, MAX_WAITING_APPLICATIONS_PER_PERSON } from "../lib/queryBounds";
import { rateLimit } from "../lib/rateLimit";
import { internalQuery } from "../lib/functions";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery, type Acting } from "../lib/userActions";
import { libraryGrant, libraryOwner, ownerActive, ownerName, readLibraryRole } from "./access";
import { assertLibraryHasRoom, assertPersonHasRoom } from "./members";
import { waitingFor } from "../sharing/access";
import { libraryEmailSender } from "./invitations";
import { readLibraryPeople } from "./queries";
import { applicationStateValidator, reasonPresetValidator } from "./validators";

const DAY = 86_400_000;
/** Communities one call of `standing` or `waitingCounts` asks about: a page of the directory or of the sidebar. */
const ASKED_AT_ONCE = 100;

async function personOf(ctx: QueryCtx, actor: Pick<Acting, "userId">) {
  const person = await ctx.db.get("users", actor.userId);
  if (!person || person.state !== "active") throw createError("UNAUTHENTICATED", "Sign in to apply");
  return person;
}

/** The community, when it's live, public and its owner active: the only kind anyone applies to. */
async function openCommunity(ctx: QueryCtx, libraryId: Id<"evidenceLibraries">) {
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library || library.state !== "active" || library.unlisted || !ownerActive(await libraryOwner(ctx, library))) {
    throw createError("NOT_FOUND", "This community isn't open to applications.");
  }
  return library;
}

/** Refuses anyone but the community's owners and editors, who answer its applications. */
async function requireReviewer(ctx: QueryCtx, library: Doc<"evidenceLibraries">, person: Doc<"users">) {
  const role = await readLibraryRole(ctx, library, person.clerkId);
  if (role !== "owner" && role !== "editor") throw createError("FORBIDDEN", "Only the community's owners and editors answer applications.");
}

const applicationOf = (ctx: QueryCtx, userId: Id<"users">, libraryId: Id<"evidenceLibraries">) =>
  ctx.db.query("libraryApplications").withIndex("by_userId_and_libraryId", (q) => q.eq("userId", userId).eq("libraryId", libraryId)).unique();

/**
 * When a declined person may apply to the same community again: 14 days on, or at once when the team asked them to
 * say more about their work, which they then do by applying again.
 */
const appliesAgainAt = (application: Doc<"libraryApplications">) =>
  (application.decidedAt ?? application.createdAt) + (application.reasonPreset === "moreAbout" ? 0 : APPLICATION_COOL_OFF_DAYS * DAY);

/** A message or reason as kept: trimmed, and within MAX_APPLICATION_MESSAGE. */
function text(value: string, what: "message" | "reason") {
  const trimmed = value.trim();
  if (trimmed.length > MAX_APPLICATION_MESSAGE) throw createError("VALIDATION_ERROR", `Keep the ${what} to ${MAX_APPLICATION_MESSAGE} characters.`);
  return trimmed;
}

/** What the person's own application looks like to them: the community, and where it stands. */
const myApplicationValidator = v.object({
  applicationId: v.id("libraryApplications"),
  libraryId: v.id("evidenceLibraries"),
  name: v.string(),
  faviconUrl: v.union(v.string(), v.null()),
  address: v.string(),
  owner: v.object({ name: v.string(), imageUrl: v.union(v.string(), v.null()), kind: v.union(v.literal("person"), v.literal("organization")), workspaceId: v.id("workspaces") }),
  state: applicationStateValidator,
  message: v.string(),
  createdAt: v.number(),
  decidedAt: v.union(v.number(), v.null()),
  reason: v.union(v.string(), v.null()),
  reasonPreset: v.union(reasonPresetValidator, v.null()),
  appliesAgainAt: v.union(v.number(), v.null()),
});

async function asMine(ctx: QueryCtx, application: Doc<"libraryApplications">) {
  const library = await ctx.db.get("evidenceLibraries", application.libraryId);
  const owner = library ? await libraryOwner(ctx, library) : null;
  if (!library || !owner || library.state !== "active") return null;
  const binding = library.runtimeBindingId ? await ctx.db.get("evidenceLibraryRuntimeBindings", library.runtimeBindingId) : null;
  const shown = await ownerName(ctx, owner);
  return {
    applicationId: application._id,
    libraryId: library._id,
    name: library.card?.name ?? library.name,
    faviconUrl: library.card?.faviconUrl ?? null,
    address: binding?.canonicalBaseUrl ?? binding?.targetBaseUrl ?? "",
    owner: { name: shown.name, imageUrl: shown.imageUrl, kind: owner.organization ? "organization" as const : "person" as const, workspaceId: owner.workspace._id },
    state: application.state,
    message: application.message,
    createdAt: application.createdAt,
    decidedAt: application.decidedAt ?? null,
    reason: application.reason ?? null,
    reasonPreset: application.reasonPreset ?? null,
    appliesAgainAt: application.state === "declined" ? appliesAgainAt(application) : null,
  };
}

export const applyAction = defineUserMutation({
  path: "evidenceLibraries/applications:apply",
  description:
    "Applies to join a public Evidence Community as a Creator, with a message to its owners and editors (who see the person's name, email and the message), for someone who isn't in it yet. " +
    "They get an email, and answer it. One application waits per community; after a decline, the person can apply again 14 days later. Asks the person first.",
  args: { libraryId: v.id("evidenceLibraries"), message: v.string() },
  returns: v.id("libraryApplications"),
  spendsCredits: false,
  // Its owners and editors are emailed.
  outsideEffect: true,
  undoable: false,
  asksFirst: async () => true,
  run: async (ctx, actor, args) => {
    const person = await personOf(ctx, actor);
    const library = await openCommunity(ctx, args.libraryId);
    if (library.applicationsClosed) throw createError("CONFLICT", "This community isn't taking applications right now.");
    if (await readLibraryRole(ctx, library, person.clerkId)) throw createError("CONFLICT", "You're already in this community.");
    const message = text(args.message, "message");
    if (!message) throw createError("VALIDATION_ERROR", "Write a few words for the team.");
    const existing = await applicationOf(ctx, person._id, library._id);
    // A second press, or a second tab, sends nothing more.
    if (existing?.state === "waiting") return existing._id;
    if (existing?.state === "declined" && appliesAgainAt(existing) > Date.now()) {
      throw createError("CONFLICT", `You can apply to this community again from ${new Date(appliesAgainAt(existing)).toISOString().slice(0, 10)}.`);
    }
    if ((await countOf(ctx, personWaitingApplicationsOf(person._id))) >= MAX_WAITING_APPLICATIONS_PER_PERSON) {
      throw createError("VALIDATION_ERROR", `You have ${MAX_WAITING_APPLICATIONS_PER_PERSON} applications waiting. Withdraw one, or wait for an answer, to send another.`);
    }
    if ((await countOf(ctx, waitingApplicationsOf(library._id))) >= MAX_WAITING_APPLICATIONS_PER_COMMUNITY) {
      throw createError("VALIDATION_ERROR", "This community has too many applications waiting. Try again later.");
    }
    await rateLimit(ctx, { name: "community-application", key: person._id, throws: true });
    const values = { libraryId: library._id, userId: person._id, message, state: "waiting" as const, listed: true, createdAt: Date.now() };
    const applicationId = existing?._id ?? (await ctx.db.insert("libraryApplications", values));
    if (existing) await ctx.db.replace("libraryApplications", existing._id, values);
    await ctx.scheduler.runAfter(0, internal.evidenceLibraries.applicationEmails.toReviewers, { applicationId });
    return applicationId;
  },
});
export const apply = userMutation(applyAction);
export const applyForAssistant = assistantMutation(applyAction);

export const withdrawAction = defineUserMutation({
  path: "evidenceLibraries/applications:withdraw",
  description: "Withdraws the person's application to join an Evidence Community while it still waits for an answer. They can apply again at once.",
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { libraryId }) => {
    const person = await personOf(ctx, actor);
    const application = await applicationOf(ctx, person._id, libraryId);
    // Withdrawn already, or answered meanwhile: nothing waits to take back.
    if (application?.state === "waiting") await ctx.db.delete("libraryApplications", application._id);
    return null;
  },
});
export const withdraw = userMutation(withdrawAction);
export const withdrawForAssistant = assistantMutation(withdrawAction);

export const hideAction = defineUserMutation({
  path: "evidenceLibraries/applications:hide",
  description: "Takes a declined application off the person's Communities sidebar. The wait before they can apply to that community again still holds.",
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { libraryId }) => {
    const person = await personOf(ctx, actor);
    const application = await applicationOf(ctx, person._id, libraryId);
    if (application?.state === "declined" && application.listed) await ctx.db.patch("libraryApplications", application._id, { listed: false });
    return null;
  },
});
export const hide = userMutation(hideAction);
export const hideForAssistant = assistantMutation(hideAction);

export const mineAction = defineUserQuery({
  path: "evidenceLibraries/applications:mine",
  description:
    "Lists the person's applications to join Evidence Communities, a page at a time, newest first: `waiting` ones, waiting for an answer (at most 20), or `declined` ones, with the reason and when they can apply again, until they hide them. " +
    "An accepted one isn't here: the community is among theirs, with the Creator role.",
  args: { state: v.union(v.literal("waiting"), v.literal("declined")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(myApplicationValidator),
  run: async (ctx, actor, { state, paginationOpts }) => {
    const page = state === "waiting"
      ? await ctx.db.query("libraryApplications").withIndex("by_userId_and_state", (q) => q.eq("userId", actor.userId).eq("state", "waiting")).order("desc").paginate(paginationOpts)
      : await ctx.db.query("libraryApplications")
        .withIndex("by_userId_and_listed_and_createdAt", (q) => q.eq("userId", actor.userId).eq("listed", true))
        .order("desc")
        .filter((q) => q.eq(q.field("state"), "declined"))
        .paginate(paginationOpts);
    return { ...page, page: (await Promise.all(page.page.map((row) => asMine(ctx, row)))).flatMap((row) => (row ? [row] : [])) };
  },
});
export const mine = userQuery(mineAction, { signedOut: { page: [], isDone: true, continueCursor: "" } });
export const mineForAssistant = assistantQuery(mineAction);

/** Where the person stands with each of a page of communities: in it already, or their application and its state. */
const standingValidator = v.object({
  libraryId: v.id("evidenceLibraries"),
  member: v.boolean(),
  application: v.union(v.null(), v.object({
    state: applicationStateValidator,
    message: v.string(),
    createdAt: v.number(),
    decidedAt: v.union(v.number(), v.null()),
    reason: v.union(v.string(), v.null()),
    reasonPreset: v.union(reasonPresetValidator, v.null()),
    appliesAgainAt: v.union(v.number(), v.null()),
    /** Taken off the sidebar by the person: a declined one whose wait still holds. */
    hidden: v.boolean(),
  })),
});

export const standingAction = defineUserQuery({
  path: "evidenceLibraries/applications:standing",
  description: `Says, for up to ${ASKED_AT_ONCE} Evidence Communities by ID, whether the person is in each already, and their application to it and where it stands, if they made one.`,
  args: { libraryIds: v.array(v.id("evidenceLibraries")) },
  returns: paginationResultValidator(standingValidator),
  run: async (ctx, actor, { libraryIds }) => {
    if (libraryIds.length > ASKED_AT_ONCE) throw createError("VALIDATION_ERROR", `Ask about at most ${ASKED_AT_ONCE} communities at once.`);
    const person = await personOf(ctx, actor);
    const page = await Promise.all(libraryIds.map(async (libraryId) => {
      const library = await ctx.db.get("evidenceLibraries", libraryId);
      const application = await applicationOf(ctx, person._id, libraryId);
      return {
        libraryId,
        member: library ? (await readLibraryRole(ctx, library, person.clerkId)) !== null : false,
        application: application ? {
          state: application.state,
          message: application.message,
          createdAt: application.createdAt,
          decidedAt: application.decidedAt ?? null,
          reason: application.reason ?? null,
          reasonPreset: application.reasonPreset ?? null,
          appliesAgainAt: application.state === "declined" ? appliesAgainAt(application) : null,
          hidden: !application.listed && application.state === "declined",
        } : null,
      };
    }));
    return { page, isDone: true, continueCursor: "" };
  },
});
export const standing = userQuery(standingAction, { signedOut: { page: [], isDone: true, continueCursor: "" } });
export const standingForAssistant = assistantQuery(standingAction);

/** An application as its community's owners and editors see it: who sent it, and what they wrote. */
const reviewedValidator = v.object({
  applicationId: v.id("libraryApplications"),
  name: v.string(),
  email: v.string(),
  imageUrl: v.union(v.string(), v.null()),
  message: v.string(),
  createdAt: v.number(),
});

export const waitingAction = defineUserQuery({
  path: "evidenceLibraries/applications:waiting",
  description:
    "Lists the applications to join an Evidence Community waiting for an answer, oldest first, a page at a time, for its owners and editors: who applied, their email and their message. " +
    "Answer one with evidenceLibraries/applications:accept or evidenceLibraries/applications:decline.",
  args: { libraryId: v.id("evidenceLibraries"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(reviewedValidator),
  run: async (ctx, actor, { libraryId, paginationOpts }) => {
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library) throw createError("NOT_FOUND", "Evidence Community not found");
    await requireReviewer(ctx, library, await personOf(ctx, actor));
    const page = await ctx.db.query("libraryApplications")
      .withIndex("by_libraryId_and_state_and_createdAt", (q) => q.eq("libraryId", libraryId).eq("state", "waiting"))
      .paginate(paginationOpts);
    return {
      ...page,
      page: (await Promise.all(page.page.map(async (row) => {
        const user = await ctx.db.get("users", row.userId);
        if (!user) return [];
        const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
        return [{ applicationId: row._id, name: name || user.email, email: user.email, imageUrl: user.avatarUrl ?? null, message: row.message, createdAt: row.createdAt }];
      }))).flat(),
    };
  },
});
export const waiting = userQuery(waitingAction);
export const waitingForAssistant = assistantQuery(waitingAction);

export const waitingCountsAction = defineUserQuery({
  path: "evidenceLibraries/applications:waitingCounts",
  description: `Counts the applications waiting for an answer in each of up to ${ASKED_AT_ONCE} Evidence Communities by ID, for those where the person is an owner or editor; the rest are left out.`,
  args: { libraryIds: v.array(v.id("evidenceLibraries")) },
  returns: paginationResultValidator(v.object({ libraryId: v.id("evidenceLibraries"), waiting: v.number() })),
  run: async (ctx, actor, { libraryIds }) => {
    if (libraryIds.length > ASKED_AT_ONCE) throw createError("VALIDATION_ERROR", `Ask about at most ${ASKED_AT_ONCE} communities at once.`);
    const person = await personOf(ctx, actor);
    const page = await Promise.all(libraryIds.map(async (libraryId) => {
      const library = await ctx.db.get("evidenceLibraries", libraryId);
      const role = library ? await readLibraryRole(ctx, library, person.clerkId) : null;
      if (role !== "owner" && role !== "editor") return [];
      return [{ libraryId, waiting: await countOf(ctx, waitingApplicationsOf(libraryId)) }];
    }));
    return { page: page.flat(), isDone: true, continueCursor: "" };
  },
});
export const waitingCounts = userQuery(waitingCountsAction, { signedOut: { page: [], isDone: true, continueCursor: "" } });
export const waitingCountsForAssistant = assistantQuery(waitingCountsAction);

/** The waiting application, and the reviewer answering it. */
async function toAnswer(ctx: MutationCtx, actor: Pick<Acting, "userId">, applicationId: Id<"libraryApplications">) {
  const application = await ctx.db.get("libraryApplications", applicationId);
  const library = application ? await ctx.db.get("evidenceLibraries", application.libraryId) : null;
  if (!application || !library) throw createError("NOT_FOUND", "Application not found");
  const reviewer = await personOf(ctx, actor);
  await requireReviewer(ctx, library, reviewer);
  return { application, library, reviewer };
}

export const acceptAction = defineUserMutation({
  path: "evidenceLibraries/applications:accept",
  description: "Accepts an application to join an Evidence Community, for its owners and editors: the person becomes a Creator, and gets an email saying so. Asks the person first.",
  args: { applicationId: v.id("libraryApplications") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  asksFirst: async () => true,
  run: async (ctx, actor, { applicationId }) => {
    const { application, library, reviewer } = await toAnswer(ctx, actor, applicationId);
    // Accepted already, as a second press or another editor did: nothing more.
    if (application.state === "accepted") return null;
    if (application.state !== "waiting") throw createError("CONFLICT", "This application was answered already.");
    // A role given since they applied stays as it is.
    if (!(await libraryGrant(ctx, library._id, application.userId))) {
      const applicant = await ctx.db.get("users", application.userId);
      if (!applicant) throw createError("NOT_FOUND", "This person's account is gone.");
      // An invitation still waiting for them holds their place already: it's taken, as accepting it would. One for an
      // organization of theirs stays, for them to accept for the organization they pick.
      const waiting = await waitingFor(ctx, library._id, applicant);
      const invited = waiting && !waiting.toOrganization ? waiting : null;
      if (!invited) await assertLibraryHasRoom(ctx, library._id);
      await assertPersonHasRoom(ctx, application.userId);
      await ctx.db.insert("itemAccess", { kind: "library", item: library._id, name: library.name, userId: application.userId, role: "creator", grantedBy: reviewer._id, grantedAt: Date.now() });
      if (invited) await ctx.db.patch("itemInvitations", invited._id, { state: "accepted" });
    }
    await ctx.db.patch("libraryApplications", application._id, { state: "accepted", listed: false, decidedAt: Date.now(), decidedBy: reviewer._id });
    await ctx.scheduler.runAfter(0, internal.evidenceLibraries.applicationEmails.toApplicant, { applicationId });
    return null;
  },
});
export const accept = userMutation(acceptAction);
export const acceptForAssistant = assistantMutation(acceptAction);

export const declineAction = defineUserMutation({
  path: "evidenceLibraries/applications:decline",
  description:
    "Declines an application to join an Evidence Community, for its owners and editors, with an optional ready-made reason (`preset`: topic, outside the community's topic; moreAbout, tell us more about your work; notNow, not adding people right now) and an optional written one, which the person reads in their email and on the Communities page. They can apply again 14 days later. Asks the person first.",
  args: { applicationId: v.id("libraryApplications"), preset: v.optional(reasonPresetValidator), reason: v.optional(v.string()) },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: true,
  undoable: false,
  asksFirst: async () => true,
  run: async (ctx, actor, { applicationId, preset, reason }) => {
    const { application, reviewer } = await toAnswer(ctx, actor, applicationId);
    if (application.state === "declined") return null;
    if (application.state !== "waiting") throw createError("CONFLICT", "This application was answered already.");
    const why = reason === undefined ? "" : text(reason, "reason");
    await ctx.db.patch("libraryApplications", application._id, { state: "declined", listed: true, decidedAt: Date.now(), decidedBy: reviewer._id, ...(preset ? { reasonPreset: preset } : {}), ...(why ? { reason: why } : {}) });
    await ctx.scheduler.runAfter(0, internal.evidenceLibraries.applicationEmails.toApplicant, { applicationId });
    return null;
  },
});
export const decline = userMutation(declineAction);
export const declineForAssistant = assistantMutation(declineAction);

export const setOpenAction = defineUserMutation({
  path: "evidenceLibraries/applications:setOpen",
  description: "Turns applications to join an Evidence Community on or off, for an owner. Only a public community takes them; one turned off keeps the applications already waiting.",
  args: { libraryId: v.id("evidenceLibraries"), open: v.boolean() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { libraryId, open }) => {
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library || (await readLibraryRole(ctx, library, (await personOf(ctx, actor)).clerkId)) !== "owner") {
      throw createError("FORBIDDEN", "Only an owner of the community turns applications on or off.");
    }
    await ctx.db.patch("evidenceLibraries", libraryId, { applicationsClosed: open ? undefined : true });
    return null;
  },
});
export const setOpen = userMutation(setOpenAction);
export const setOpenForAssistant = assistantMutation(setOpenAction);

/** What the emails about an application say, and who they go to (./applicationEmails.ts). */
export const readForEmail = internalQuery({
  args: { applicationId: v.id("libraryApplications") },
  handler: async (ctx, { applicationId }) => {
    const application = await ctx.db.get("libraryApplications", applicationId);
    const library = application ? await ctx.db.get("evidenceLibraries", application.libraryId) : null;
    const applicant = application ? await ctx.db.get("users", application.userId) : null;
    if (!application || !library || !applicant) return null;
    // Its owners and editors, those through an organization it's shared with too: everyone who answers.
    const reviewers = (await readLibraryPeople(ctx, library, { organizations: true }))
      .filter(({ role, person }) => (role === "owner" || role === "editor") && person.email && person.clerkUserId !== applicant.clerkId)
      .map(({ person }) => person.email);
    return {
      libraryId: library._id,
      libraryName: library.card?.name ?? library.name,
      applicant: { name: [applicant.firstName, applicant.lastName].filter(Boolean).join(" ").trim() || applicant.email, email: applicant.email },
      message: application.message,
      state: application.state,
      reason: application.reason ?? null,
      reasonPreset: application.reasonPreset ?? null,
      appliesAgainAt: appliesAgainAt(application),
      reviewers,
      ...(await libraryEmailSender(ctx, library)),
    };
  },
});

/** Applications one step of an account's purge deletes; the rest go on the next run. */
const PURGE_APPLICATIONS = 100;

/** Deletes a deleted account's applications, so the waiting ones stop holding places in their communities' counts. True once none are left. */
export async function purgeApplications(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("libraryApplications").withIndex("by_userId_and_libraryId", (q) => q.eq("userId", userId)).take(PURGE_APPLICATIONS);
  for (const row of rows) await ctx.db.delete("libraryApplications", row._id);
  return rows.length < PURGE_APPLICATIONS;
}
