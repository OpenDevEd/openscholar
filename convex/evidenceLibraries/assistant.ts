/**
 * An Evidence Library's draft as the assistant works it (#329): the workspace's libraries, a
 * library's draft settings and a revision of them, its team, and saving sections of the draft.
 * Each runs the configuration page's own reads and save as the person the assistant acts for
 * (`asSignedIn`), so the page's rules hold whole: only an owner whose plan has Evidence
 * Libraries changes a draft, and every section is checked as the page checks it. A draft isn't
 * public until it's put live, which stays on the library's page.
 */
import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalQuery } from "../lib/functions";
import { createError } from "../lib/errors";
import { asSignedIn, assistantAction, assistantMutation, assistantQuery, defineUserAction, defineUserMutation, defineUserQuery, userAction, userMutation, userQuery } from "../lib/userActions";
import { STEP_TEXT_MAX } from "../../lib/assistant/steps";
import { evidenceLibraryUploadPrefix } from "../../lib/evidence-libraries/configuration/uploads";
import { libraryGrant, libraryOf, readEvidenceLibraryAccess } from "./access";
import { MAX_LIBRARIES_PER_WORKSPACE, MAX_LIBRARY_GRANTS_PER_PERSON } from "../lib/queryBounds";
import { inOwnWorkspace, type InWorkspace } from "../workspaces/actor";
import { addLibraryMember, changeLibraryRole, removeLibraryMember } from "./team";
import { changeLibraryInvitation } from "./invitations";
import { readSourceStatus } from "./sourceStatus";
import { sourceStatusReadValidator } from "./sourceStatusValidators";
import { readPendingLibraryInvitations } from "./access";
import { notSetUpValidator, reviewedPublicationValidator, runtimeCollectionValidator, runtimeInstitutionValidator, runtimePage } from "../zotero/runtimeReadValidators";
import { RUNTIME_READ_PAGE_SIZE } from "../zotero/runtimeReadClient";
import { memberIdWithEmail } from "../organizations/read";
import { saveEvidenceLibraryDraftSections } from "./mutations";
import { libraryTeamValidator, readEvidenceLibraryDraft, readEvidenceLibraryRevision, readLibraryTeam, revisionReadValidator } from "./queries";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { addressReservationValidator, assistantDraftValidator, assistantEditResultValidator, assistantLibrariesValidator, pendingInvitationsValidator, DRAFT_CHANGES_MAX, DRAFT_PATH_DEPTH, draftChangesValidator, draftPathValidator, LIBRARIES_LISTED } from "./validators";

const EDIT_PATH = "evidenceLibraries/assistant:editDraft" as const;
type Change = Infer<typeof draftChangesValidator>[number];
type Path = Change["path"];

/** The person an action acts for, as their account holds them. */
async function personOf(ctx: QueryCtx, userId: Id<"users">) {
  const person = await ctx.db.get("users", userId);
  if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
  return person;
}

/**
 * `ctx` signed in as the person, for a library the reply may reach: one of the workspace it runs
 * in or, in the person's own workspace, one shared with them, as what's shared with someone is
 * opened there and nowhere else. Any other is not found, so a chat never carries another
 * workspace's library to the people who read it.
 */
async function signedInFor<Ctx extends QueryCtx>(ctx: Ctx, actor: InWorkspace, libraryId: Id<"evidenceLibraries">): Promise<Ctx> {
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  const here = library !== null && (library.workspaceId === actor.workspaceId || ((await inOwnWorkspace(ctx, actor)) && (await libraryGrant(ctx, libraryId, actor.userId)) !== null));
  if (!here) throw createError("NOT_FOUND", "Evidence Library not found");
  return await asSignedIn(ctx, await personOf(ctx, actor.userId));
}

export const librariesAction = defineUserQuery({
  path: "evidenceLibraries/assistant:libraries",
  description:
    `Lists the Evidence Libraries the person can see here, ${LIBRARIES_LISTED} a page from \`start\` (0 first): the workspace's, and in their own workspace the ones shared with them. Each one's ID, name, address name, state, and whether they can change its settings; \`next\` is where the next \`start\` is, when there are more. ` +
    "A library's settings are evidenceLibraries/assistant:draft; putting a draft live is done on the library's page.",
  args: { start: v.optional(v.union(v.number(), v.null())) },
  returns: assistantLibrariesValidator,
  run: async (ctx, actor, { start }) => {
    const signedIn = await asSignedIn(ctx, await personOf(ctx, actor.userId));
    // Both lists are kept small by what makes them: a workspace's libraries and a person's roles in them.
    const own = await ctx.db.query("evidenceLibraries").withIndex("by_workspace", (q) => q.eq("workspaceId", actor.workspaceId)).take(MAX_LIBRARIES_PER_WORKSPACE);
    const grants = (await inOwnWorkspace(ctx, actor))
      ? await ctx.db.query("itemAccess").withIndex("by_user_and_kind_and_grantedAt", (q) => q.eq("userId", actor.userId).eq("kind", "library")).take(MAX_LIBRARY_GRANTS_PER_PERSON)
      : [];
    const all = [...own.map((library) => ({ library })), ...grants.map((grant) => ({ grant }))];
    const from = Math.max(0, Math.floor(start ?? 0));
    const slice = all.slice(from, from + LIBRARIES_LISTED);
    const libraries: Infer<typeof assistantLibrariesValidator>["libraries"] = [];
    for (const entry of slice) {
      const library = "library" in entry ? entry.library : await libraryOf(ctx, entry.grant);
      // One shared with them that's also the workspace's is listed once, as the workspace's.
      if (!library || ("grant" in entry && library.workspaceId === actor.workspaceId)) continue;
      if (!(await readEvidenceLibraryAccess(signedIn, library._id, "view"))) continue;
      const editable = (await readEvidenceLibraryAccess(signedIn, library._id, "manage")) !== null;
      libraries.push({ libraryId: library._id, name: library.name, slug: library.slug, state: library.state, editable });
    }
    return { libraries, ...(all.length > from + slice.length ? { next: from + slice.length } : {}) };
  },
});
export const libraries = userQuery(librariesAction);
export const librariesForAssistant = assistantQuery(librariesAction);

export const draftAction = defineUserQuery({
  path: "evidenceLibraries/assistant:draft",
  description:
    "Reads an Evidence Library's draft settings, as its configuration page shows them: each section by its key (identity, home, features, ai, sources and the rest) with its settings, its `editVersion`, whether it has changes not yet live, where it answers, and whether the person can change it. " +
    "Give `sections` to read only those, and with one section named, `path` to read only the value there: for a section too long to read whole. Change values with evidenceLibraries/assistant:editDraft.",
  args: { libraryId: v.id("evidenceLibraries"), sections: v.optional(v.union(v.array(v.string()), v.null())), path: v.optional(draftPathValidator) },
  returns: assistantDraftValidator,
  run: async (ctx, actor, { libraryId, sections, path }) => {
    const read = await draftOf(await signedInFor(ctx, actor, libraryId), libraryId);
    const asked = sections?.length ? new Set(sections) : null;
    const shown = read.sections.filter((section) => !asked || asked.has(section.sectionKey));
    if (path?.length && shown.length !== 1) throw createError("VALIDATION_ERROR", "Name the one section to read a path in.");
    return {
      libraryId,
      name: read.library.name,
      state: read.library.state,
      editVersion: read.draft.editVersion,
      editable: read.editable,
      hasUnpublishedChanges: read.hasUnpublishedChanges,
      ...(read.liveAddress ? { liveAddress: read.liveAddress } : {}),
      sections: path?.length ? shown.map((section) => ({ ...section, payload: valueAt(section.payload, path, section.sectionKey) ?? null })) : shown,
    };
  },
});
export const draft = userQuery(draftAction);
export const draftForAssistant = assistantQuery(draftAction);

export const revisionAction = defineUserQuery({
  path: "evidenceLibraries/assistant:revision",
  description: "Reads one revision of an Evidence Library's settings, a version that was put live, with its sections, for an owner. Its draft is evidenceLibraries/assistant:draft.",
  args: { libraryId: v.id("evidenceLibraries"), revisionId: v.id("evidenceLibraryConfigRevisions") },
  returns: revisionReadValidator,
  run: async (ctx, actor, args) => await readEvidenceLibraryRevision(await signedInFor(ctx, actor, args.libraryId), args),
});
export const revision = userQuery(revisionAction);
export const revisionForAssistant = assistantQuery(revisionAction);

export const teamAction = defineUserQuery({
  path: "evidenceLibraries/assistant:team",
  description: "Reads an Evidence Library's team: its owners, editors and creators, and for an owner the invitations still waiting, as the library's team page shows them.",
  args: { libraryId: v.id("evidenceLibraries") },
  returns: libraryTeamValidator,
  run: async (ctx, actor, args) => await readLibraryTeam(await signedInFor(ctx, actor, args.libraryId), args),
});
export const team = userQuery(teamAction);
export const teamForAssistant = assistantQuery(teamAction);

/** A library's draft as the person can read it. */
async function draftOf(ctx: QueryCtx, libraryId: Id<"evidenceLibraries">) {
  const read = await readEvidenceLibraryDraft(ctx, { libraryId });
  if (!read) throw createError("NOT_FOUND", "Evidence Library not found");
  return read;
}

/** Keys that reach an object's prototype rather than its settings. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const copy = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

/** One step of a path: a key of an object, or a place already in a list. */
function stepInto(at: unknown, step: string | number, sectionKey: string): Record<string | number, unknown> {
  const fits = Array.isArray(at) ? typeof step === "number" && Number.isInteger(step) && step >= 0 && step < at.length : isRecord(at) && typeof step === "string" && !UNSAFE_KEYS.has(step);
  if (!fits) throw createError("VALIDATION_ERROR", `The ${sectionKey} section has no ${JSON.stringify(step)} there. Read it with evidenceLibraries/assistant:draft for its shape.`);
  return at as Record<string | number, unknown>;
}

/** The value at a path in a section's settings: undefined when its last key isn't there. */
function valueAt(payload: unknown, path: Path, sectionKey: string): unknown {
  let at = payload;
  for (const step of path) {
    const container = stepInto(at, step, sectionKey);
    at = Object.prototype.hasOwnProperty.call(container, step) ? container[step] : undefined;
  }
  return at;
}

/** Whether a value holds an address of the library's own uploaded files, however deep: a logo, a photo, a document. */
const holdsUpload = (value: unknown, libraryId: Id<"evidenceLibraries">): boolean =>
  typeof value === "string" ? value.includes(evidenceLibraryUploadPrefix(libraryId)) : typeof value === "object" && value !== null && Object.values(value).some((inner) => holdsUpload(inner, libraryId));

/**
 * The draft's sections the changes touch, with the changes made in order, and the changes that
 * put them back in the order to make them: none when one can't be put back, a section the draft
 * hadn't got. The draft's own values are copied, never changed in place.
 */
function changed(libraryId: Id<"evidenceLibraries">, draft: Awaited<ReturnType<typeof draftOf>>, changes: Change[]) {
  if (changes.length === 0 || changes.length > DRAFT_CHANGES_MAX) throw createError("VALIDATION_ERROR", `Make from 1 to ${DRAFT_CHANGES_MAX} changes at a time.`);
  const after = new Map<Change["sectionKey"], unknown>();
  const undo: Change[] = [];
  let lasting = false;
  for (const { sectionKey, path, value } of changes) {
    if (path.length > DRAFT_PATH_DEPTH) throw createError("VALIDATION_ERROR", `A path goes at most ${DRAFT_PATH_DEPTH} steps into a section.`);
    if (!after.has(sectionKey)) after.set(sectionKey, copy(draft.sections.find((section) => section.sectionKey === sectionKey)?.payload));
    const was = valueAt(after.get(sectionKey), path, sectionKey);
    // The library's uploaded files are changed on its page, which also deletes the one a file replaces.
    if (holdsUpload(was, libraryId) || holdsUpload(value, libraryId)) {
      throw createError("VALIDATION_ERROR", `Uploaded files (logos, photos, documents) in the ${sectionKey} section are changed on the library's configuration page. Change the values around them instead.`);
    }
    if (path.length === 0) {
      if (value === undefined) throw createError("VALIDATION_ERROR", "A section stays in the draft. Set its settings instead.");
      lasting ||= was === undefined;
      after.set(sectionKey, copy(value));
    } else {
      const last = path[path.length - 1];
      const parent = stepInto(valueAt(after.get(sectionKey), path.slice(0, -1), sectionKey), last, sectionKey);
      if (value !== undefined) parent[last] = copy(value);
      else if (Array.isArray(parent)) throw createError("VALIDATION_ERROR", "An item is taken out of a list by setting the list whole.");
      else if (was === undefined) throw createError("VALIDATION_ERROR", `The ${sectionKey} section has no ${JSON.stringify(last)} to take out.`);
      else delete parent[last];
    }
    undo.unshift(was === undefined ? { sectionKey, path } : { sectionKey, path, value: copy(was) });
  }
  return { rows: [...after].map(([sectionKey, payload]) => ({ sectionKey, payload })), after, undo: lasting ? null : undo };
}

/** What the places changes touch hold, as a digest: an undo goes ahead only while they hold what its edit left. */
const heldAt = (payloadOf: (sectionKey: Change["sectionKey"]) => unknown, changes: Change[]) =>
  digestOpaqueToken(JSON.stringify(changes.map(({ sectionKey, path }) => {
    const value = valueAt(payloadOf(sectionKey), path, sectionKey);
    // A key that isn't there and one set to null are told apart.
    return value === undefined ? [] : [value];
  })));
/** An undo is kept only when it fits a step; its digest is always this long (SHA-256 in hex). */
const undoFits = (libraryId: Id<"evidenceLibraries">, undo: Change[]) => JSON.stringify({ libraryId, changes: undo, unchanged: "0".repeat(64) }).length <= STEP_TEXT_MAX;

export const editDraftAction = defineUserMutation({
  path: EDIT_PATH,
  description:
    "Changes an Evidence Library's draft settings, for an owner. Each change sets the value at a `path` inside one section (its keys and list places, as evidenceLibraries/assistant:draft shows the section), or with no `value` takes that key out; an empty path sets the section whole, and a list item is added or taken out by setting the list whole. " +
    "The homepage's text is `home.intro`; `identity.tagline` and `identity.description` only feed page titles and search results. " +
    "Give the draft's `expectedEditVersion` from that read (`unchanged` is Undo's own). The result is checked as the configuration page checks it, and a refusal says what's wrong. " +
    "Uploaded files (logos, photos, documents) are changed on the page: a change can't replace a value holding one or write one in. Nothing is public until the draft is put live, on the library's page. Undo puts the values back.",
  args: { libraryId: v.id("evidenceLibraries"), changes: draftChangesValidator, expectedEditVersion: v.optional(v.number()), unchanged: v.optional(v.string()) },
  returns: assistantEditResultValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // An edit that can't be put back, a new section or one too large for an undo, asks first.
  asksFirst: async (ctx, actor, { libraryId, changes }) => {
    const { undo } = changed(libraryId, await draftOf(await signedInFor(ctx, actor, libraryId), libraryId), changes);
    return !undo || !undoFits(libraryId, undo);
  },
  run: async (ctx, actor, { libraryId, changes, expectedEditVersion, unchanged }) => {
    if ((expectedEditVersion === undefined) === (unchanged === undefined)) throw createError("VALIDATION_ERROR", "Give the draft's expectedEditVersion from evidenceLibraries/assistant:draft.");
    const signedIn = await signedInFor(ctx, actor, libraryId);
    const draft = await draftOf(signedIn, libraryId);
    // An undo checks the places it puts back, not the draft's version: other edits undone before it, newest first, moved that on.
    if (unchanged !== undefined) {
      const held = await heldAt((key) => draft.sections.find((section) => section.sectionKey === key)?.payload, changes).catch(() => null);
      if (held !== unchanged) throw createError("CONFLICT", "The library's draft has changed there since, so this can't be undone. Change it on its configuration page.");
    }
    const { rows, after, undo } = changed(libraryId, draft, changes);
    const { editVersion } = await saveEvidenceLibraryDraftSections(signedIn, { libraryId, sections: rows, expectedEditVersion: expectedEditVersion ?? draft.draft.editVersion });
    const kept = undo && undoFits(libraryId, undo) ? { libraryId, changes: undo, unchanged: await heldAt((key) => after.get(key), undo) } : null;
    return { editVersion, ...(kept ? { undo: { path: EDIT_PATH, args: kept } } : {}) };
  },
});
export const editDraft = userMutation(editDraftAction);
export const editDraftForAssistant = assistantMutation(editDraftAction);

const roleValidator = v.union(v.literal("editor"), v.literal("creator"));
/** What a team change is: other people see it, and nothing puts it back by itself, so it's asked about every time. */
const teamChange = { spendsCredits: false, outsideEffect: true, undoable: false } as const;

export const addMemberAction = defineUserMutation({
  path: "evidenceLibraries/assistant:addMember",
  description:
    "Gives a member of the library's organization a role on it, for an owner: editor (changes its records) or creator (adds them), by the email organizations/queries:members lists them with. " +
    "Someone outside the organization is invited on the library's page. Asks the person first.",
  args: { libraryId: v.id("evidenceLibraries"), email: v.string(), role: roleValidator },
  returns: v.null(),
  ...teamChange,
  run: async (ctx, actor, { libraryId, email, role }) => {
    const signedIn = await signedInFor(ctx, actor, libraryId);
    const access = await readEvidenceLibraryAccess(signedIn, libraryId, "manage");
    if (!access?.organization) throw createError("FORBIDDEN", "Only an owner of the library changes its team.");
    const clerkUserId = await memberIdWithEmail(ctx, access.organization._id, email);
    if (!clerkUserId) throw createError("NOT_FOUND", "No member of the library's organization has that email. Someone outside it is invited on the library's page.");
    return await addLibraryMember(signedIn, { libraryId, clerkUserId, role });
  },
});
export const addMember = userMutation(addMemberAction);
export const addMemberForAssistant = assistantMutation(addMemberAction);

export const changeRoleAction = defineUserMutation({
  path: "evidenceLibraries/assistant:changeRole",
  description: "Changes the role of someone the library's team lists, for an owner: editor or creator, by the `clerkUserId` evidenceLibraries/assistant:team gives. Its owners' access is the organization's to change. Asks the person first.",
  args: { libraryId: v.id("evidenceLibraries"), clerkUserId: v.string(), role: roleValidator },
  returns: v.null(),
  ...teamChange,
  run: async (ctx, actor, args) => await changeLibraryRole(await signedInFor(ctx, actor, args.libraryId), args),
});
export const changeRole = userMutation(changeRoleAction);
export const changeRoleForAssistant = assistantMutation(changeRoleAction);

export const removeMemberAction = defineUserMutation({
  path: "evidenceLibraries/assistant:removeMember",
  description: "Takes someone's role on the library away, for an owner, by the `clerkUserId` evidenceLibraries/assistant:team gives. Its owners' access is the organization's to change. Asks the person first.",
  args: { libraryId: v.id("evidenceLibraries"), clerkUserId: v.string() },
  returns: v.null(),
  ...teamChange,
  run: async (ctx, actor, args) => await removeLibraryMember(await signedInFor(ctx, actor, args.libraryId), args),
});
export const removeMember = userMutation(removeMemberAction);
export const removeMemberForAssistant = assistantMutation(removeMemberAction);

/** Who acts and where, as an action passes them to a query: nothing else of the actor. */
const where = ({ userId, workspaceId }: InWorkspace) => ({ userId, workspaceId });

/** Refuses a library a reply can't reach (`signedInFor`), for an action, which reads through a query. */
export const reachable = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, { libraryId, ...actor }) => {
    await signedInFor(ctx, actor, libraryId);
    return null;
  },
});

/** The organization whose workspace the reply runs in, where a new library is made: a person's own workspace has none. */
export const organizationHere = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.id("organizations"),
  handler: async (ctx, { workspaceId }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (workspace?.kind !== "organization") throw createError("VALIDATION_ERROR", "Evidence Libraries are made in an organization. Switch to one, then ask again.");
    return workspace.organizationId;
  },
});

const roleOrNone = v.optional(v.union(roleValidator, v.null()));

export const inviteAction = defineUserAction({
  path: "evidenceLibraries/assistant:invite",
  description:
    "Invites someone to a library's team by email, for an owner: editor (changes its records) or creator (adds them). They get an email, and see it under invitations once they sign in with that address. " +
    "A member of the library's organization is added directly with evidenceLibraries/assistant:addMember. Asks the person first.",
  args: { libraryId: v.id("evidenceLibraries"), email: v.string(), role: roleValidator },
  returns: v.null(),
  ...teamChange,
  run: async (ctx, actor, args): Promise<null> => {
    await ctx.runQuery(internal.evidenceLibraries.assistant.reachable, { ...where(actor), libraryId: args.libraryId });
    return await ctx.runAction(internal.evidenceLibraries.invitationActions.inviteFor, { ...args, actingAs: actor.userId });
  },
});
export const invite = userAction(inviteAction);
export const inviteForAssistant = assistantAction(inviteAction);

export const changeInvitationAction = defineUserMutation({
  path: "evidenceLibraries/assistant:changeInvitation",
  description: "Changes the role an invitation to a library still waiting gives, or with `cancel` withdraws it, for an owner, by the invitation's ID evidenceLibraries/assistant:team lists. Asks the person first.",
  args: { invitationId: v.id("itemInvitations"), role: roleOrNone, cancel: v.optional(v.union(v.boolean(), v.null())) },
  returns: v.null(),
  ...teamChange,
  run: async (ctx, actor, { invitationId, role, cancel }) => {
    const invitation = await ctx.db.get("itemInvitations", invitationId);
    const library = invitation ? await libraryOf(ctx, invitation) : null;
    if (!library) throw createError("NOT_FOUND", "Invitation not found");
    return await changeLibraryInvitation(await signedInFor(ctx, actor, library._id), { invitationId, ...(role ? { role } : {}), ...(cancel ? { cancel } : {}) });
  },
});
export const changeInvitation = userMutation(changeInvitationAction);
export const changeInvitationForAssistant = assistantMutation(changeInvitationAction);

export const invitationsAction = defineUserQuery({
  path: "evidenceLibraries/assistant:invitations",
  description:
    "Lists the invitations to Evidence Libraries waiting for the person: each one's ID, the library, its organization and the role it gives. Answer one with evidenceLibraries/assistant:answerInvitation. " +
    "Empty in an organization: what's offered to someone is in their own workspace.",
  args: {},
  returns: pendingInvitationsValidator,
  run: async (ctx, actor) => ((await inOwnWorkspace(ctx, actor)) ? await readPendingLibraryInvitations(ctx, await personOf(ctx, actor.userId)) : []),
});
export const invitations = userQuery(invitationsAction);
export const invitationsForAssistant = assistantQuery(invitationsAction);

export const answerInvitationAction = defineUserAction({
  path: "evidenceLibraries/assistant:answerInvitation",
  description: "Accepts or declines an invitation to an Evidence Library waiting for the person, by its ID evidenceLibraries/assistant:invitations gives. It must be to an address their account has verified. Done in their own workspace; asks the person first.",
  args: { invitationId: v.id("itemInvitations"), accept: v.boolean() },
  returns: v.null(),
  spendsCredits: false,
  // The library's owners see who joined, and nothing takes an answer back.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, args): Promise<null> => {
    const own: boolean = await ctx.runQuery(internal.evidenceLibraries.assistant.ownWorkspace, where(actor));
    if (!own) throw createError("VALIDATION_ERROR", "An invitation is answered in the person's own workspace. Switch to it, then ask again.");
    return await ctx.runAction(internal.evidenceLibraries.invitationActions.respondFor, { ...args, actingAs: actor.userId });
  },
});
export const answerInvitation = userAction(answerInvitationAction);
export const answerInvitationForAssistant = assistantAction(answerInvitationAction);

/** Whether the reply runs in the person's own workspace, for an action. */
export const ownWorkspace = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces") },
  returns: v.boolean(),
  handler: async (ctx, actor) => await inOwnWorkspace(ctx, actor),
});

export const startLibraryAction = defineUserAction({
  path: "evidenceLibraries/assistant:startLibrary",
  description:
    "Starts a new Evidence Library as a draft, for an admin of the organization the reply runs in whose plan has Evidence Libraries: reserves the address its name gives and makes its draft settings, which evidenceLibraries/assistant:editDraft then changes. " +
    "Nothing is public until the draft is put live, on the library's page. Asks the person first.",
  args: { name: v.string() },
  returns: addressReservationValidator,
  spendsCredits: false,
  // It takes an address and a place among the organization's libraries, and nothing gives them back by itself.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { name }): Promise<Infer<typeof addressReservationValidator>> => {
    const organizationId = await ctx.runQuery(internal.evidenceLibraries.assistant.organizationHere, { workspaceId: actor.workspaceId });
    return await ctx.runAction(internal.evidenceLibraries.addressActions.reserveAddressFor, { name, organizationId, actingAs: actor.userId });
  },
});
export const startLibrary = userAction(startLibraryAction);
export const startLibraryForAssistant = assistantAction(startLibraryAction);

export const sourcesAction = defineUserQuery({
  path: "evidenceLibraries/assistant:sources",
  description: "Reads how a library's sources last ran, as the running library reported it: each source's key, state, counts and error. Retry one with evidenceLibraries/assistant:syncSource. Null before its first report.",
  args: { libraryId: v.id("evidenceLibraries") },
  returns: sourceStatusReadValidator,
  run: async (ctx, actor, { libraryId }) => await readSourceStatus(await signedInFor(ctx, actor, libraryId), libraryId),
});
export const sources = userQuery(sourcesAction);
export const sourcesForAssistant = assistantQuery(sourcesAction);

/** A page of a running library's own list, as the assistant asks for it: from `cursor`, with `continueCursor` for the next. */
const pageArgs = { libraryId: v.id("evidenceLibraries"), query: v.optional(v.union(v.string(), v.null())), cursor: v.optional(v.union(v.string(), v.null())) };
const pageOf = ({ cursor }: { cursor?: string | null }) => ({ numItems: RUNTIME_READ_PAGE_SIZE, cursor: cursor ?? null });
const running = { spendsCredits: false, outsideEffect: false, undoable: true } as const;
const collectionsPage = runtimePage(runtimeCollectionValidator);
const institutionsPage = runtimePage(runtimeInstitutionValidator);
const publicationsPage = runtimePage(reviewedPublicationValidator);
const publicationRead = v.union(reviewedPublicationValidator, v.null());
const syncRead = v.object({ reason: notSetUpValidator });

export const runningCollectionsAction = defineUserAction({
  path: "evidenceLibraries/assistant:runningCollections",
  description: `Lists the collections the running library shows, ${RUNTIME_READ_PAGE_SIZE} a page, searched by \`query\`: each one's ID, title, record count, source and the collection it sits in. \`reason: "not-set-up"\` when the library isn't running yet.`,
  args: pageArgs,
  returns: collectionsPage,
  ...running,
  run: async (ctx, actor, { libraryId, query, cursor }): Promise<Infer<typeof collectionsPage>> => {
    await ctx.runQuery(internal.evidenceLibraries.assistant.reachable, { ...where(actor), libraryId });
    return await ctx.runAction(internal.zotero.runtimeReadActions.listCollectionsFor, { libraryId, ...(query ? { query } : {}), paginationOpts: pageOf({ cursor }), actingAs: actor.userId });
  },
});
export const runningCollections = userAction(runningCollectionsAction);
export const runningCollectionsForAssistant = assistantAction(runningCollectionsAction);

export const runningInstitutionsAction = defineUserAction({
  path: "evidenceLibraries/assistant:runningInstitutions",
  description: `Lists the institutions named on the running library's records, ${RUNTIME_READ_PAGE_SIZE} a page, searched by \`query\`, most records first or by \`sort\` "name": each one's name and record count.`,
  args: { ...pageArgs, sort: v.optional(v.union(v.literal("count"), v.literal("name"), v.null())) },
  returns: institutionsPage,
  ...running,
  run: async (ctx, actor, { libraryId, query, cursor, sort }): Promise<Infer<typeof institutionsPage>> => {
    await ctx.runQuery(internal.evidenceLibraries.assistant.reachable, { ...where(actor), libraryId });
    return await ctx.runAction(internal.zotero.runtimeReadActions.listInstitutionsFor, { libraryId, ...(query ? { query } : {}), ...(sort ? { sort, direction: sort === "name" ? "asc" as const : "desc" as const } : {}), paginationOpts: pageOf({ cursor }), actingAs: actor.userId });
  },
});
export const runningInstitutions = userAction(runningInstitutionsAction);
export const runningInstitutionsForAssistant = assistantAction(runningInstitutionsAction);

export const runningPublicationsAction = defineUserAction({
  path: "evidenceLibraries/assistant:runningPublications",
  description: `Lists the running library's publications with a PDF, ${RUNTIME_READ_PAGE_SIZE} a page, searched by \`query\`: each one's key, title, date, reviewer and whether it's reviewed. One by its key is evidenceLibraries/assistant:runningPublication.`,
  args: pageArgs,
  returns: publicationsPage,
  ...running,
  run: async (ctx, actor, { libraryId, query, cursor }): Promise<Infer<typeof publicationsPage>> => {
    await ctx.runQuery(internal.evidenceLibraries.assistant.reachable, { ...where(actor), libraryId });
    return await ctx.runAction(internal.zotero.runtimeReadActions.listPublicationsFor, { libraryId, ...(query ? { query } : {}), paginationOpts: pageOf({ cursor }), actingAs: actor.userId });
  },
});
export const runningPublications = userAction(runningPublicationsAction);
export const runningPublicationsForAssistant = assistantAction(runningPublicationsAction);

export const runningPublicationAction = defineUserAction({
  path: "evidenceLibraries/assistant:runningPublication",
  description: "Reads one of the running library's publications by its key: its title, date, reviewer and whether it's reviewed. Null when the library has none with that key.",
  args: { libraryId: v.id("evidenceLibraries"), key: v.string() },
  returns: publicationRead,
  ...running,
  run: async (ctx, actor, args): Promise<Infer<typeof publicationRead>> => {
    await ctx.runQuery(internal.evidenceLibraries.assistant.reachable, { ...where(actor), libraryId: args.libraryId });
    return await ctx.runAction(internal.zotero.runtimeReadActions.readPublicationFor, { ...args, actingAs: actor.userId });
  },
});
export const runningPublication = userAction(runningPublicationAction);
export const runningPublicationForAssistant = assistantAction(runningPublicationAction);

export const syncSourceAction = defineUserAction({
  path: "evidenceLibraries/assistant:syncSource",
  description: "Asks the running library to run one of its sources again now, by the key evidenceLibraries/assistant:sources gives: an import that failed is retried within seconds. For an owner; asks the person first.",
  args: { libraryId: v.id("evidenceLibraries"), sourceKey: v.string() },
  returns: syncRead,
  spendsCredits: false,
  // The library's records change for everyone who reads it.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, args): Promise<Infer<typeof syncRead>> => {
    await ctx.runQuery(internal.evidenceLibraries.assistant.reachable, { ...where(actor), libraryId: args.libraryId });
    return await ctx.runAction(internal.zotero.runtimeReadActions.requestSourceRunFor, { ...args, actingAs: actor.userId });
  },
});
export const syncSource = userAction(syncSourceAction);
export const syncSourceForAssistant = assistantAction(syncSourceAction);
