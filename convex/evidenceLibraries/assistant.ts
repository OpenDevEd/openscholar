/**
 * An Evidence Library's draft as the assistant works it (#329): the workspace's libraries, a
 * library's draft settings and a revision of them, its team, and saving sections of the draft.
 * Each runs the configuration page's own reads and save as the person the assistant acts for
 * (`asSignedIn`), so the page's rules hold whole: only an owner whose plan has Evidence
 * Libraries changes a draft, and every section is checked as the page checks it. A draft isn't
 * public until it's put live, which stays on the library's page.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { asSignedIn, assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { STEP_TEXT_MAX } from "../../lib/assistant/steps";
import { evidenceLibraryUploadPrefix } from "../../lib/evidence-libraries/configuration/uploads";
import { readEvidenceLibraryAccess } from "./access";
import { saveEvidenceLibraryDraftSections } from "./mutations";
import { libraryTeamValidator, readEvidenceLibraryDraft, readEvidenceLibraryRevision, readLibraryTeam, revisionReadValidator } from "./queries";
import { assistantDraftValidator, assistantLibrariesValidator, assistantSaveResultValidator, LIBRARIES_LISTED, sectionRowValidator } from "./validators";

const SAVE_PATH = "evidenceLibraries/assistant:saveSections" as const;
type SectionRow = Infer<typeof sectionRowValidator>;

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
    "Give `sections` to read only those. Change sections with evidenceLibraries/assistant:saveSections.",
  args: { libraryId: v.id("evidenceLibraries"), sections: v.optional(v.union(v.array(v.string()), v.null())) },
  returns: assistantDraftValidator,
  run: async (ctx, { userId }, { libraryId, sections }) => {
    const read = await readEvidenceLibraryDraft(await asSignedIn(ctx, await personOf(ctx, userId)), { libraryId });
    if (!read) throw createError("NOT_FOUND", "Evidence Library not found");
    const asked = sections?.length ? new Set(sections) : null;
    return {
      libraryId,
      name: read.library.name,
      state: read.library.state,
      editVersion: read.draft.editVersion,
      editable: read.editable,
      hasUnpublishedChanges: read.hasUnpublishedChanges,
      ...(read.liveAddress ? { liveAddress: read.liveAddress } : {}),
      sections: read.sections.filter((section) => !asked || asked.has(section.sectionKey)),
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

/** Every address of this library's own uploaded files a section holds, however deep: logos, photos, documents. */
function uploadsIn(payload: unknown, libraryId: Id<"evidenceLibraries">, found = new Set<string>()): Set<string> {
  if (typeof payload === "string") {
    if (payload.includes(evidenceLibraryUploadPrefix(libraryId))) found.add(payload);
  } else if (payload && typeof payload === "object") {
    for (const value of Object.values(payload)) uploadsIn(value, libraryId, found);
  }
  return found;
}

/** The draft's sections a save would replace, by key: null for one the draft hasn't got, which a save can't take back out. */
async function replaced(ctx: QueryCtx, person: Doc<"users">, libraryId: Id<"evidenceLibraries">, keys: string[]) {
  const read = await readEvidenceLibraryDraft(await asSignedIn(ctx, person), { libraryId });
  if (!read) throw createError("NOT_FOUND", "Evidence Library not found");
  return keys.map((key): SectionRow | null => {
    const section = read.sections.find((one) => one.sectionKey === key);
    return section ? { sectionKey: section.sectionKey, payload: section.payload } : null;
  });
}

/** What puts the sections back, or null when it can't be undone: a section the draft hadn't got, or more than an undo holds. */
const undoOf = (libraryId: Id<"evidenceLibraries">, before: Array<SectionRow | null>, editVersion: number) => {
  if (before.some((section) => section === null)) return null;
  const args = { libraryId, sections: before as SectionRow[], expectedEditVersion: editVersion };
  return JSON.stringify(args).length <= STEP_TEXT_MAX ? args : null;
};

export const saveSectionsAction = defineUserMutation({
  path: SAVE_PATH,
  description:
    "Saves sections of an Evidence Library's draft settings, for an owner: each section whole, by its key, with the settings as evidenceLibraries/assistant:draft gives them, changed where it should change, and the draft's `expectedEditVersion` from that read. " +
    "Each is checked as the configuration page checks it, and a refusal says what's wrong. Logos, photos and other uploaded files stay as they are: they're changed on the page. Nothing is public until the draft is put live, on the library's page. Undo puts the sections back.",
  args: { libraryId: v.id("evidenceLibraries"), sections: v.array(sectionRowValidator), expectedEditVersion: v.number() },
  returns: assistantSaveResultValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // One whose sections can't be put back, a new section or one too large for an undo, asks first.
  asksFirst: async (ctx, { userId }, { libraryId, sections }) => undoOf(libraryId, await replaced(ctx, await personOf(ctx, userId), libraryId, sections.map((section) => section.sectionKey)), 0) === null,
  run: async (ctx, { userId }, { libraryId, sections, expectedEditVersion }) => {
    const person = await personOf(ctx, userId);
    if (new Set(sections.map((section) => section.sectionKey)).size !== sections.length) throw createError("VALIDATION_ERROR", "Give each section once.");
    const before = await replaced(ctx, person, libraryId, sections.map((section) => section.sectionKey));
    // The library's uploaded files are changed on its page, which also deletes the one a file replaces.
    for (const [at, section] of sections.entries()) {
      const was = uploadsIn(before[at]?.payload, libraryId);
      const now = uploadsIn(section.payload, libraryId);
      if (was.size !== now.size || [...now].some((url) => !was.has(url))) {
        throw createError("VALIDATION_ERROR", `The ${section.sectionKey} section's uploaded files (logos, photos, documents) are changed on the library's configuration page. Keep their addresses as they are.`);
      }
    }
    const { editVersion } = await saveEvidenceLibraryDraftSections(await asSignedIn(ctx, person), { libraryId, sections, expectedEditVersion });
    const undo = undoOf(libraryId, before, editVersion);
    return { editVersion, ...(undo ? { undo: { path: SAVE_PATH, args: undo } } : {}) };
  },
});
export const saveSections = userMutation(saveSectionsAction);
export const saveSectionsForAssistant = assistantMutation(saveSectionsAction);
