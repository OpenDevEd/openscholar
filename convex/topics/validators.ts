import { v } from "convex/values";
import { MAX_RECORD_CREATORS, MAX_RECORD_TOPICS, MAX_TOPIC_DEPTH, MAX_TOPIC_KEYWORDS, capped } from "../lib/listCaps";
export const topicNodeFields = {
  id: v.string(), name: v.string(), parent: v.union(v.string(), v.null()),
  level: v.union(v.literal("domain"), v.literal("field"), v.literal("subfield"), v.literal("topic")),
  path: capped(v.array(v.string()), MAX_TOPIC_DEPTH), ancestors: capped(v.array(v.string()), MAX_TOPIC_DEPTH), childCount: v.number(), revision: v.string(),
  searchText: v.string(), domainId: v.string(), fieldId: v.string(), subfieldId: v.string(),
};
export const metadataValidator = v.object({title: v.string(), date: v.union(v.string(), v.null()), itemType: v.string(), creators: capped(v.array(v.string()), MAX_RECORD_CREATORS), abstract: v.union(v.string(), v.null()),
  /** Its public PDF and the picture of its first page, as the community last said; absent from a runtime that doesn't say. */
  pdf: v.optional(v.union(v.null(), v.object({url: v.string(), cover: v.union(v.string(), v.null())})))});

/** Topics one library record is filed under. */
export const recordTopicIdsValidator = capped(v.array(v.string()), MAX_RECORD_TOPICS);

/** A topic's keywords, as its details row stores them, and the domain, field and subfield above it. */
export const topicKeywordsValidator = capped(v.array(v.string()), MAX_TOPIC_KEYWORDS);
export const topicPathValidator = capped(v.array(v.object({id: v.string(), name: v.string()})), MAX_TOPIC_DEPTH);

/** Publications one page of a topic's gives, as its page asks for them (../../lib/topics/publications.ts). */
export const TOPIC_PUBLICATIONS_PAGE = 10;
/** A page of a topic's publications as the assistant reads it (./assistant.ts): each with how many libraries hold a copy. */
export const topicPublicationsReadValidator = v.object({
  publications: capped(v.array(v.object({title: v.string(), type: v.string(), year: v.string(), authors: v.string(), url: v.string(), library: v.string(), copies: v.number()})), TOPIC_PUBLICATIONS_PAGE),
  next: v.union(v.string(), v.null()),
  // Ones a library couldn't answer for now.
  unavailable: v.number(),
  // The list is being regrouped and may change.
  updating: v.boolean(),
});
