/**
 * An Evidence Library's records as a person's source (plans/evidence-library-sources): what each
 * library they read lists for them, and what a pasted library address points at. The library
 * decides what the person may read: these ask it as them (./sourceActions.ts).
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { linkLabel } from "../assistant/links";
import { createError } from "../lib/errors";
import { assistantAction, defineChangingAction, defineUserAction, reversedBy, userAction } from "../lib/userActions";
import type { screeningPaperInputValidator } from "../screening/validators";
import { LIBRARY_COLLECTION_DESCRIPTION_MAX, LIBRARY_COLLECTION_NAME_MAX, parseSourceAddress } from "../../lib/evidence-libraries/source-address";
import { paperPage, parsePaperKey } from "../../lib/papers/paper-ref";
import { LIBRARY_CHANGE_MAX } from "./sourceClient";
import { ABSTRACT_SHOWN, AUTHORS_SHOWN, READ_LIBRARIES_MAX, RECORDS_PAGE, librariesContentsValidator, libraryContentsValidator, libraryRecordValidator, libraryRecordsValidator, librarySourceRowValidator, librarySourceValidator, sourceAddressErrorValidator } from "./validators";

const reads = { spendsCredits: false, outsideEffect: false, undoable: true } as const;
const SET = 'Screen or extract a row\'s records with the set { kind: "evidenceLibrary", libraryId, source }, where `records` is how many it holds now.';

export const sourcesAction = defineUserAction({
  path: "evidenceLibraries/library:sources",
  description:
    `What each of the given Evidence Libraries (from evidenceLibraries/readers:list, at most ${READ_LIBRARIES_MAX}) offers the person as a source of records, each library asked as them: ` +
    "all its records (`what: \"all\"`), their own collections there (`yours`), the ones shared with them (`shared`), and the library's own collections (`library`, with the collection it sits in as `parent`). " +
    `A library that couldn't list them says why in \`problem\`: \`outdated\` needs an update, \`unreadable\` didn't answer. ${SET}`,
  args: { libraryIds: v.array(v.id("evidenceLibraries")) },
  returns: librariesContentsValidator,
  ...reads,
  run: async (ctx, { userId }, { libraryIds }): Promise<Array<Infer<typeof libraryContentsValidator>>> =>
    await ctx.runAction(internal.evidenceLibraries.sourceActions.sources, { userId, libraryIds: [...new Set(libraryIds)].slice(0, READ_LIBRARIES_MAX) }),
});
export const sources = userAction(sourcesAction);
export const sourcesForAssistant = assistantAction(sourcesAction);

const libraryValidator = v.object({ libraryId: v.id("evidenceLibraries"), name: v.string(), address: v.string(), faviconUrl: v.union(v.string(), v.null()) });
export const describedValidator = v.union(v.object({ row: librarySourceRowValidator, library: libraryValidator }), v.object({ error: sourceAddressErrorValidator }));
type Described = Infer<typeof describedValidator>;

/** A source of a library as the person may read it, with the library it is in; or why it is none. */
export async function described(ctx: ActionCtx, userId: Id<"users">, libraryId: Id<"evidenceLibraries">, source: Infer<typeof librarySourceValidator>): Promise<Described> {
  const library: { name: string; address: string; faviconUrl: string | null } | null = await ctx.runQuery(internal.evidenceLibraries.readers.running, { libraryId });
  if (!library) return { error: "notHosted" };
  const found: { row: Infer<typeof librarySourceRowValidator> } | { error: Infer<typeof sourceAddressErrorValidator> } = await ctx.runAction(internal.evidenceLibraries.sourceActions.describe, { libraryId, userId, source });
  return "error" in found ? found : { row: found.row, library: { libraryId, ...library } };
}

export const addressAction = defineUserAction({
  path: "evidenceLibraries/library:address",
  description:
    "What an address of any Evidence Library OpenScholar runs points at, as a source of records the person may read: the whole library, a search with its filters and order, one of the library's collections, a reader's collection (theirs, shared with them, or a public one), a search inside one, or a record. " +
    "Or why it is none: `notAddress`, `notHosted` (no library OpenScholar runs), `private` (a collection they may not read), `notFound`, `profile` (a reader's page: give one of their collections), `unknownPage`, `outdated` (the library needs an update) or `unreadable` (it didn't answer). " +
    SET,
  args: { address: v.string() },
  returns: describedValidator,
  ...reads,
  run: async (ctx, { userId }, { address }): Promise<Described> => {
    const parsed = parseSourceAddress(address.slice(0, 4_000));
    if ("error" in parsed) return parsed;
    const libraryId: Id<"evidenceLibraries"> | null = await ctx.runQuery(internal.evidenceLibraries.sources.at, { origin: parsed.origin });
    return libraryId ? await described(ctx, userId, libraryId, parsed.source) : { error: "notHosted" };
  },
});
export const address = userAction(addressAction);
export const addressForAssistant = assistantAction(addressAction);

export const sourceAction = defineUserAction({
  path: "evidenceLibraries/library:source",
  description: `One source of an Evidence Library as the person may read it now, with how many records it holds, or why it is none (as evidenceLibraries/library:address says). ${SET}`,
  args: { libraryId: v.id("evidenceLibraries"), source: librarySourceValidator },
  returns: describedValidator,
  ...reads,
  run: async (ctx, { userId }, { libraryId, source }): Promise<Described> => await described(ctx, userId, libraryId, source),
});
export const source = userAction(sourceAction);
export const sourceForAssistant = assistantAction(sourceAction);

/** A record as the assistant reads it, with the link a reply writes for it. */
function recordOf(paper: Infer<typeof screeningPaperInputValidator>, address: string, whole: boolean): Infer<typeof libraryRecordValidator> {
  const ref = parsePaperKey(paper.paper);
  const page = paperPage(paper.paper, { libraryAddress: address });
  const authors = paper.authors ?? [];
  return {
    paper: paper.paper,
    key: ref?.source === "library" ? ref.key : paper.paper,
    title: paper.title,
    authors: authors.slice(0, AUTHORS_SHOWN),
    ...(authors.length > AUTHORS_SHOWN ? { moreAuthors: authors.length - AUTHORS_SHOWN } : {}),
    ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }),
    ...(paper.venue ? { venue: paper.venue } : {}),
    ...(paper.workType ? { type: paper.workType } : {}),
    ...(paper.crossRefs?.doi ? { doi: paper.crossRefs.doi } : {}),
    ...(paper.crossRefs?.openalexId ? { openalexId: paper.crossRefs.openalexId } : {}),
    ...(paper.abstract ? { abstract: whole || paper.abstract.length <= ABSTRACT_SHOWN ? paper.abstract : `${paper.abstract.slice(0, ABSTRACT_SHOWN)}…` } : {}),
    pdf: paper.pdfUrl !== undefined,
    ...(page ? { link: `[${linkLabel(paper.title)}](${page})` } : {}),
  };
}

/** A record's key in its library, given as the key or as the paper OpenScholar names it (`library:<libraryId>:<key>`). */
function recordKey(libraryId: Id<"evidenceLibraries">, value: string) {
  const ref = parsePaperKey(value.trim());
  if (ref?.source !== "library") return value.trim();
  // Another library's record isn't this one's, whatever its key is here.
  if (ref.libraryId !== libraryId) throw createError("VALIDATION_ERROR", `${value.trim()} is a record of another Evidence Library: use that library's ID with it.`);
  return ref.key;
}

/** A library that is running, by its name and address; one that isn't is refused. */
async function runningLibrary(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">) {
  const library: { name: string; address: string } | null = await ctx.runQuery(internal.evidenceLibraries.readers.running, { libraryId });
  if (!library) throw createError("NOT_FOUND", "This Evidence Library isn't running.");
  return library;
}

export const recordsAction = defineUserAction({
  path: "evidenceLibraries/library:records",
  description:
    `Reads records of an Evidence Library as the person may read them, up to ${RECORDS_PAGE} from \`start\` (0 first), in the source's order: \`total\` is how many it holds, \`next\` where the next \`start\` is when there are more. ` +
    "The source is one the library offers (evidenceLibraries/library:sources and :address give them): the whole library, one of its collections, a reader's collection, records by key (`{ records: [key] }`, whose abstracts come whole), or a search, " +
    "`{ search }`, the library search page's query string, such as `search=peer+tutoring&sort=mostCited`: `search` its words; `sort` relevance (the default), desc (newest first), asc, mostCited, leastCited, titleAZ, titleZA, authorAZ or authorZA; `collections` a library collection's key; `type` an item type; with `readerCollection` too it searches that reader's collection. " +
    "Each record's `paper`, as OpenScholar names it (research/papers:readPdf reads its PDF when `pdf` is true), its `key` in the library, title, first authors, year, venue, type, DOI, OpenAlex ID, abstract (its start, on a page of a source) and `link`. " +
    SET,
  args: { libraryId: v.id("evidenceLibraries"), source: librarySourceValidator, start: v.optional(v.union(v.number(), v.null())) },
  returns: libraryRecordsValidator,
  ...reads,
  run: async (ctx, { userId }, { libraryId, source, start }): Promise<Infer<typeof libraryRecordsValidator>> => {
    const library = await runningLibrary(ctx, libraryId);
    const from = Math.max(0, Math.floor(start ?? 0));
    const asked = "records" in source ? { records: source.records.map((key) => recordKey(libraryId, key)) } : source;
    const read: { total: number; papers: Array<Infer<typeof screeningPaperInputValidator>> } = await ctx.runAction(internal.evidenceLibraries.sourceActions.page, { libraryId, userId, source: asked, first: from + 1, last: from + RECORDS_PAGE });
    const whole = "records" in source;
    return { total: read.total, records: read.papers.map((paper) => recordOf(paper, library.address, whole)), ...(from + RECORDS_PAGE < read.total ? { next: from + RECORDS_PAGE } : {}) };
  },
});
export const records = userAction(recordsAction);
export const recordsForAssistant = assistantAction(recordsAction);

const collectionMadeValidator = v.object({ id: v.string(), name: v.string(), description: v.union(v.string(), v.null()), private: v.boolean(), records: v.number() });

export const createCollectionAction = defineChangingAction({
  path: "evidenceLibraries/library:createCollection",
  description:
    `Makes a collection for the person in an Evidence Library, as their profile page there makes one, named in at most ${LIBRARY_COLLECTION_NAME_MAX} characters, with a description of at most ${LIBRARY_COLLECTION_DESCRIPTION_MAX}: private, unless \`public\` is true, when anyone who visits the library can find it. Returns it with its \`id\`, which evidenceLibraries/library:changeRecords puts records in. ` +
    "They rename, share or delete it on the library. Refused in a library they never signed in to.",
  args: { libraryId: v.id("evidenceLibraries"), name: v.string(), description: v.optional(v.string()), public: v.optional(v.boolean()) },
  returns: collectionMadeValidator,
  spendsCredits: false,
  // It's made on another site, which nothing here takes back.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, { userId }, { libraryId, name, description, public: shown }, call): Promise<Infer<typeof collectionMadeValidator>> => {
    // The step it is makes one collection however often it's tried.
    const step = call?.stepId ?? call?.from;
    const made: { id: string; name: string; description: string | null; private: boolean; count: number } = await ctx.runAction(internal.evidenceLibraries.sourceActions.createCollection, {
      libraryId,
      userId,
      name,
      ...(description ? { description } : {}),
      private: shown !== true,
      requestId: step ? `assistant:${step}` : crypto.randomUUID(),
    });
    return { id: made.id, name: made.name, description: made.description, private: made.private, records: made.count };
  },
});
export const createCollection = userAction(createCollectionAction);
export const createCollectionForAssistant = assistantAction(createCollectionAction);

const CHANGE_RECORDS = "evidenceLibraries/library:changeRecords" as const;
const changeArgs = { libraryId: v.id("evidenceLibraries"), collection: v.string(), collectionName: v.optional(v.string()), keys: v.array(v.string()), change: v.union(v.literal("add"), v.literal("remove")) };

export const changeRecordsAction = defineChangingAction({
  path: CHANGE_RECORDS,
  description:
    `Puts records of an Evidence Library into a collection the person owns or edits there, or takes them out (\`change\`), up to ${LIBRARY_CHANGE_MAX} at once, by their \`key\` (or \`paper\`) as evidenceLibraries/library:records gives it; \`collectionName\` is the collection's name, which the person is shown when asked. ` +
    "Answers how many records the collection holds after, how many changed, and `missing`, keys of records the library doesn't show, which never go in. Returns `undo`, which reverses it. Refused for a collection they may only view.",
  args: changeArgs,
  returns: v.object({ count: v.number(), changed: v.number(), missing: v.array(v.string()), undo: reversedBy(CHANGE_RECORDS, changeArgs) }),
  spendsCredits: false,
  // Whoever the collection is shared with, or anyone for a public one, sees the change.
  outsideEffect: true,
  undoable: true,
  shown: ({ libraryId, collection, collectionName, keys, change }) => ({ libraryId, collection: collectionName ?? collection, change, records: new Set(keys).size }),
  run: async (ctx, { userId }, { libraryId, collection, collectionName, keys, change }) => {
    const unique = [...new Set(keys.map((key) => recordKey(libraryId, key)))];
    if (unique.length === 0) throw createError("VALIDATION_ERROR", "Give the keys of the records to change.");
    if (unique.length > LIBRARY_CHANGE_MAX) throw createError("VALIDATION_ERROR", `A change takes at most ${LIBRARY_CHANGE_MAX} records: make it in parts.`);
    // The person was asked about the collection by the name the model gave: one that isn't this collection's changes nothing.
    if (collectionName) {
      const found: { name: string } = await ctx.runAction(internal.evidenceLibraries.sourceActions.collection, { libraryId, userId, id: collection });
      if (found.name.trim().toLowerCase() !== collectionName.trim().toLowerCase()) throw createError("VALIDATION_ERROR", `That collection is "${found.name}", not "${collectionName}". Check its ID, and ask again.`);
    }
    const done: { count: number; changed: string[]; missing: string[] } = await ctx.runAction(internal.evidenceLibraries.sourceActions.changeRecords, { libraryId, userId, collection, keys: unique, change });
    // Undone by the person, who needs no name: a collection renamed since is still undone.
    const undo = { path: CHANGE_RECORDS, args: { libraryId, collection, keys: done.changed, change: change === "add" ? ("remove" as const) : ("add" as const) } };
    return { count: done.count, changed: done.changed.length, missing: done.missing, ...(done.changed.length ? { undo } : {}) };
  },
});
export const changeRecords = userAction(changeRecordsAction);
export const changeRecordsForAssistant = assistantAction(changeRecordsAction);
