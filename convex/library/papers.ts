/**
 * Saving a paper by its ID alone (#327). The results page saves a paper from the record it
 * already shows. The assistant has the paper's ID: given the action the page uses, it read
 * the paper first and sent its whole record back, abstract included, to save it. Here the
 * record is read from OpenAlex and saved as the page would have saved it (./mutations.ts).
 */
import { v, type Infer } from "convex/values";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { readWork } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { trimPaperData, type WorkInput } from "../../lib/library/trim-paper-data";
import { OPENALEX_WORK_SELECT_FIELDS } from "../../lib/openalex/search-params";
import { workUrl } from "../../lib/openalex/work-id";
import { saveAsksFirst, savedByIdValidator } from "./mutations";

export const saveAction = defineUserAction({
  path: "library/papers:save",
  description:
    "Saves a paper to the person's library by its ID alone, as results give it (such as W2741809807): its record is read from OpenAlex here, so nothing else about the paper is needed. " +
    "`rating`, 0 to 5, rates it as well; left out or null, a new paper has no rating and one already saved keeps its own. " +
    "A saved paper goes into a collection with library/mutations:setPaperInCollection, by this same ID. " +
    "Returns the paper's title, and `undo`: the action to run and the arguments to run it with to put things back. One request against the person's OpenAlex allowance.",
  // null is what a model that fills in every argument sends for the ones it doesn't mean.
  args: { id: v.string(), rating: v.optional(v.union(v.number(), v.null())) },
  returns: savedByIdValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  changes: true,
  // As the page's save asks (./mutations.ts): one that would have no undo. What isn't a paper's ID asks nothing here, and is refused when it runs.
  asksFirst: async (ctx, userId, { id, rating }) => {
    const openalexId = workUrl(id);
    return openalexId !== null && (await saveAsksFirst(ctx, userId, openalexId, rating ?? undefined));
  },
  run: async (ctx, userId, { id, rating }, author, call) => {
    const openalexId = workUrl(id);
    if (!openalexId) throw createError("VALIDATION_ERROR", "A paper is saved by its ID, such as W2741809807, as results give it.");
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const read = await readWork<WorkInput & { abstract_inverted_index?: Record<string, number[]> | null }>(openalexId.split("/").at(-1)!, OPENALEX_WORK_SELECT_FIELDS.join(","), spender(ctx, person.clerkId));
    if (!read) throw createError("NOT_FOUND", "OpenAlex has no paper by that ID.");
    // The record as the results page holds it: the abstract as text, in place of the index OpenAlex sends.
    const { abstract_inverted_index: index, ...rest } = read;
    const work: WorkInput = { ...rest, id: openalexId, ...(index ? { abstract: convertAbstractArrayToString(index) } : {}) };
    const paper = { ...trimPaperData(work), paperData: JSON.stringify(work) };
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const saved: Infer<typeof savedByIdValidator> = await ctx.runMutation(internal.library.mutations.saveRead, { userId, paper, ...(rating == null ? {} : { rating }), author, ...(call?.stepId ? { stepId: call.stepId } : {}), ...(call?.approved ? { approved: true } : {}) });
    return saved;
  },
});
export const save = userAction(saveAction);
export const saveForAssistant = assistantAction(saveAction);
