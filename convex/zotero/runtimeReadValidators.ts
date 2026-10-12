// What the reads of a library's own data return (./runtimeReadActions.ts): whole answers and
// pages of its own lists, each within a cap the read enforces.
import { type GenericValidator, v } from "convex/values";
import { capped } from "../lib/listCaps";
import {
  RUNTIME_HOME_QUESTIONS_MAX,
  RUNTIME_READ_PAGE_SIZE,
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

export const runtimeCollectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  count: v.number(),
  source: v.string(),
  parentId: v.union(v.string(), v.null()),
  hasChildren: v.boolean(),
});

export const runtimeInstitutionValidator = v.object({ name: v.string(), count: v.number() });

export const reviewedPublicationValidator = v.object({
  key: v.string(),
  title: v.string(),
  publishedAt: v.string(),
  reviewer: v.string(),
  reviewed: v.boolean(),
});

// `reason: "not-set-up"` means the library has no running runtime yet, so
// there is nothing to read and the list is empty.
export const notSetUpValidator = v.optional(v.literal("not-set-up"));

/** One page of a library's own list, as the library pages it: never more than a page it's asked for. */
export const runtimePage = <Item extends GenericValidator>(item: Item) =>
  v.object({
    reason: notSetUpValidator,
    page: capped(v.array(item), RUNTIME_READ_PAGE_SIZE),
    isDone: v.boolean(),
    continueCursor: v.string(),
  });
