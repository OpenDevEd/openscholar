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
  /** When the refresh a search asked for runs; a later search moves it, and only the run it names writes. */
  dueAt: v.optional(v.number()),
  /** Set while a new set is being written, so the page dims the last one. */
  generating: v.boolean(),
};
