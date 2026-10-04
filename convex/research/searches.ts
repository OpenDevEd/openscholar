/**
 * The assistant's tools for saved searches (#327): make one, change its query and filters,
 * put it back, and read a page of its results. They take a search as plain settings and map
 * them onto the saved search's own fields, then go through `applyCommand` like every other
 * change, so the person's open page follows and each change has its undo (#342).
 */
import { v, type Infer, type ObjectType } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, assistantMutation, defineUserAction, defineUserMutation, reversedBy, userAction, userMutation } from "../lib/userActions";
import { readSearchPage } from "../paperSets/openalex";
import { SCREENING_FIELDS, toPaper, type Work } from "../paperSets/search";
import { currentSearch, searchAsMade, type SavedSearch, type UndoCommand } from "../../lib/research/records";
import { applyCommand, findSearch } from "./records";
import { RESULTS_PAGE, resultsValidator, searchSettings } from "./searchValidators";

const CREATE = "research/searches:create" as const;
const UPDATE = "research/searches:update" as const;
const RESTORE = "research/searches:restore" as const;
const REMOVE = "research/searches:remove" as const;

const SORTS = { relevance: "relevance_score:desc", most_cited: "cited_by_count:desc", newest: "publication_date:desc", oldest: "publication_date:asc" } as const;
/** The first year a search can start from, when only its last year is given. */
const FIRST_YEAR = 1900;
/** Characters of an abstract a results page carries, so ten papers stay within what the model reads at once. */
const ABSTRACT_SHOWN = 300;

type Settings = ObjectType<typeof searchSettings>;

/**
 * Plain settings as the saved search's own fields: what to set, and what to take off.
 * `current` is the search being changed, whose year range fills in a year left out.
 */
function savedFields(settings: Settings, current?: SavedSearch) {
  const fields: Partial<SavedSearch> = {};
  const clear: string[] = [];
  if (settings.field !== undefined) fields.field = settings.field;
  if (settings.fromYear !== undefined || settings.toYear !== undefined) {
    const [from, to] = [settings.fromYear === undefined ? current?.yearRange?.[0] : settings.fromYear, settings.toYear === undefined ? current?.yearRange?.[1] : settings.toYear];
    if (from == null && to == null) {
      clear.push("yearRange");
      fields.isYearRangeEnabled = false;
    } else {
      const range = [from ?? FIRST_YEAR, to ?? new Date().getFullYear()];
      if (range[0] > range[1]) throw createError("VALIDATION_ERROR", "The first year is after the last.");
      Object.assign(fields, { yearRange: range, isYearRangeEnabled: true, filterType: "year" });
    }
  }
  if (settings.openAccessOnly !== undefined) fields.openAccessOnly = settings.openAccessOnly;
  if (settings.withAbstractOnly !== undefined) fields.hasAbstract = settings.withAbstractOnly;
  if (settings.reviewsOnly !== undefined) fields.reviewFilter = settings.reviewsOnly;
  if (settings.minCitations === null) clear.push("minCitations");
  else if (settings.minCitations !== undefined) fields.minCitations = settings.minCitations;
  if (settings.sort !== undefined) fields.sortBy = SORTS[settings.sort];
  return { fields, clear };
}

type Restore = Extract<UndoCommand, { kind: "editSearch" }>;
const restoreArgs = { id: v.string(), revision: v.number(), expect: v.number() };
/** A restore command as these tools return it: the undo of a change to a search. */
const restoring = (command: Restore) => ({ path: RESTORE, args: { id: command.id, revision: command.edit.revision, expect: command.edit.expect } });

export const createAction = defineUserMutation({
  path: CREATE,
  description:
    "Makes a saved search in the person's account from a query and filters, which shows in their search history at once. It doesn't run the search: read its results with research/searches:results. " +
    "The query is keywords, with AND, OR, NOT and quoted phrases. Returns the search's ID, and `undo`, which deletes it while nothing has been done with it.",
  args: { query: v.string(), ...searchSettings },
  returns: v.object({ id: v.string(), undo: reversedBy(REMOVE, { id: v.string(), expect: searchAsMade }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { query, ...settings }, author) => {
    if (!query.trim()) throw createError("VALIDATION_ERROR", "A search needs a query.");
    const now = new Date().toISOString();
    const search: SavedSearch = {
      id: crypto.randomUUID(),
      query: query.trim(),
      field: "title_and_abstract",
      // Its results page counts its results when it's first read.
      count: 0,
      queryHistoryCount: 0,
      questionCount: 0,
      questionText: "",
      screeningQuestions: [],
      screeningResponses: [],
      ...savedFields(settings).fields,
      createdAt: now,
      updatedAt: now,
    };
    const undo = await applyCommand(ctx, userId, { kind: "createSearch", search }, author);
    return { id: search.id, ...(undo?.kind === "deleteSearch" ? { undo: { path: REMOVE, args: { id: undo.id, expect: undo.expect } } } : {}) };
  },
});
export const create = userMutation(createAction);
export const createForAssistant = assistantMutation(createAction);

export const updateAction = defineUserMutation({
  path: UPDATE,
  description:
    "Changes a saved search's query, its filters, or both. Only what's given changes; null takes a year or the citation minimum off. The person's open page follows. " +
    "Returns `undo`, which puts the search back as it was before this change. It is refused if the search changed again in between.",
  args: { id: v.string(), query: v.optional(v.string()), ...searchSettings },
  returns: v.object({ undo: reversedBy(RESTORE, restoreArgs) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { id, query, ...settings }, author) => {
    const found = await findSearch(ctx, userId, id);
    if (!found) throw createError("NOT_FOUND", "Search not found.");
    const current = currentSearch(found.data);
    const { fields, clear } = savedFields(settings, current);
    // A new query is one more query the search has had, so it's its own edit; the field goes with it.
    const requeried = query !== undefined && query.trim() !== "" && (query.trim() !== current.query || (fields.field ?? current.field) !== current.field);
    const { field, ...filters } = fields;
    const undone: Restore[] = [];
    const keep = (undo: UndoCommand | undefined) => {
      if (undo?.kind === "editSearch") undone.push(undo);
    };
    if (requeried) keep(await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "query", query: query!.trim(), field: field ?? current.field } }, author));
    const patch = requeried ? filters : fields;
    if (Object.keys(patch).length || clear.length) keep(await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "patch", fields: patch, clear } }, author));
    // One undo for the whole change: back to the revision before its first edit, from the one after its last.
    return undone.length ? { undo: restoring({ ...undone[0], edit: { ...undone[0].edit, expect: undone.at(-1)!.edit.expect } }) } : {};
  },
});
export const update = userMutation(updateAction);
export const updateForAssistant = assistantMutation(updateAction);

export const restoreAction = defineUserMutation({
  path: RESTORE,
  description:
    "Puts a saved search's query and filters back as they were at one of its revisions, as a new revision. With `expect`, the revision whose query and filters the search should hold now, it is refused if the search changed since. " +
    "Returns `undo`, which puts back what this replaced.",
  args: { id: v.string(), revision: v.number(), expect: v.optional(v.number()) },
  returns: v.object({ undo: reversedBy(RESTORE, restoreArgs) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { id, revision, expect }, author) => {
    const undo = await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "restore", revision, ...(expect === undefined ? {} : { expect }) } }, author);
    return undo?.kind === "editSearch" ? { undo: restoring(undo) } : {};
  },
});
export const restore = userMutation(restoreAction);
export const restoreForAssistant = assistantMutation(restoreAction);

export const removeAction = defineUserMutation({
  path: REMOVE,
  description:
    "Deletes a saved search that was just made, as the undo of making it: `expect` is the search as its creation left it, and the search stays if anything has been done with it since. It deletes no other search.",
  args: { id: v.string(), expect: searchAsMade },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  // It only takes back a creation, and only while nothing would be lost with it.
  undoable: true,
  run: async (ctx, userId, { id, expect }, author) => {
    await applyCommand(ctx, userId, { kind: "deleteSearch", id, expect }, author);
    return null;
  },
});
export const remove = userMutation(removeAction);
export const removeForAssistant = assistantMutation(removeAction);

export const resultsAction = defineUserAction({
  path: "research/searches:results",
  description:
    `Reads a page of a saved search's results from OpenAlex, ${RESULTS_PAGE} papers a page: each paper's ID, title, authors, year, venue, citations and the start of its abstract, with how many results the search has in all. ` +
    "The papers come in the order the search sorts them. Each page read counts against the person's OpenAlex allowance.",
  args: { id: v.string(), page: v.optional(v.number()) },
  returns: resultsValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, userId, { id, page = 1 }): Promise<Infer<typeof resultsValidator>> => {
    if (!Number.isInteger(page) || page < 1) throw createError("VALIDATION_ERROR", "Pages count from 1.");
    const found: { clerkId: string; request: Parameters<typeof readSearchPage>[0] | null } = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId: id });
    if (!found.request) throw createError("VALIDATION_ERROR", "This search's query isn't valid. Fix it on the results page first.");
    const { works, total } = await readSearchPage<Work>(found.request, { page, size: RESULTS_PAGE, select: SCREENING_FIELDS }, (count) =>
      ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId: found.clerkId, count }),
    );
    return {
      total,
      page,
      pages: Math.ceil(total / RESULTS_PAGE),
      papers: works.map(toPaper).map((paper) => ({
        id: paper.openalexId,
        title: paper.title,
        ...(paper.authors?.length ? { authors: paper.authors.slice(0, 3).join(", ") + (paper.authors.length > 3 ? " and others" : "") } : {}),
        ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }),
        ...(paper.venue ? { venue: paper.venue } : {}),
        ...(paper.citedByCount === undefined ? {} : { citations: paper.citedByCount }),
        ...(paper.abstract ? { abstract: paper.abstract.length > ABSTRACT_SHOWN ? `${paper.abstract.slice(0, ABSTRACT_SHOWN)}…` : paper.abstract } : {}),
      })),
    };
  },
});
export const results = userAction(resultsAction);
export const resultsForAssistant = assistantAction(resultsAction);
