import { v } from "convex/values";
import { MAX_RECORD_CREATORS, MAX_RECORD_TOPICS, MAX_TOPIC_DEPTH, MAX_TOPIC_KEYWORDS, capped } from "../lib/listCaps";
export const topicNodeFields = {
  id: v.string(), name: v.string(), parent: v.union(v.string(), v.null()),
  level: v.union(v.literal("domain"), v.literal("field"), v.literal("subfield"), v.literal("topic")),
  path: capped(v.array(v.string()), MAX_TOPIC_DEPTH), ancestors: capped(v.array(v.string()), MAX_TOPIC_DEPTH), childCount: v.number(), revision: v.string(),
  searchText: v.string(), domainId: v.string(), fieldId: v.string(), subfieldId: v.string(),
};
export const metadataValidator = v.object({title: v.string(), date: v.union(v.string(), v.null()), itemType: v.string(), creators: capped(v.array(v.string()), MAX_RECORD_CREATORS), abstract: v.union(v.string(), v.null())});

/** Topics one library record is filed under. */
export const recordTopicIdsValidator = capped(v.array(v.string()), MAX_RECORD_TOPICS);

/** A topic's keywords, as its details row stores them, and the domain, field and subfield above it. */
export const topicKeywordsValidator = capped(v.array(v.string()), MAX_TOPIC_KEYWORDS);
export const topicPathValidator = capped(v.array(v.object({id: v.string(), name: v.string()})), MAX_TOPIC_DEPTH);
