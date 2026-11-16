/**
 * Saving a paper by its ID alone (#327). The results page saves a paper from the record it
 * already shows. The assistant has the paper's ID: given the action the page uses, it read
 * the paper first and sent its whole record back, abstract included, to save it. Here the
 * record is read from OpenAlex and saved as the page would have saved it (./mutations.ts).
 */
import { v, type Infer } from "convex/values";
import { abstractFromIndex } from "../../lib/papers/abstract-text";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { assistantAction, assistantMutation, defineUserAction, defineUserMutation, userAction, userMutation } from "../lib/userActions";
import { readWork } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { trimPaperData, type WorkInput } from "../../lib/library/trim-paper-data";
import { OPENALEX_WORK_SELECT_FIELDS } from "../../lib/openalex/search-params";
import { openalexAddress, openalexWorkOf, ownWork, reportKey } from "../../lib/papers/paper-ref";
import { SEARCH_SOURCE_NAMES, sourceForId } from "../../lib/search/source";
import { collectionHome, followed, shownOutside } from "./followed";
import { editableCollection } from "./collectionMembership";
import { checkSave, savedByIdValidator, setPaperInCollectionAction } from "./mutations";
import { libraryPaper } from "./validators";
import { findItem, requirePaperKey } from "./find";

/** The address of the work an ID or key names, OpenAlex's, our index's or a report's on Openscholar, which this action reads; null for anything else. */
const workOf = (id: string) => {
  const own = ownWork(id.replace(/^openscholar:/, "")) ?? reportKey(id.replace(/^report:/, ""));
  return openalexAddress(openalexWorkOf(id)) ?? (own ? `https://openscholar.ai/${own}` : null);
};

export const saveAction = defineUserAction({
  path: "library/papers:save",
  description:
    "Saves a paper to the person's library by its ID alone, as results give it (such as W2741809807): its record is read from the index here, so nothing else about the paper is needed. " +
    "`rating`, 0 to 5, rates it as well; left out or null, a new paper has no rating and one already saved keeps its own. " +
    "With `collectionId`, the paper also goes into that collection of theirs, in this one call: to save papers into a collection, this is the only action needed. " +
    "Returns the paper's title, and `undo`: the action to run and the arguments to run it with to put things back. One request against the person's search allowance.",
  // null is what a model that fills in every argument sends for the ones it doesn't mean.
  args: { id: v.string(), rating: v.optional(v.union(v.number(), v.null())), collectionId: v.optional(v.union(v.id("collections"), v.null())) },
  returns: savedByIdValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  changes: true,
  // A library may follow the collection, which shows the paper outside the account. What isn't a paper's ID asks nothing here, and is refused when it runs.
  asksFirst: async (ctx, _actor, { id, collectionId }) => workOf(id) !== null && collectionId != null && (await followed(ctx, collectionId)),
  seenOutside: true,
  check: async (ctx, actor, { id, rating, collectionId }) => {
    const openalexId = workOf(id);
    if (openalexId) await checkSave(ctx, actor, { paper: openalexId, ...(rating == null ? {} : { rating }), ...(collectionId == null ? {} : { collectionId }) });
  },
  run: async (ctx, { userId, workspaceId, author }, { id, rating, collectionId }, call) => {
    const openalexId = workOf(id);
    if (!openalexId) throw createError("VALIDATION_ERROR", "A paper is saved by its ID in the index, such as W2741809807 or R100001, as results give it, or its key, such as openalex:W2741809807.");
    const report = reportKey(openalexId);
    // A report published on Openscholar is its own record, which no index read gives: saved as its page saves it.
    const paper: Infer<typeof libraryPaper> | null = report ? await ctx.runQuery(internal.reports.saved.copy, { key: report }) : await readPaper(ctx, userId, openalexId);
    if (!paper) throw createError("NOT_FOUND", "No report published on Openscholar has this key.");
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const saved: Infer<typeof savedByIdValidator> = await ctx.runMutation(internal.library.mutations.saveRead, { userId, workspaceId, paper, ...(rating == null ? {} : { rating }), ...(collectionId == null ? {} : { collectionId }), author, ...(call?.stepId ? { stepId: call.stepId } : {}), ...(call?.approved ? { approved: true } : {}) });
    return saved;
  },
});

/** A paper's record read from the index the site searches, as the results page holds it. */
async function readPaper(ctx: ActionCtx, userId: Id<"users">, openalexId: string) {
  const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
  if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
  const source = sourceForId(openalexId, await ctx.runQuery(internal.featureFlags.internal.searchSource, {}));
  const read = await readWork<WorkInput & { abstract_inverted_index?: Record<string, number[]> | null }>(openalexId.split("/").at(-1)!, OPENALEX_WORK_SELECT_FIELDS.join(","), spender(ctx, person.clerkId), source);
  if (!read) throw createError("NOT_FOUND", `${SEARCH_SOURCE_NAMES[source]} has no paper by that ID.`);
  // The record as the results page holds it: the abstract as text, in place of the index OpenAlex sends.
  const { abstract_inverted_index: index, ...rest } = read;
  // Its ID as the source gives it: a paper asked for by our index's ID that OpenAlex knows too goes by OpenAlex's, as it does in results.
  const work: WorkInput = { ...rest, id: rest.id || openalexId, ...(index ? { abstract: abstractFromIndex(index) } : {}) };
  return { ...trimPaperData(work), paperData: JSON.stringify(work) };
}
export const save = userAction(saveAction);
export const saveForAssistant = assistantAction(saveAction);

/**
 * A saved paper into a collection, or out of it, by the paper's ID alone. The page's own
 * action for this also takes a paper's whole record, to save it on the way; offered that,
 * the assistant read each paper first to send its record. This is that action with only the ID.
 */
export const collectAction = defineUserMutation({
  path: "library/papers:collect",
  activity: ({ collectionId, inCollection }, { undo }) => (undo ? { kind: "collection", id: collectionId, happened: inCollection ? "added" : "removed", count: 1 } : null),
  activityIn: collectionHome,
  description:
    "Puts a paper that's in the person's library into one of their collections, or takes it out, by the paper's ID alone, as results give it, or its key, as library/queries:papers gives it in `id`. `inCollection` is true to put it in and false to take it out. " +
    "It takes a paper already in the library: to save one and put it in a collection, call library/papers:save with `collectionId` instead. Taking it out keeps it in the library. " +
    "A change returns `undo`: the action to run and the arguments to run it with to put the collection back as it was.",
  args: { id: v.string(), collectionId: v.id("collections"), inCollection: v.boolean() },
  returns: setPaperInCollectionAction.returns,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // A library may follow the collection, which shows the change outside the account.
  asksFirst: shownOutside,
  seenOutside: true,
  run: async (ctx, actor, { id, collectionId, inCollection }) => {
    // A collection's papers are its own workspace's library's: for one shared with the person to edit, not theirs.
    const { workspaceId } = await editableCollection(ctx, actor, collectionId);
    const item = await findItem(ctx, workspaceId, id);
    if (inCollection && !item) {
      throw createError(
        "NOT_FOUND",
        workspaceId === actor.workspaceId
          ? "This paper isn't in the library yet. Call library/papers:save with this collectionId: it saves the paper and puts it in the collection."
          : "This paper isn't in that collection's library yet. Put it there with library/mutations:setPaperInCollection, giving the paper whole.",
      );
    }
    return await setPaperInCollectionAction.run(ctx, actor, { paper: { paper: item ? item.paperKey : requirePaperKey(id) }, collectionId, inCollection });
  },
});
export const collect = userMutation(collectAction);
export const collectForAssistant = assistantMutation(collectAction);
