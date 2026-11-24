/**
 * Papers, looked up without saving anything (#327). The saved-search tools (./searches.ts)
 * change what the person keeps and sees; these only read. With them the assistant answers
 * "what cites this paper" or "how many would that find" without making a search in the
 * person's history and deleting it again, which is what it did before it had them.
 */
import { paperLinkOf } from "../../lib/papers/paper-links";
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { countSearch, groupSearch, readWork } from "../paperSets/openalex";
import { ASSISTANT_FIELDS, spender, toPaper, type SavedSearchRequest, type Work } from "../paperSets/search";
import { readPage, short } from "./searches";
import { workUrl } from "../../lib/openalex/work-id";
import { abstractFromIndex } from "../../lib/papers/abstract-text";
import { AUTHORS_LISTED, countValidator, FUNDERS_LISTED, GROUPINGS, GROUPS_MAX, INSTITUTIONS_LISTED, pageValidator, paperPdfValidator, paperRecordValidator, RESULTS_PAGE, resultsValidator, searchSettings, SETTINGS, type Grouping } from "./searchValidators";
import { assistantPick, chatModel } from "../assistant/threads";
import { pricingOf } from "../ai/serverModel";
import { convertUsdToCredits, PAPER_PDF_CREDITS } from "../../lib/pricing";
import { PDF_PAGE_TOKENS } from "../../lib/assistant/files";
import { paperPdf } from "../lib/paperPdfs";
import { requirePdfModel } from "../assistant/files";
import { ownWork, paperIdOf, parsePaperKey, reportKey } from "../../lib/papers/paper-ref";
import { SEARCH_SOURCE_NAMES, sourceForId } from "../../lib/search/source";
import { parseSourceAddress } from "../../lib/evidence-libraries/source-address";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ChangeCall } from "../lib/userActions";
import type { screeningPaperInputValidator } from "../screening/validators";

export const searchAction = defineUserAction({
  path: "research/papers:search",
  description:
    "Searches the index for papers by a query, filters, or both, and saves nothing. Use it to look papers up or try a query. " +
    `Returns ${RESULTS_PAGE} papers a page, each with its ID, title, first authors with IDs and countries, year, venue, type, DOI, open access, citations and the start of its abstract, and how many match in all. ` +
    "The query is keywords, with AND, OR, NOT and quoted phrases. A quoted phrase holds no ? or *, which the index reads as wildcards: leave a title's question mark out. " +
    SETTINGS +
    " Each page read counts against the person's search allowance.",
  args: { query: v.optional(v.string()), ...searchSettings, page: pageValidator },
  returns: resultsValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, { userId, workspaceId }, { query, page, ...settings }): Promise<Infer<typeof resultsValidator>> => {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const found: SavedSearchRequest = await ctx.runQuery(internal.research.searches.requestFor, { userId, workspaceId, query, settings });
    return await readPage(ctx, userId, found, page ?? 1, "This query isn't one the index can read. Check its brackets and quotes.");
  },
});
export const search = userAction(searchAction);
export const searchForAssistant = assistantAction(searchAction);

/**
 * A group as the filter that narrows by it takes it, from OpenAlex's address for the group:
 * an author, a funder, a journal or an institution by its ID (`authors`, `funders`, `journals`,
 * `institutions`), a country, a language, a type or a goal by its code (`authorsIn` and `about`,
 * `languages`, `types`, `sdgs`), and a field as `researchAreas` has it, fields/33.
 */
const FILTER_ID: Partial<Record<Grouping, (key: string) => string>> = {
  author: (key) => key.split("/").at(-1)!,
  funder: (key) => key.split("/").at(-1)!,
  journal: (key) => key.split("/").at(-1)!,
  institution: (key) => key.split("/").at(-1)!,
  country: (key) => key.split("/").at(-1)!,
  language: (key) => key.split("/").at(-1)!,
  type: (key) => key.split("/").at(-1)!,
  sdg: (key) => key.split("/").at(-1)!,
  field: (key) => key.split("/").slice(-2).join("/"),
};

export const countAction = defineUserAction({
  path: "research/papers:count",
  description:
    "Counts the papers a query, filters, or both find in the index, and saves nothing. With `by`, also how they divide: by year, language, type, openAccess, country (where the authors work), author, institution, funder, journal, field or sdg. " +
    `It returns up to ${GROUPS_MAX} groups with how many papers each has: the largest first, or by year the latest ${GROUPS_MAX} in order. Use it for how many, how a topic changed over the years, who publishes most, which countries or languages, in one call, and never by reading pages of results. ` +
    "A group comes with the `id` the filter that narrows by it takes: `authors`, `funders`, `journals`, `institutions`, `authorsIn` or `about` for a country, `languages`, `types`, `sdgs`, and `researchAreas` for a field. The query and the filters are the ones research/papers:search takes, and mean the same. " +
    "One request against the person's search allowance.",
  args: { query: v.optional(v.string()), ...searchSettings, by: v.optional(v.union(...(Object.keys(GROUPINGS) as Grouping[]).map((name) => v.literal(name)), v.null())) },
  returns: countValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, { userId, workspaceId }, { query, by, ...settings }): Promise<Infer<typeof countValidator>> => {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const found: SavedSearchRequest = await ctx.runQuery(internal.research.searches.requestFor, { userId, workspaceId, query, settings });
    if (!found.request) throw createError("VALIDATION_ERROR", "This query isn't one the index can read. Check its brackets and quotes.");
    // Which papers a person rated is theirs, not OpenAlex's, so it can't count them.
    if (found.ratingRange) throw createError("VALIDATION_ERROR", "Papers kept by the person's ratings can't be counted this way. Leave `ratedOnly`, `minRating` and `maxRating` out.");
    const spend = spender(ctx, found.clerkId);
    if (!by) return { total: await countSearch(found.request, spend) };
    const { total, groups } = await groupSearch(found.request, GROUPINGS[by], spend);
    // Years read in order, and the latest are the ones asked about; anything else, largest first, as OpenAlex returns them.
    const ordered = by === "year" ? groups.sort((a, b) => Number(a.key) - Number(b.key)).slice(-GROUPS_MAX) : groups.slice(0, GROUPS_MAX);
    return {
      total,
      groups: ordered.map(({ key, name, count }) => ({ name: name.slice(0, NAME_MAX), count, ...(FILTER_ID[by] ? { id: FILTER_ID[by](key) } : {}) })),
      // OpenAlex returns its largest 200 groups, so how many more there are isn't known.
      ...(groups.length > ordered.length ? { moreGroups: true as const } : {}),
    };
  },
});
export const count = userAction(countAction);
export const countForAssistant = assistantAction(countAction);

/** Characters of an abstract a paper's record carries: all of nearly every one. A longer one is cut and marked as cut. */
const ABSTRACT_MAX = 6_000;
const NAME_MAX = 120;
/** A paper by its OpenAlex ID or its DOI, as OpenAlex's address for one work takes it. */
function workPath(id: string) {
  const given = id.trim();
  const work = workUrl(given);
  if (work) return work.split("/").at(-1)!;
  const own = ownWork(given);
  if (own) return own;
  // Any address that names a paper: Openscholar's own paper pages, with or without their title, included.
  const link = paperLinkOf(given);
  if (link?.kind === "work") return link.openalexId;
  if (link?.kind === "own") return link.work;
  // A DOI goes into the address as it is, so one that would change the address isn't taken: a "?" or "#", or a ".." that climbs out of the work's path.
  const doi = given.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)?(10\.\d{4,9}\/[^\s?#]+)$/i)?.[1];
  if (doi && !doi.split("/").some((part) => part === "." || part === "..")) return `https://doi.org/${doi}`;
  throw createError("VALIDATION_ERROR", "That isn't an address or ID Openscholar can read a paper from. Give its link, its ID (such as W2741809807) or its DOI.");
}

export const getAction = defineUserAction({
  path: "research/papers:get",
  description:
    "Reads one paper whole, by its ID as results give it (such as W2741809807), its DOI, or a link to it (Openscholar's paper pages included), or a report published on Openscholar by its key (such as R100012): its title, its authors with their IDs and where each works, year, venue, type, language, DOI, whether and where it's free to read, citations, who funded it, and all of its abstract. An abstract cut short ends in an ellipsis. " +
    "One request against the person's search allowance. An Evidence Community's record is read through evidenceLibraries/library:records instead, by its `paper` (library:<libraryId>:<key>).",
  args: { id: v.string() },
  returns: paperRecordValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, { userId }, { id }): Promise<Infer<typeof paperRecordValidator>> => {
    // A report published on Openscholar, by its key or its page's address, is read from where it is kept.
    const link = paperLinkOf(id.trim());
    const report = reportKey(id) ?? (link?.kind === "report" ? link.key : null);
    if (report) {
      const found: Infer<typeof paperRecordValidator> | null = await ctx.runQuery(internal.reports.paper.record, { key: report });
      // One still on its way has no public page yet: its workspace reads where it stands.
      if (!found) throw createError("NOT_FOUND", "Openscholar Reports has no live report by that key. A report not live yet (a draft, at its checks, waiting for review or ready to activate) is read with reports/flow:get in the workspace it belongs to.");
      return found;
    }
    const path = workPath(id);
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const { clerkId } = person;
    const source = sourceForId(path, await ctx.runQuery(internal.featureFlags.internal.searchSource, {}));
    const spend = spender(ctx, clerkId);
    const work = await readWork<Work & { ids?: { openalex?: string } }>(path, `${ASSISTANT_FIELDS},funders,ids`, spend, source);
    if (!work) throw createError("NOT_FOUND", `${SEARCH_SOURCE_NAMES[source]} has no paper by that ID.`);
    const paper = toPaper(work);
    // Our index lacks some abstracts OpenAlex has. The paper's page shows OpenAlex's then, so a read gives it too.
    const paired = !paper.abstract && source === "openscholar" ? work.ids?.openalex?.split("/").at(-1) : undefined;
    const abstract = paper.abstract ?? (paired ? await pairedAbstract(paired, spend) : undefined);
    const authors = (work.authorships ?? []).flatMap(({ author, institutions }) => {
      if (!author?.display_name) return [];
      const works = (institutions ?? []).flatMap(({ display_name: name, country_code: country }) => (name ? [`${name.slice(0, NAME_MAX)}${country ? ` (${country})` : ""}`] : []));
      return [{ name: author.display_name.slice(0, NAME_MAX), ...(author.id ? { id: author.id.split("/").at(-1)! } : {}), ...(works.length ? { institutions: works.slice(0, INSTITUTIONS_LISTED) } : {}) }];
    });
    const funders = (work.funders ?? []).flatMap(({ id: funder, display_name: name }) => (funder && name ? [{ name: name.slice(0, NAME_MAX), id: funder.split("/").at(-1)! }] : []));
    return {
      id: paperIdOf(paper.paper),
      title: paper.title,
      authors: authors.slice(0, AUTHORS_LISTED),
      ...(authors.length > AUTHORS_LISTED ? { moreAuthors: authors.length - AUTHORS_LISTED } : {}),
      ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }),
      ...(work.publication_date ? { published: work.publication_date } : {}),
      ...(paper.venue ? { venue: paper.venue } : {}),
      ...(work.type ? { type: work.type } : {}),
      ...(work.language ? { language: work.language } : {}),
      ...(paper.doi ? { doi: paper.doi.replace(/^https?:\/\/doi\.org\//, "") } : {}),
      ...(typeof work.open_access?.is_oa === "boolean" ? { openAccess: work.open_access.is_oa } : {}),
      ...(work.open_access?.oa_url ? { link: work.open_access.oa_url } : {}),
      ...(paper.pdfUrl ? { pdf: true as const } : {}),
      ...(paper.citedByCount === undefined ? {} : { citations: paper.citedByCount }),
      ...(funders.length ? { funders: funders.slice(0, FUNDERS_LISTED) } : {}),
      ...(abstract ? { abstract: short(abstract, ABSTRACT_MAX) } : {}),
    };
  },
});
export const get = userAction(getAction);

/** The abstract of the OpenAlex work a record of ours is paired with, if OpenAlex has one and can be read now. */
async function pairedAbstract(openalexId: string, spend: ReturnType<typeof spender>) {
  const work = await readWork<Work>(openalexId, "id,abstract_inverted_index", spend, "openalex").catch(() => null);
  return work?.abstract_inverted_index ? abstractFromIndex(work.abstract_inverted_index) : undefined;
}
export const getForAssistant = assistantAction(getAction);

/** Pages a paper's PDF is taken to have, for what reading it may cost. */
const PAPER_PAGES = 30;
/** The largest PDF a model's provider takes in a request: Claude's 32 MB, and no read holds more in memory. */
const PROVIDER_PDF_BYTES = 32 * 1024 * 1024;
/** Whether two titles name the same paper: the same words, or one the other's start, as a title with its subtitle is. */
function sameTitle(a: string, b: string) {
  const words = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const [x, y] = [words(a), words(b)];
  return x.length > 0 && y.length > 0 && (x.startsWith(y) || y.startsWith(x));
}

export const readPdfAction = defineUserAction({
  path: "research/papers:readPdf",
  description:
    "Reads a paper's open-access PDF, by its ID as results give it (such as W2741809807) or its DOI, with its `title` as they give it, which the person is shown when asked: you get the PDF itself, its text, tables and figures, for the rest of this reply. " +
    "Search results, a paper's record and the person's saved papers say `pdf` when the index knows of one; it may still hold a copy of one without. A paper in the person's Zotero library is read from there, with zotero/library:pdf. " +
    "An Evidence Community's record is read from the community, by its `paper` as evidenceLibraries/library:records gives it or by its page's address on the community, when that says `pdf`, or else from the index's copy when it has a paper ID. When none can be got, ask the person to attach its PDF to the chat. " +
    "The index sometimes links the wrong file: check the PDF is the paper you asked for, and if it isn't, say so and use nothing from it. " +
    "Cite what you take from it by page, as a link to its address with the page: [p. 7](PDF_ADDRESS#page=7). A later reply that needs it again reads it again. " +
    "The person is asked first, with what the read may cost. One request against the person's search allowance.",
  args: { id: v.string(), title: v.optional(v.string()) },
  returns: paperPdfValidator,
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  // The paper by its title where the model gave one: the person can't tell a paper by its ID.
  shown: ({ id, title }) => (title ? { title } : { id }),
  // What a paper of typical length costs to read on the chat's model, its tokens in the reply, with the most its PDF may cost: a copy from the store or from OpenAlex.
  estimate: async (ctx, { userId, workspaceId }, _args, chat) => {
    const thread = chat ? await ctx.db.get("assistantThreads", chat.threadId) : null;
    const { modelId } = thread ? await chatModel(ctx, thread, userId) : { modelId: (await assistantPick(ctx, { userId, workspaceId }))?.modelId ?? null };
    await requirePdfModel(ctx, modelId);
    const price = (await pricingOf(ctx, modelId)).input;
    return convertUsdToCredits({ usd: (PAPER_PAGES * PDF_PAGE_TOKENS * price) / 1_000_000 }) + PAPER_PDF_CREDITS;
  },
  run: async (ctx, { userId, workspaceId }, { id, title: asked }, call): Promise<Infer<typeof paperPdfValidator>> => {
    const ref = parsePaperKey(id.trim()) ?? (await libraryRecordAt(ctx, id));
    if (ref?.source === "library") return await libraryRecordPdf(ctx, { userId, workspaceId }, ref, asked, call);
    const path = workPath(id);
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const source = sourceForId(path, await ctx.runQuery(internal.featureFlags.internal.searchSource, {}));
    const work = await readWork<Work>(path, "id,display_name,title,doi,best_oa_location,primary_location,has_content", spender(ctx, person.clerkId), source);
    if (!work) throw createError("NOT_FOUND", `${SEARCH_SOURCE_NAMES[source]} has no paper by that ID.`);
    const { paper, title, pdfUrl } = toPaper(work);
    const openalexId = paperIdOf(paper);
    // The person was asked about the paper by the title the model gave: one that isn't this ID's reads nothing.
    if (asked && !sameTitle(asked, title)) throw createError("VALIDATION_ERROR", `${id} is "${title}" in the index, not "${asked}". Check the paper's ID, and read it again.`);
    // The model is sent the stored copy, never the file through here.
    const got = await paperPdf(ctx, { userId, workspaceId, scope: await chatScope(ctx, call), kind: "chat" }, { openalexId, doi: work.doi ?? undefined, url: pdfUrl ?? undefined, hasCopy: work.has_content?.pdf === true }, { maxBytes: PROVIDER_PDF_BYTES, bytes: false, charge: "self", allowHttp: true });
    if ("error" in got) throw createError(got.credits ? "INSUFFICIENT_CREDITS" : "VALIDATION_ERROR", `${got.error} Ask the person to attach its PDF to the chat.`);
    if (!got.key) throw createError("VALIDATION_ERROR", "This paper's PDF can't be kept to send. Ask the person to attach its PDF to the chat.");
    // A paper with no link of its own is cited at the address its copy was found at; one read from OpenAlex's copy
    // alone by its record, the only address of it a person can open.
    return { id: openalexId, title, paperPdf: pdfUrl ?? got.url ?? openalexId, stored: got.key };
  },
});
/** A record of a library OpenScholar runs, from its page's address (`<library>/lib/<key>`); null for any other address. */
async function libraryRecordAt(ctx: ActionCtx, address: string): Promise<{ source: "library"; libraryId: string; key: string } | null> {
  const parsed = parseSourceAddress(address.trim().slice(0, 4_000));
  if ("error" in parsed || !("records" in parsed.source) || parsed.source.records.length !== 1) return null;
  const libraryId: Id<"evidenceLibraries"> | null = await ctx.runQuery(internal.evidenceLibraries.sources.at, { origin: parsed.origin });
  return libraryId ? { source: "library", libraryId, key: parsed.source.records[0]! } : null;
}

/** A chat's scope for a paper's stored copy, which it pays for once; a read outside one pays each time. */
async function chatScope(ctx: ActionCtx, call: ChangeCall | undefined) {
  const step = call?.stepId ?? call?.from;
  const threadId = step ? await ctx.runQuery(internal.assistant.steps.chatOf, { stepId: step }) : null;
  return threadId ? `chat:${threadId}` : undefined;
}

/** An Evidence Library record's PDF, as the person may read the record: the library's own file, or OpenAlex's copy of the work. */
async function libraryRecordPdf(ctx: ActionCtx, payer: { userId: Id<"users">; workspaceId: Id<"workspaces"> }, ref: { libraryId: string; key: string }, asked: string | undefined, call: ChangeCall | undefined): Promise<Infer<typeof paperPdfValidator>> {
  const read: { papers: Array<Infer<typeof screeningPaperInputValidator>> } = await ctx.runAction(internal.evidenceLibraries.sourceActions.page, { libraryId: ref.libraryId as Id<"evidenceLibraries">, userId: payer.userId, source: { records: [ref.key] }, first: 1, last: 1 });
  const paper = read.papers[0];
  if (!paper) throw createError("NOT_FOUND", "The community shows no record by that key.");
  if (asked && !sameTitle(asked, paper.title)) throw createError("VALIDATION_ERROR", `That record is "${paper.title}" in the community, not "${asked}". Check its key, and read it again.`);
  const openalexId = paper.crossRefs?.openalexId;
  if (!paper.pdfUrl && !openalexId) throw createError("VALIDATION_ERROR", "The community lets readers download no PDF of this record. Ask the person to attach its PDF to the chat.");
  // The library's own file when it has one, and nothing else in its place, so the page citations open the PDF read.
  const from = paper.pdfUrl ? { url: paper.pdfUrl } : { openalexId, doi: paper.crossRefs?.doi };
  const got = await paperPdf(ctx, { ...payer, scope: await chatScope(ctx, call), kind: "chat" }, from, { maxBytes: PROVIDER_PDF_BYTES, bytes: false, charge: "self", allowHttp: true });
  if ("error" in got) throw createError(got.credits ? "INSUFFICIENT_CREDITS" : "VALIDATION_ERROR", `${got.error} Ask the person to attach its PDF to the chat.`);
  if (!got.key) throw createError("VALIDATION_ERROR", "This record's PDF can't be kept to send. Ask the person to attach its PDF to the chat.");
  return { id: paper.paper, title: paper.title, paperPdf: paper.pdfUrl ?? workUrl(openalexId!) ?? paper.paper, stored: got.key };
}

export const readPdf = userAction(readPdfAction);
export const readPdfForAssistant = assistantAction(readPdfAction);
