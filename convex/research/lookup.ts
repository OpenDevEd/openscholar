/**
 * Finds what a search can be filtered by but only by ID (#327): an author, a funder, a
 * journal, an institution, a research area. The search page's filters look the same things
 * up as the person types; the assistant asks by name and gets the IDs the search tools take
 * (./searches.ts).
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { autocomplete } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { LOOKUP_MAX, lookupKindValidator, lookupValidator } from "./searchValidators";

const ENTITIES = { author: "authors", funder: "funders", journal: "sources", institution: "institutions" } as const;

export const findAction = defineUserAction({
  path: "research/lookup:find",
  description:
    "Finds an author, a funder, a journal, an institution or a research area by name, to filter a saved search by: each match's ID, its name, and what tells it from others of that name (where an author works, whether a journal is a journal or a repository and who publishes it, where an institution is, what an area sits under). " +
    "Give the IDs to research/searches:create or :update as `authors`, `funders`, `journals`, `institutions` or `researchAreas`. Looking up anything but a research area counts against the person's OpenAlex allowance.",
  args: { kind: lookupKindValidator, text: v.string() },
  returns: lookupValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, { userId }, { kind, text }): Promise<Infer<typeof lookupValidator>> => {
    if (!text.trim()) throw createError("VALIDATION_ERROR", "Give a name to look for.");
    if (kind === "researchArea") return await ctx.runQuery(internal.research.topicCatalog.search, { text });
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const { clerkId } = person;
    const matches = await autocomplete(ENTITIES[kind], text.trim(), spender(ctx, clerkId));
    return { matches: matches.slice(0, LOOKUP_MAX) };
  },
});
export const find = userAction(findAction);
export const findForAssistant = assistantAction(findAction);
