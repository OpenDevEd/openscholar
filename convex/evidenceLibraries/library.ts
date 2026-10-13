/**
 * An Evidence Library's records as a person's source (plans/evidence-library-sources): what each
 * library they read lists for them, and what a pasted library address points at. The library
 * decides what the person may read: these ask it as them (./sourceActions.ts).
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { parseSourceAddress } from "../../lib/evidence-libraries/source-address";
import { READ_LIBRARIES_MAX } from "./readers";
import { libraryContentsValidator, librarySourceRowValidator, sourceAddressErrorValidator } from "./validators";

const reads = { spendsCredits: false, outsideEffect: false, undoable: true } as const;
const SET = 'Screen or extract a row\'s records with the set { kind: "evidenceLibrary", libraryId, source }, where `records` is how many it holds now.';

export const sourcesAction = defineUserAction({
  path: "evidenceLibraries/library:sources",
  description:
    `What each of the given Evidence Libraries (from evidenceLibraries/readers:list, at most ${READ_LIBRARIES_MAX}) offers the person as a source of records, each library asked as them: ` +
    "all its records (`what: \"all\"`), their own collections there (`yours`), the ones shared with them (`shared`), and the library's own collections (`library`, with the collection it sits in as `parent`). " +
    `A library that couldn't list them says why in \`problem\`: \`outdated\` needs an update, \`unreadable\` didn't answer. ${SET}`,
  args: { libraryIds: v.array(v.id("evidenceLibraries")) },
  returns: v.array(libraryContentsValidator),
  ...reads,
  run: async (ctx, { userId }, { libraryIds }): Promise<Array<Infer<typeof libraryContentsValidator>>> =>
    await ctx.runAction(internal.evidenceLibraries.sourceActions.sources, { userId, libraryIds: [...new Set(libraryIds)].slice(0, READ_LIBRARIES_MAX) }),
});
export const sources = userAction(sourcesAction);
export const sourcesForAssistant = assistantAction(sourcesAction);

const addressValidator = v.union(v.object({ row: librarySourceRowValidator }), v.object({ error: sourceAddressErrorValidator }));

export const addressAction = defineUserAction({
  path: "evidenceLibraries/library:address",
  description:
    "What an address of any Evidence Library OpenScholar runs points at, as a source of records the person may read: the whole library, a search with its filters and order, one of the library's collections, a reader's collection (theirs, shared with them, or a public one), a search inside one, or a record. " +
    "Or why it is none: `notAddress`, `notHosted` (no library OpenScholar runs), `private` (a collection they may not read), `notFound`, `profile` (a reader's page: give one of their collections), `unknownPage`, `outdated` (the library needs an update) or `unreadable` (it didn't answer). " +
    SET,
  args: { address: v.string() },
  returns: addressValidator,
  ...reads,
  run: async (ctx, { userId }, { address }): Promise<Infer<typeof addressValidator>> => {
    const parsed = parseSourceAddress(address.slice(0, 4_000));
    if ("error" in parsed) return parsed;
    const libraryId: Id<"evidenceLibraries"> | null = await ctx.runQuery(internal.evidenceLibraries.sources.at, { origin: parsed.origin });
    const running: unknown = libraryId ? await ctx.runQuery(internal.evidenceLibraries.readers.running, { libraryId }) : null;
    if (!libraryId || !running) return { error: "notHosted" };
    return await ctx.runAction(internal.evidenceLibraries.sourceActions.describe, { libraryId, userId, source: parsed.source });
  },
});
export const address = userAction(addressAction);
export const addressForAssistant = assistantAction(addressAction);
