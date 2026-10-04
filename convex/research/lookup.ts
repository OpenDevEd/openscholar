/**
 * Finds what a search can be filtered by but only by ID (#327): an author, a funder, a
 * research area. The search page's filters look the same things up as the person types;
 * the assistant asks by name and gets the IDs the search tools take (./searches.ts).
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { autocomplete } from "../paperSets/openalex";
import { LOOKUP_MAX, lookupKindValidator, lookupValidator } from "./searchValidators";

export const findAction = defineUserAction({
  path: "research/lookup:find",
  description:
    "Finds an author, a funder or a research area by name, to filter a saved search by: each match's ID, its name, and what tells it from others of that name (where an author works, what an area sits under). " +
    "Give the IDs to research/searches:create or :update as `authors`, `funders` or `researchAreas`. Looking up an author or a funder counts against the person's OpenAlex allowance.",
  args: { kind: lookupKindValidator, text: v.string() },
  returns: lookupValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, userId, { kind, text }): Promise<Infer<typeof lookupValidator>> => {
    if (!text.trim()) throw createError("VALIDATION_ERROR", "Give a name to look for.");
    if (kind === "researchArea") return await ctx.runQuery(internal.research.topicCatalog.search, { text });
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const { clerkId } = person;
    const matches = await autocomplete(kind === "author" ? "authors" : "funders", text.trim(), (count) => ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId, count }));
    return { matches: matches.slice(0, LOOKUP_MAX) };
  },
});
export const find = userAction(findAction);
export const findForAssistant = assistantAction(findAction);
