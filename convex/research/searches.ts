/**
 * The assistant's tools for saved searches (#327): make one, change its query and filters,
 * put it back, and read a page of its results. They take a search as plain settings and map
 * them onto the saved search's own fields, then go through `applyCommand` like every other
 * change, so the person's open page follows and each change has its undo (#342).
 */
import { v, type GenericValidator, type Infer, type ObjectType } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, assistantMutation, defineUserAction, defineUserMutation, reversedBy, userAction, userMutation } from "../lib/userActions";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "../lib/functions";
import { countSearch, PAGE_ORDERED_SORT, readSearchPage } from "../paperSets/openalex";
import { ASSISTANT_FIELDS, keptByRating, requestOf, savedSearchValidator, toPaper, type SavedSearchRequest, type SearchPaper, type Work } from "../paperSets/search";
import { COUNTRY_HIERARCHY, getCountryCodesForRegions, MIN_YEAR } from "../../lib/constants";
import { authorFilterValue } from "../../lib/openalex/author-filter";
import { INSTITUTION_TYPES, WORK_LANGUAGES, WORK_TYPES } from "../../lib/openalex/vocabulary";
import { currentSearch, type SavedSearch, type UndoCommand } from "../../lib/research/records";
import { applyCommand, findSearch, revisionRow } from "./records";
import { AUTHORS_SHOWN, changesValidator, COUNTRIES_SHOWN, LAST_PAGE, LAST_PAGE_FROM_START, pageValidator, RESULTS_PAGE, resultsValidator, searchSettings, SETTINGS } from "./searchValidators";
import type { Id } from "../_generated/dataModel";

const CREATE = "research/searches:create" as const;
const UPDATE = "research/searches:update" as const;
const RESTORE = "research/searches:restore" as const;
const REMOVE = "research/searches:remove" as const;
const DELETE = "research/searches:deleteSearch" as const;

const SORTS = { relevance: "relevance_score:desc", most_cited: "cited_by_count:desc", newest: "publication_date:desc", oldest: "publication_date:asc" } as const;
/**
 * Characters of each text a results page carries, so ten whole papers stay within what the
 * model reads at once. The abstract is long enough to tell what a paper studied and how:
 * from its first 180 characters, the model couldn't say a paper's method or setting.
 */
export const SHOWN = { title: 160, author: 30, name: 60, venue: 60, abstract: 600 };
export const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
/** A name the `authors` filter can search by: whole when it's short, its leading whole words when it isn't. */
export const leading = (name: string, max: number) => (name.length > max ? name.slice(0, max).replace(/\s+\S*$/, "") : name);

type Settings = ObjectType<typeof searchSettings>;

const needsQuery = () => createError("VALIDATION_ERROR", "A search needs a query, or a filter to search by.");
/** The fields that narrow a search by themselves, so it can do without a query: its page searches by a filter alone too. */
const NARROWS = ["authors", "funders", "researchAreas", "selectedRegions", "selectedCountryFocus", "workTypes", "workLanguages", "institutionTypes", "sdgs", "citesItemId", "citedByItemId", "relatedToItemId", "dateRange", "yearRange", "minCitations", "openAccessOnly", "hasAbstract", "reviewFilter", "onlyRatedPapers"] as const;
// A citation minimum of none is no filter: the request leaves it out.
const off = (value: unknown) => value === undefined || value === false || value === 0 || value === "" || (Array.isArray(value) && !value.length);
const narrowed = (search: Partial<SavedSearch>) => Boolean(search.query?.trim()) || NARROWS.some((field) => !off(search[field]));

/** A search from a query and settings, as one is first saved. */
function newSearch(id: string, query: string | undefined, settings: Settings): SavedSearch {
  const now = new Date().toISOString();
  const search: SavedSearch = {
    id,
    query: query?.trim() ?? "",
    field: "title_and_abstract",
    // Counted right after it's made (`recount`).
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
  if (!narrowed(search)) throw needsQuery();
  return search;
}
const authorValidator = v.union(v.literal("user"), v.literal("assistant"));

// A declared function, so a call to it ends the branch for the type checker as a `throw` does.
function invalid(message: string): never {
  throw createError("VALIDATION_ERROR", message);
}

type Region = { label: string; children?: Region[] };
/** The regions the page's two geographic filters name, as it names them: africa, western_africa, and so on. */
const REGIONS = (function names(region: Region): string[] {
  return region.children?.length ? [region.label.toLowerCase().replace(/\s+/g, "_"), ...region.children.flatMap(names)] : [];
})(COUNTRY_HIERARCHY);
/** Countries the page lets one filter on where authors work reach: OpenAlex takes no more in one request. */
const AUTHOR_COUNTRIES_MAX = 100;

/** Places as the saved search keeps them: a region by its name on the page, a country by its two-letter code. */
function places(given: string[], setting: string) {
  return given.map((value) => {
    const place = value.trim().length === 2 ? value.trim().toUpperCase() : value.trim().toLowerCase().replace(/\s+/g, "_");
    if (!getCountryCodesForRegions([place], true).totalCount) invalid(`"${value}" isn't a place \`${setting}\` takes. Give a two-letter country code, or one of these regions: ${REGIONS.join(", ")}.`);
    return place;
  });
}

/** Values as one of the page's own lists has them, or a refusal that says what it takes. */
const among = (allowed: readonly string[], setting: string) => (given: string[]) =>
  given.map((value) => {
    const found = allowed.find((one) => one === value.trim().toLowerCase());
    if (!found) invalid(`"${value}" isn't one of \`${setting}\`. It takes: ${allowed.join(", ")}.`);
    return found;
  });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A day the calendar has: 2025-02-30 parses, as the 2nd of March, and the page then can't read the search. */
const isDay = (day: string) => {
  const at = DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day;
};

/** An OpenAlex ID of one kind, bare, from the ID or the address it was given as. */
const openAlexId = (letter: string) => (value: string) => value.trim().match(new RegExp(`^(?:https?://openalex\\.org/(?:[a-z]+/)?)?(${letter}\\d+)$`, "i"))?.[1].toUpperCase();
const workId = openAlexId("W");
const funderId = openAlexId("F");
/** A research area as the page's filter keeps it: a domain, field or subfield by its path, a topic by its ID. */
const AREA = /^(?:(?:domains|fields|subfields)\/\d+|T\d+)$/;
const LOOK_UP = "Find it with research/lookup:find.";

/** The settings that are lists, the saved search's field each one is, and how its values are checked. */
const LISTS = [
  ["authors", "authors", (given: string[]) => given.map((value) => authorFilterValue(value) ?? invalid("An author is an ID, such as A5023888391, or a name."))],
  ["funders", "funders", (given: string[]) => given.map((value) => funderId(value) ?? invalid(`"${value}" isn't a funder's ID, such as F4320332161. ${LOOK_UP}`))],
  ["researchAreas", "researchAreas", (given: string[]) => given.map((value) => (AREA.test(value.trim()) ? value.trim() : invalid(`"${value}" isn't a research area's ID, such as fields/33 or T13958. ${LOOK_UP}`)))],
  ["authorsIn", "selectedRegions", (given: string[]) => places(given, "authorsIn")],
  ["about", "selectedCountryFocus", (given: string[]) => places(given, "about")],
  ["types", "workTypes", among(WORK_TYPES.map((type) => type.id), "types")],
  ["languages", "workLanguages", among(WORK_LANGUAGES, "languages")],
  ["institutionTypes", "institutionTypes", among(INSTITUTION_TYPES.map((type) => type.id), "institutionTypes")],
] as const;


/**
 * Plain settings as the saved search's own fields: what to set, and what to take off.
 * `current` is the search being changed, whose year range fills in a year left out.
 */
function savedFields(settings: Settings, current?: SavedSearch) {
  const fields: Partial<SavedSearch> = {};
  const clear: string[] = [];
  const thisYear = new Date().getFullYear();
  if (settings.field !== undefined) fields.field = settings.field;
  // Exact days and whole years are the page's two ways of giving a time span: it filters by the one last set.
  // A call gives one of them. The other's ends, taken off or left out, go with it, so the search moves across whole.
  const [days, years] = [settings.fromDate != null || settings.toDate != null, settings.fromYear != null || settings.toYear != null];
  if (days && years) invalid("Give the time span as years or as exact days, not both.");
  if (years) clear.push("dateRange");
  else if (settings.fromDate !== undefined || settings.toDate !== undefined) {
    const [from, to] = [settings.fromDate === undefined ? current?.dateRange?.from : settings.fromDate, settings.toDate === undefined ? current?.dateRange?.to : settings.toDate];
    for (const day of [from, to]) if (day != null && !isDay(day)) invalid("A day is written YYYY-MM-DD, and is one the calendar has.");
    if (from && to && from > to) invalid("The first day is after the last.");
    fields.filterType = "date";
    if (from == null && to == null) clear.push("dateRange");
    else fields.dateRange = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  for (const [setting, field, checked] of LISTS) {
    const given = settings[setting];
    if (given === undefined) continue;
    // The page keeps an empty list for a filter that's off.
    const values = given === null ? [] : [...new Set(checked(given))];
    if (setting === "authorsIn" && getCountryCodesForRegions(values).isLimitExceeded) {
      invalid(`\`authorsIn\` reaches at most ${AUTHOR_COUNTRIES_MAX} countries at once. Give smaller regions, or countries.`);
    }
    fields[field] = values;
  }
  if (settings.sdgs !== undefined) {
    const goals = settings.sdgs ?? [];
    if (goals.some((goal) => !Number.isInteger(goal) || goal < 1 || goal > 17)) invalid("An SDG is its goal's number, 1 to 17.");
    fields.sdgs = [...new Set(goals)].map(String);
  }
  for (const [setting, field] of [["citationsOf", "citesItemId"], ["referencesOf", "citedByItemId"], ["relatedTo", "relatedToItemId"]] as const) {
    const given = settings[setting];
    if (given === undefined) continue;
    // The page keeps an empty ID for one that's off.
    fields[field] = given === null ? "" : (workId(given) ?? invalid(`\`${setting}\` takes one paper's ID, such as W2741809807, as a search's results give it.`));
  }
  if (settings.includeRetracted !== undefined) fields.includeRetracted = settings.includeRetracted;
  if (settings.ratedOnly !== undefined) fields.onlyRatedPapers = settings.ratedOnly;
  if (settings.minRating !== undefined || settings.maxRating !== undefined) {
    // Left out, an end stays as it is. Taken off, it goes back to the end of the scale, which keeps every rating.
    const [min, max] = [settings.minRating === undefined ? (current?.ratingRange?.[0] ?? 0) : (settings.minRating ?? 0), settings.maxRating === undefined ? (current?.ratingRange?.[1] ?? 5) : (settings.maxRating ?? 5)];
    if (![min, max].every((rating) => Number.isInteger(rating) && rating >= 0 && rating <= 5) || min > max) invalid("Ratings are whole numbers from 0 to 5, the lowest first.");
    fields.ratingRange = [min, max];
    // The page reads a range only while it keeps rated papers alone, so a bound given turns that on.
    if (settings.ratedOnly === undefined && (settings.minRating != null || settings.maxRating != null)) fields.onlyRatedPapers = true;
  }
  for (const year of [settings.fromYear, settings.toYear]) {
    if (year != null && (!Number.isInteger(year) || year < MIN_YEAR || year > thisYear)) throw createError("VALIDATION_ERROR", `A year is a whole number from ${MIN_YEAR} to ${thisYear}.`);
  }
  if (days || settings.fromYear !== undefined || settings.toYear !== undefined) {
    const [from, to] = [settings.fromYear === undefined ? current?.yearRange?.[0] : settings.fromYear, settings.toYear === undefined ? current?.yearRange?.[1] : settings.toYear];
    if (days || (from == null && to == null)) {
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
    "Makes a saved search in the person's account from a query, filters, or both, which shows in their search history at once. For when they ask for a search to keep: to look papers up, use research/papers:search, which saves nothing. " +
    "It doesn't run the search: read its results with research/searches:results. The query is keywords, with AND, OR, NOT and quoted phrases. " +
    SETTINGS +
    " Returns the search's ID, and `undo`, which deletes it while nothing has been done with it.",
  args: { query: v.optional(v.string()), ...searchSettings },
  returns: v.object({ id: v.string(), undo: reversedBy(REMOVE, { id: v.string(), expect: madeHere }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { query, ...settings }, author) => {
    const search = newSearch(crypto.randomUUID(), query, settings);
    const undo = await applyCommand(ctx, userId, { kind: "createSearch", search }, author);
    await ctx.scheduler.runAfter(0, internal.research.searches.recount, { userId, id: search.id, author });
    return { id: search.id, ...(undo?.kind === "deleteSearch" ? { undo: { path: REMOVE, args: { id: undo.id, expect: { created: undo.expect.created, revision: undo.expect.revision } } } } : {}) };
  },
});
export const create = userMutation(createAction);
export const createForAssistant = assistantMutation(createAction);

/** Whether a value is one a setting's validator takes. */
function fits(validator: GenericValidator, value: unknown): boolean {
  switch (validator.kind) {
    case "union":
      return validator.members.some((member) => fits(member, value));
    case "literal":
      return value === validator.value;
    case "null":
      return value === null;
    case "string":
      return typeof value === "string";
    case "float64":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value) && value.every((inner) => fits(validator.element, inner));
    default:
      return false;
  }
}
/** What a setting takes, in words, for the refusal of a value it doesn't. */
function takes(validator: GenericValidator): string {
  switch (validator.kind) {
    case "union":
      return [...new Set(validator.members.map(takes))].join(" or ");
    case "literal":
      return JSON.stringify(validator.value);
    case "array":
      return `a list of ${takes(validator.element)}`;
    case "float64":
      return "a number";
    case "boolean":
      return "true or false";
    case "string":
      return "text";
    default:
      return validator.kind;
  }
}

/**
 * The settings a list of changes gives, checked as the settings' own validators would have.
 * Two slips are read as what they mean: one value where a list goes is a list of one, and
 * null for a switch turns it off.
 */
function settingsOf(changes: Infer<typeof changesValidator>) {
  const settings: Record<string, unknown> = {};
  let query: string | undefined;
  for (const { setting, value } of changes) {
    if (setting === "query") {
      // No query at all leaves a search by its filters alone.
      query = typeof value === "string" ? value : value === null ? "" : invalid("`query` takes text.");
      continue;
    }
    const validator = searchSettings[setting];
    const given = fits(validator, value) ? value : value !== null && fits(validator, [value]) ? [value] : value === null && fits(validator, false) ? false : invalid(`\`${setting}\` takes ${takes(validator)}.`);
    settings[setting] = given;
  }
  return { query, settings: settings as Settings };
}

export const updateAction = defineUserMutation({
  path: UPDATE,
  description:
    "Changes a saved search: its query, its filters, or both. Give only what changes, as a list: each change names one setting and its new value, and a value of null takes a filter off. Every setting left out of the list stays as it is. " +
    "The person's open page follows, from its first page of results. `query` is the search's words, which a search with a filter can do without. " +
    SETTINGS +
    " " +
    "Returns `undo`, which puts the search back as it was before this change. It is refused if the search changed again in between.",
  args: { id: v.string(), changes: changesValidator },
  returns: v.object({ undo: reversedBy(RESTORE, restoreArgs) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // A change is undone by restoring the revision before it. A search from before revisions were kept has none to go back to.
  asksFirst: async (ctx, userId, { id }) => {
    const found = await findSearch(ctx, userId, id);
    return found !== null && (await revisionRow(ctx, found._id, found.revision)) === null;
  },
  run: async (ctx, userId, { id, changes }, author) => {
    const { query, settings } = settingsOf(changes);
    const found = await findSearch(ctx, userId, id);
    if (!found) throw createError("NOT_FOUND", "Search not found.");
    const current = currentSearch(found.data);
    const { fields: { field = current.field, ...filters }, clear } = savedFields(settings, current);
    const asked = query?.trim() ?? current.query;
    if (!narrowed({ ...current, ...filters, ...Object.fromEntries(clear.map((key) => [key, undefined])), query: asked })) throw needsQuery();
    // A new query, or the same one read in another field, is one more query the search has had, so it's its own edit.
    const requeried = asked !== current.query || field !== current.field;
    // A filter that's off is kept as nothing, false, an empty list or an empty ID: taking one off that's already off changes nothing.
    const kept = (value: unknown) => (value === undefined || value === false || value === "" || (Array.isArray(value) && !value.length) ? "off" : JSON.stringify(value));
    const refiltered = Object.entries(filters).some(([key, value]) => kept(current[key as keyof SavedSearch]) !== kept(value)) || clear.some((key) => current[key as keyof SavedSearch] !== undefined);
    if (!requeried && !refiltered) return {};
    const edits: Array<UndoCommand | undefined> = [];
    if (requeried) edits.push(await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "query", query: asked, field } }, author));
    // Its results start again from their first page, as they do when the person changes the search on its page.
    const patch = { ...filters, ...(current.page !== undefined && current.page !== 1 ? { page: 1 } : {}) };
    if (Object.keys(patch).length || clear.length) edits.push(await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "patch", fields: patch, clear } }, author));
    // The count it held was the old query's and filters'.
    await ctx.scheduler.runAfter(0, internal.research.searches.recount, { userId, id, author });
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
    "Takes back a saved search that research/searches:create just made, as its undo: `expect` is the search as its creation left it, and the search stays if anything has been done with it since. Only for that undo: any other search goes with research/searches:deleteSearch.",
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

export const deleteAction = defineUserMutation({
  path: DELETE,
  description: "Deletes one of the person's saved searches for good, with its earlier queries and its screening answers. It can't be undone, so the person is asked first.",
  args: { id: v.string() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  // Nothing brings back a search's history and answers, so the person is asked.
  undoable: false,
  run: async (ctx, userId, { id }, author) => {
    if (!(await findSearch(ctx, userId, id))) throw createError("NOT_FOUND", "Search not found.");
    await applyCommand(ctx, userId, { kind: "deleteSearch", id }, author);
    return null;
  },
});
export const deleteSearch = userMutation(deleteAction);
export const deleteSearchForAssistant = assistantMutation(deleteAction);

/** The request a search with this query and these settings would make, saved nowhere: for trying one (./papers.ts). */
export const requestFor = internalQuery({
  args: { userId: v.id("users"), query: v.optional(v.string()), settings: v.object(searchSettings) },
  returns: savedSearchValidator,
  handler: async (ctx, { userId, query, settings }) => requestOf(ctx, userId, newSearch("unsaved", query, settings), 0),
});

/** A paper as a page of results gives it. */
function shownPaper(work: Work, paper: SearchPaper) {
  // An author OpenAlex has a record for comes with their ID, which the `authors` filter takes. One it has none for is filtered by name, so that name comes as words to search by.
  const authors = (work.authorships ?? []).flatMap(({ author }) => (author?.display_name ? [author.id ? { name: short(author.display_name, SHOWN.author), id: author.id.split("/").at(-1)! } : { name: leading(author.display_name, SHOWN.name) }] : []));
  const countries = [...new Set((work.authorships ?? []).flatMap(({ institutions }) => (institutions ?? []).flatMap(({ country_code: country }) => (country ? [country] : []))))];
  return {
    id: paper.openalexId,
    title: short(paper.title, SHOWN.title),
    ...(authors.length ? { authors: authors.slice(0, AUTHORS_SHOWN) } : {}),
    ...(authors.length > AUTHORS_SHOWN ? { moreAuthors: authors.length - AUTHORS_SHOWN } : {}),
    ...(countries.length ? { countries: countries.slice(0, COUNTRIES_SHOWN) } : {}),
    ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }),
    ...(paper.venue ? { venue: short(paper.venue, SHOWN.venue) } : {}),
    ...(work.type ? { type: work.type } : {}),
    ...(paper.doi ? { doi: paper.doi.replace(/^https?:\/\/doi\.org\//, "") } : {}),
    ...(typeof work.open_access?.is_oa === "boolean" ? { openAccess: work.open_access.is_oa } : {}),
    ...(paper.citedByCount === undefined ? {} : { citations: paper.citedByCount }),
    ...(paper.abstract ? { abstract: short(paper.abstract, SHOWN.abstract) } : {}),
  };
}

/**
 * A page of the papers a request finds, as the model reads them, in the order its results
 * page lists them. Each request counts against the person's OpenAlex allowance.
 */
export async function readPage(ctx: ActionCtx, userId: Id<"users">, found: SavedSearchRequest, page: number, notValid: string): Promise<Infer<typeof resultsValidator>> {
  if (!Number.isInteger(page) || page < 1) throw createError("VALIDATION_ERROR", "Pages count from 1.");
  if (!found.request) throw createError("VALIDATION_ERROR", notValid);
  // Checked before anything is spent. OpenAlex answers no numbered page past the last, and a sort read from the start costs a request for every 200 works.
  const lastPage = found.request.sort === PAGE_ORDERED_SORT ? LAST_PAGE : LAST_PAGE_FROM_START;
  if (page > lastPage) throw createError("VALIDATION_ERROR", `These results can be read up to page ${lastPage.toLocaleString("en")}. Narrow the search to reach the rest.`);
  const { works, total } = await readSearchPage<Work>(found.request, { page, size: RESULTS_PAGE, select: ASSISTANT_FIELDS }, (count) => ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId: found.clerkId, count }));
  const papers = await keptByRating(ctx, userId, works.map(toPaper), found.ratingRange ? { min: found.ratingRange[0], max: found.ratingRange[1] } : undefined);
  const read = new Map(works.map((work) => [work.id, work]));
  return { total, page, pages: Math.min(Math.ceil(total / RESULTS_PAGE), lastPage), papers: papers.map((paper) => shownPaper(read.get(paper.openalexId)!, paper)) };
}

/**
 * Keeps how many results a search has, as its results page does when it reads them, so the
 * search history shows it. Left alone when the search changed while its results were read.
 */
export const counted = internalMutation({
  args: { userId: v.id("users"), id: v.string(), revision: v.number(), count: v.number(), author: authorValidator },
  returns: v.null(),
  handler: async (ctx, { userId, id, revision, count, author }) => {
    const found = await findSearch(ctx, userId, id);
    if (found?.revision === revision && currentSearch(found.data).count !== count) await applyCommand(ctx, userId, { kind: "editSearch", id, edit: { kind: "patch", fields: { count }, clear: [] } }, author);
    return null;
  },
});

/**
 * Counts a search these tools just made or changed, so its history, and what can be
 * screened from it, go by its new query and filters whether or not its page is open. One
 * request for one work, from the person's allowance. A search that can't be counted now
 * keeps the count it has until its results are next read.
 */
export const recount = internalAction({
  args: { userId: v.id("users"), id: v.string(), author: authorValidator },
  returns: v.null(),
  handler: async (ctx, { userId, id, author }) => {
    try {
      const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId: id });
      if (!found.request) return null;
      const count = await countSearch(found.request, (pages) => ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId: found.clerkId, count: pages }));
      await ctx.runMutation(internal.research.searches.counted, { userId, id, revision: found.revision, count, author });
    } catch (error) {
      console.error("[research] couldn't count a search after it changed", { id, error: error instanceof Error ? error.message : String(error) });
    }
    return null;
  },
});

export const resultsAction = defineUserAction({
  path: "research/searches:results",
  description:
    `Reads a page of a saved search's results from OpenAlex, ${RESULTS_PAGE} papers a page: each paper's ID, title, first authors with their IDs, the countries they work in, year, venue, type, DOI, whether it's open access, citations and the start of its abstract, with how many results the search has in all. ` +
    "The papers come in the order the search's own page lists them. A search that keeps only papers the person rated returns those of each page's papers, and its total counts the papers before that filter. " +
    "Reading counts against the person's OpenAlex allowance: one request a page by relevance, and under any other sort one for every 200 results up to the page.",
  args: { id: v.string(), page: pageValidator },
  returns: resultsValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It only keeps the search's result count, as reading the results page does: nothing to undo.
  undoable: true,
  run: async (ctx, userId, { id, page }, author): Promise<Infer<typeof resultsValidator>> => {
    const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId: id });
    const read = await readPage(ctx, userId, found, page ?? 1, "This search's query isn't valid. Fix it on the results page first.");
    await ctx.runMutation(internal.research.searches.counted, { userId, id, revision: found.revision, count: read.total, author });
    return read;
  },
});
export const results = userAction(resultsAction);
export const resultsForAssistant = assistantAction(resultsAction);
