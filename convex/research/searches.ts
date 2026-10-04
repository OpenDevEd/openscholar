/**
 * The assistant's tools for saved searches (#327): make one, change its query and filters,
 * put it back, and read a page of its results. They take a search as plain settings and map
 * them onto the saved search's own fields, then go through `applyCommand` like every other
 * change, so the person's open page follows and each change has its undo (#342).
 */
import { v, type Infer, type ObjectType } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { assistantAction, assistantMutation, defineUserAction, defineUserMutation, reversedBy, userAction, userMutation } from "../lib/userActions";
import { readSearchPage } from "../paperSets/openalex";
import { keptByRating, SCREENING_FIELDS, toPaper, type SavedSearchRequest, type Work } from "../paperSets/search";
import { MIN_YEAR } from "../../lib/constants";
import { currentSearch, type SavedSearch, type UndoCommand } from "../../lib/research/records";
import { applyCommand, findSearch, revisionRow } from "./records";
import { LAST_PAGE, RESULTS_PAGE, resultsValidator, searchSettings } from "./searchValidators";

const CREATE = "research/searches:create" as const;
const UPDATE = "research/searches:update" as const;
const RESTORE = "research/searches:restore" as const;
const REMOVE = "research/searches:remove" as const;

const SORTS = { relevance: "relevance_score:desc", most_cited: "cited_by_count:desc", newest: "publication_date:desc", oldest: "publication_date:asc" } as const;
/** Characters of each text a results page carries, so ten whole papers stay within what the model reads at once. */
const SHOWN = { title: 200, authors: 100, venue: 80, abstract: 250 };
const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

type Settings = ObjectType<typeof searchSettings>;

const needsQuery = () => createError("VALIDATION_ERROR", "A search needs a query.");

/**
 * Plain settings as the saved search's own fields: what to set, and what to take off.
 * `current` is the search being changed, whose year range fills in a year left out.
 */
function savedFields(settings: Settings, current?: SavedSearch) {
  const fields: Partial<SavedSearch> = {};
  const clear: string[] = [];
  const thisYear = new Date().getFullYear();
  if (settings.field !== undefined) fields.field = settings.field;
  for (const year of [settings.fromYear, settings.toYear]) {
    if (year != null && (!Number.isInteger(year) || year < MIN_YEAR || year > thisYear)) throw createError("VALIDATION_ERROR", `A year is a whole number from ${MIN_YEAR} to ${thisYear}.`);
  }
  if (settings.fromYear !== undefined || settings.toYear !== undefined) {
    const [from, to] = [settings.fromYear === undefined ? current?.yearRange?.[0] : settings.fromYear, settings.toYear === undefined ? current?.yearRange?.[1] : settings.toYear];
    if (from == null && to == null) {
      clear.push("yearRange");
      fields.isYearRangeEnabled = false;
    } else {
      const range = [from ?? MIN_YEAR, to ?? thisYear];
      if (range[0] > range[1]) throw createError("VALIDATION_ERROR", "The first year is after the last.");
      Object.assign(fields, { yearRange: range, isYearRangeEnabled: true, filterType: "year" });
    }
  }
  if (settings.openAccessOnly !== undefined) fields.openAccessOnly = settings.openAccessOnly;
  if (settings.withAbstractOnly !== undefined) fields.hasAbstract = settings.withAbstractOnly;
  if (settings.reviewsOnly !== undefined) fields.reviewFilter = settings.reviewsOnly;
  if (settings.minCitations === null) clear.push("minCitations");
  else if (settings.minCitations !== undefined) {
    if (!Number.isInteger(settings.minCitations) || settings.minCitations < 0) throw createError("VALIDATION_ERROR", "The citation minimum is a whole number, 0 or more.");
    fields.minCitations = settings.minCitations;
  }
  if (settings.sort !== undefined) fields.sortBy = SORTS[settings.sort];
  return { fields, clear };
}

type Restore = Extract<UndoCommand, { kind: "editSearch" }>;
const restoreArgs = { id: v.string(), revision: v.number(), expect: v.number() };
/** A restore command as these tools return it: the undo of a change to a search. */
const restoring = (command: Restore) => ({ path: RESTORE, args: { id: command.id, revision: command.edit.revision, expect: command.edit.expect } });

/** A search these tools made, for the undo of making it: the row, and the revision it was made at. One made here starts with no answers. */
const madeHere = v.object({ created: v.number(), revision: v.number() });

export const createAction = defineUserMutation({
  path: CREATE,
  description:
    "Makes a saved search in the person's account from a query and filters, which shows in their search history at once. It doesn't run the search: read its results with research/searches:results. " +
    "The query is keywords, with AND, OR, NOT and quoted phrases. Returns the search's ID, and `undo`, which deletes it while nothing has been done with it.",
  args: { query: v.string(), ...searchSettings },
  returns: v.object({ id: v.string(), undo: reversedBy(REMOVE, { id: v.string(), expect: madeHere }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { query, ...settings }, author) => {
    if (!query.trim()) throw needsQuery();
    const now = new Date().toISOString();
    const search: SavedSearch = {
      id: crypto.randomUUID(),
      query: query.trim(),
      field: "title_and_abstract",
      // Counted when its results are first read, here or on its page.
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
    return { id: search.id, ...(undo?.kind === "deleteSearch" ? { undo: { path: REMOVE, args: { id: undo.id, expect: { created: undo.expect.created, revision: undo.expect.revision } } } } : {}) };
  },
});
export const create = userMutation(createAction);
export const createForAssistant = assistantMutation(createAction);

export const updateAction = defineUserMutation({
  path: UPDATE,
  description:
    "Changes a saved search's query, its filters, or both. Only what's given changes; null takes a year or the citation minimum off. The person's open page follows, from its first page of results. " +
    "Returns `undo`, which puts the search back as it was before this change. It is refused if the search changed again in between.",
  args: { id: v.string(), query: v.optional(v.string()), ...searchSettings },
  returns: v.object({ undo: reversedBy(RESTORE, restoreArgs) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // A change is undone by restoring the revision before it. A search from before revisions were kept has none to go back to.
  asksFirst: async (ctx, userId, { id }) => {
    const found = await findSearch(ctx, userId, id);
    return found !== null && (await revisionRow(ctx, found._id, found.revision)) === null;
  },
  run: async (ctx, userId, { id, query, ...settings }, author) => {
    if (query !== undefined && !query.trim()) throw needsQuery();
    const found = await findSearch(ctx, userId, id);
    if (!found) throw createError("NOT_FOUND", "Search not found.");
    const current = currentSearch(found.data);
    const { fields: { field = current.field, ...filters }, clear } = savedFields(settings, current);
    const asked = query?.trim() ?? current.query;
    // A new query, or the same one read in another field, is one more query the search has had, so it's its own edit.
    const requeried = asked !== current.query || field !== current.field;
    const refiltered =
      Object.entries(filters).some(([key, value]) => JSON.stringify(current[key as keyof SavedSearch]) !== JSON.stringify(value)) || clear.some((key) => current[key as keyof SavedSearch] !== undefined);
    if (!requeried && !refiltered) return {};
    const edits: Array<UndoCommand | undefined> = [];
    if (requeried) edits.push(await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "query", query: asked, field } }, author));
    // Its results start again from their first page, as they do when the person changes the search on its page.
    const patch = { ...filters, ...(current.page !== undefined && current.page !== 1 ? { page: 1 } : {}) };
    if (Object.keys(patch).length || clear.length) edits.push(await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "patch", fields: patch, clear } }, author));
    const undone = edits.filter((undo): undo is Restore => undo?.kind === "editSearch");
    // A new query with no undo had no revision before it to go back to. Undoing the filters alone would leave that query, so the change has no undo at all.
    if (!undone.length || (requeried && edits[0]?.kind !== "editSearch")) return {};
    // One undo for the whole change: back to the revision before its first edit, from the one after its last.
    return { undo: restoring({ ...undone[0], edit: { ...undone[0].edit, expect: undone.at(-1)!.edit.expect } }) };
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
  args: { id: v.string(), expect: madeHere },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  // It only takes back a creation, and only while nothing would be lost with it: the search
  // still holds what its first revision does, and has no answers.
  undoable: true,
  run: async (ctx, userId, { id, expect }, author) => {
    await applyCommand(ctx, userId, { kind: "deleteSearch", id, expect }, author);
    return null;
  },
});
export const remove = userMutation(removeAction);
export const removeForAssistant = assistantMutation(removeAction);

/**
 * Keeps how many results a search has, as its results page does when it reads them, so the
 * search history shows it. Left alone when the search changed while its results were read.
 */
export const counted = internalMutation({
  args: { userId: v.id("users"), id: v.string(), revision: v.number(), count: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, id, revision, count }) => {
    const found = await findSearch(ctx, userId, id);
    if (found?.revision === revision && currentSearch(found.data).count !== count) await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "patch", fields: { count }, clear: [] } }, "assistant");
    return null;
  },
});

export const resultsAction = defineUserAction({
  path: "research/searches:results",
  description:
    `Reads a page of a saved search's results from OpenAlex, ${RESULTS_PAGE} papers a page: each paper's ID, title, authors, year, venue, citations and the start of its abstract, with how many results the search has in all. ` +
    "The papers come in the order the search sorts them. A search that keeps only papers the person rated returns those of each page's papers, and its total counts the papers before that filter. " +
    "Each page read counts against the person's OpenAlex allowance.",
  args: { id: v.string(), page: v.optional(v.number()) },
  returns: resultsValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It only keeps the search's result count, as reading the results page does: nothing to undo.
  undoable: true,
  run: async (ctx, userId, { id, page = 1 }): Promise<Infer<typeof resultsValidator>> => {
    if (!Number.isInteger(page) || page < 1) throw createError("VALIDATION_ERROR", "Pages count from 1.");
    // Checked before anything is spent: OpenAlex answers no page past this one.
    if (page > LAST_PAGE) throw createError("VALIDATION_ERROR", `A search's results can be read up to page ${LAST_PAGE.toLocaleString("en")}. Narrow the search to reach the rest.`);
    const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId: id });
    if (!found.request) throw createError("VALIDATION_ERROR", "This search's query isn't valid. Fix it on the results page first.");
    const { works, total } = await readSearchPage<Work>(found.request, { page, size: RESULTS_PAGE, select: SCREENING_FIELDS }, (count) =>
      ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId: found.clerkId, count }),
    );
    await ctx.runMutation(internal.research.searches.counted, { userId, id, revision: found.revision, count: total });
    const papers = await keptByRating(ctx, userId, works.map(toPaper), found.ratingRange ? { min: found.ratingRange[0], max: found.ratingRange[1] } : undefined);
    return {
      total,
      page,
      pages: Math.min(Math.ceil(total / RESULTS_PAGE), LAST_PAGE),
      papers: papers.map((paper) => ({
        id: paper.openalexId,
        title: short(paper.title, SHOWN.title),
        ...(paper.authors?.length ? { authors: short(paper.authors.slice(0, 3).join(", ") + (paper.authors.length > 3 ? " and others" : ""), SHOWN.authors) } : {}),
        ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }),
        ...(paper.venue ? { venue: short(paper.venue, SHOWN.venue) } : {}),
        ...(paper.citedByCount === undefined ? {} : { citations: paper.citedByCount }),
        ...(paper.abstract ? { abstract: short(paper.abstract, SHOWN.abstract) } : {}),
      })),
    };
  },
});
export const results = userAction(resultsAction);
export const resultsForAssistant = assistantAction(resultsAction);
