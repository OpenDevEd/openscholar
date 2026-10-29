/**
 * Suggested searches on the home page (#964): research questions written from a person's own
 * recent searches in a workspace, kept on one row per workspace and person. Apart from the
 * functions, so the schema and the triggers can load them.
 */
import { v } from "convex/values";
import { capped } from "../lib/listCaps";

/** Questions one set holds. */
export const SUGGESTIONS_SHOWN = 3;
/** Characters kept of a question, and of the search it builds on. */
export const QUESTION_MAX = 300;
export const FROM_MAX = 200;

/** A suggested question, and the search it builds on as the person wrote it. */
export const suggestionValidator = v.object({ question: v.string(), from: v.string() });
/** A set of them. */
export const suggestionsValidator = capped(v.array(suggestionValidator), SUGGESTIONS_SHOWN);

export const searchSuggestionFields = {
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  suggestions: suggestionsValidator,
  /** When the refresh a search asked for runs; a later search moves it, and starting it clears it. */
  dueAt: v.optional(v.number()),
  /** The search that asked last: it's always among those a set is written from, however old it is. */
  askedBy: v.optional(v.id("searches")),
  /** The run writing a set now, by the `dueAt` it started for: the page dims the last set meanwhile, and only that run may store one. */
  running: v.optional(v.number()),
};
