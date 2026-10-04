/**
 * Saving a paper by its ID alone (#327). The results page saves a paper from the record it
 * already shows; the assistant has the paper's ID, so its record is read from OpenAlex here
 * and saved as the page would have saved it (./mutations.ts).
 */
import { v, type Infer } from "convex/values";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { readWork } from "../paperSets/openalex";
import { OPENALEX_WORK_SELECT_FIELDS } from "../../lib/openalex/search-params";
import { workUrl } from "../../lib/openalex/work-id";
import { trimPaperData, type WorkInput } from "../../lib/library/trim-paper-data";
import { followed } from "./followed";
import { saveAsksFirst, saveRead } from "./mutations";

const paperId = (id: string) => workUrl(id) ?? (() => {
  throw createError("VALIDATION_ERROR", "A paper is saved by its ID, such as W2741809807, as results give it.");
})();

export const saveAction = defineUserAction({
  path: "library/papers:save",
  description:
    "Saves a paper to the person's library by its ID alone, as results give it (such as W2741809807): its record is read from OpenAlex here, so nothing else about the paper is needed. " +
    "`rating`, 0 to 5, rates it as well; left out or null, a new paper has no rating and one already saved keeps its own. `collectionId` also puts it in one of their collections. " +
    "Returns the paper's title, and `undo`: the action to run and the arguments to run it with to put things back. One request against the person's OpenAlex allowance.",
  // null is what a model that fills in every argument sends for the ones it doesn't mean.
  args: { id: v.string(), rating: v.optional(v.union(v.number(), v.null())), collectionId: v.optional(v.union(v.id("collections"), v.null())) },
  returns: v.object({ libraryItemId: v.id("libraryItems"), title: v.string(), undo: saveRead.exportReturns ? v.optional(v.any()) : v.optional(v.any()) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // As saving and putting in a collection each ask (./mutations.ts): a save with no undo, or a collection an Evidence Library follows.
  asksFirst: async (ctx, userId, { id, rating, collectionId }) => (await saveAsksFirst(ctx, userId, paperId(id), rating ?? undefined)) || (collectionId ? await followed(ctx, collectionId) : false),
  run: async (ctx, userId, { id, rating, collectionId }, author) => {
    const openalexId = paperId(id);
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const { clerkId } = person;
    const read = await readWork<WorkInput & { abstract_inverted_index?: Record<string, number[]> | null }>(openalexId.split("/").at(-1)!, OPENALEX_WORK_SELECT_FIELDS.join(","), (count) =>
      ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId, count }),
    );
    if (!read) throw createError("NOT_FOUND", "OpenAlex has no paper by that ID.");
    // The record as the results page holds it: the abstract as text, in place of the index OpenAlex sends.
    const { abstract_inverted_index: index, ...rest } = read;
    const work: WorkInput = { ...rest, id: openalexId, ...(index ? { abstract: convertAbstractArrayToString(index) } : {}) };
    const paper = { ...trimPaperData(work), paperData: JSON.stringify(work) };
    const saved: Infer<typeof saveRead.exportReturns extends never ? never : any> = await ctx.runMutation(internal.library.mutations.saveRead, { userId, paper, ...(rating == null ? {} : { rating }), ...(collectionId ? { collectionId } : {}), author });
    return { libraryItemId: saved.id, title: paper.title, ...(saved.undo ? { undo: saved.undo } : {}) };
  },
});
export const save = userAction(saveAction);
export const saveForAssistant = assistantAction(saveAction);
