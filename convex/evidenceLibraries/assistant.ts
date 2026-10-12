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
import { createError } from "../lib/errors";
import { asSignedIn, assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { STEP_TEXT_MAX } from "../../lib/assistant/steps";
import { evidenceLibraryUploadPrefix } from "../../lib/evidence-libraries/configuration/uploads";
import { readEvidenceLibraryAccess } from "./access";
import { addLibraryMember, changeLibraryRole, removeLibraryMember } from "./team";
import { memberIdWithEmail } from "../organizations/read";
import { saveEvidenceLibraryDraftSections } from "./mutations";
import { libraryTeamValidator, readEvidenceLibraryDraft, readEvidenceLibraryRevision, readLibraryTeam, revisionReadValidator } from "./queries";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { assistantDraftValidator, assistantEditResultValidator, assistantLibrariesValidator, DRAFT_CHANGES_MAX, DRAFT_PATH_DEPTH, draftChangesValidator, draftPathValidator, LIBRARIES_LISTED } from "./validators";

const EDIT_PATH = "evidenceLibraries/assistant:editDraft" as const;
type Change = Infer<typeof draftChangesValidator>[number];
type Path = Change["path"];

/** The person an action acts for, as their account holds them. */
async function personOf(ctx: QueryCtx, userId: Id<"users">) {
  const person = await ctx.db.get("users", userId);
  if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
  return person;
}

export const librariesAction = defineUserQuery({
  path: "evidenceLibraries/assistant:libraries",
  description:
    `Lists the workspace's Evidence Libraries the person can see, the first ${LIBRARIES_LISTED} made: each one's ID, name, address name, state, and whether they can change its settings. ` +
    "A library's settings are evidenceLibraries/assistant:draft; putting a draft live is done on the library's page.",
  args: {},
  returns: assistantLibrariesValidator,
  run: async (ctx, { userId, workspaceId }) => {
    const signedIn = await asSignedIn(ctx, await personOf(ctx, userId));
    const libraries = await ctx.db.query("evidenceLibraries").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(LIBRARIES_LISTED);
    const shown: Infer<typeof assistantLibrariesValidator> = [];
    for (const library of libraries) {
      if (!(await readEvidenceLibraryAccess(signedIn, library._id, "view"))) continue;
      const editable = (await readEvidenceLibraryAccess(signedIn, library._id, "manage")) !== null;
      shown.push({ libraryId: library._id, name: library.name, slug: library.slug, state: library.state, editable });
    }
    return shown;
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
  run: async (ctx, { userId }, { libraryId, sections, path }) => {
    const read = await draftOf(await asSignedIn(ctx, await personOf(ctx, userId)), libraryId);
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
  run: async (ctx, { userId }, args) => await readEvidenceLibraryRevision(await asSignedIn(ctx, await personOf(ctx, userId)), args),
});
export const revision = userQuery(revisionAction);
export const revisionForAssistant = assistantQuery(revisionAction);

export const teamAction = defineUserQuery({
  path: "evidenceLibraries/assistant:team",
  description: "Reads an Evidence Library's team: its owners, editors and creators, and for an owner the invitations still waiting, as the library's team page shows them.",
  args: { libraryId: v.id("evidenceLibraries") },
  returns: libraryTeamValidator,
  run: async (ctx, { userId }, args) => await readLibraryTeam(await asSignedIn(ctx, await personOf(ctx, userId)), args),
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
  digestOpaqueToken(JSON.stringify(changes.map(({ sectionKey, path }) => valueAt(payloadOf(sectionKey), path, sectionKey) ?? null)));
/** An undo is kept only when it fits a step; its digest is always this long (SHA-256 in hex). */
const undoFits = (libraryId: Id<"evidenceLibraries">, undo: Change[]) => JSON.stringify({ libraryId, changes: undo, unchanged: "0".repeat(64) }).length <= STEP_TEXT_MAX;

export const editDraftAction = defineUserMutation({
  path: EDIT_PATH,
  description:
    "Changes an Evidence Library's draft settings, for an owner. Each change sets the value at a `path` inside one section (its keys and list places, as evidenceLibraries/assistant:draft shows the section), or with no `value` takes that key out; an empty path sets the section whole, and a list item is added or taken out by setting the list whole. " +
    "Give the draft's `expectedEditVersion` from that read (`unchanged` is Undo's own). The result is checked as the configuration page checks it, and a refusal says what's wrong. " +
    "Uploaded files (logos, photos, documents) are changed on the page: a change can't replace a value holding one or write one in. Nothing is public until the draft is put live, on the library's page. Undo puts the values back.",
  args: { libraryId: v.id("evidenceLibraries"), changes: draftChangesValidator, expectedEditVersion: v.optional(v.number()), unchanged: v.optional(v.string()) },
  returns: assistantEditResultValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // An edit that can't be put back, a new section or one too large for an undo, asks first.
  asksFirst: async (ctx, { userId }, { libraryId, changes }) => {
    const { undo } = changed(libraryId, await draftOf(await asSignedIn(ctx, await personOf(ctx, userId)), libraryId), changes);
    return !undo || !undoFits(libraryId, undo);
  },
  run: async (ctx, { userId }, { libraryId, changes, expectedEditVersion, unchanged }) => {
    if ((expectedEditVersion === undefined) === (unchanged === undefined)) throw createError("VALIDATION_ERROR", "Give the draft's expectedEditVersion from evidenceLibraries/assistant:draft.");
    const signedIn = await asSignedIn(ctx, await personOf(ctx, userId));
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
  run: async (ctx, { userId }, { libraryId, email, role }) => {
    const signedIn = await asSignedIn(ctx, await personOf(ctx, userId));
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
  run: async (ctx, { userId }, args) => await changeLibraryRole(await asSignedIn(ctx, await personOf(ctx, userId)), args),
});
export const changeRole = userMutation(changeRoleAction);
export const changeRoleForAssistant = assistantMutation(changeRoleAction);

export const removeMemberAction = defineUserMutation({
  path: "evidenceLibraries/assistant:removeMember",
  description: "Takes someone's role on the library away, for an owner, by the `clerkUserId` evidenceLibraries/assistant:team gives. Its owners' access is the organization's to change. Asks the person first.",
  args: { libraryId: v.id("evidenceLibraries"), clerkUserId: v.string() },
  returns: v.null(),
  ...teamChange,
  run: async (ctx, { userId }, args) => await removeLibraryMember(await asSignedIn(ctx, await personOf(ctx, userId)), args),
});
export const removeMember = userMutation(removeMemberAction);
export const removeMemberForAssistant = assistantMutation(removeMemberAction);
