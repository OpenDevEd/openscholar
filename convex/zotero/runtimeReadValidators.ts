// What the reads of a library's own data return (./runtimeReadActions.ts), where the list
// is a whole answer and not a page: each within a cap the read enforces.
import { v } from "convex/values";
import { capped } from "../lib/listCaps";
import {
  RUNTIME_HOME_QUESTIONS_MAX,
  RUNTIME_RESOLVE_MAX_TOTAL_IDS,
} from "./runtimeReadClient";

export const collectionFactsValidator = v.object({
  id: v.string(),
  title: v.string(),
  source: v.string(),
  count: v.number(),
});

/** The collections asked about by id: at most as many as a site shows. */
export const resolvedCollectionsValidator = capped(
  v.array(collectionFactsValidator),
  RUNTIME_RESOLVE_MAX_TOTAL_IDS,
);

/** One question, or none, for each slot of the home page. */
export const homeQuestionsValidator = capped(
  v.array(v.union(v.string(), v.null())),
  RUNTIME_HOME_QUESTIONS_MAX,
);
