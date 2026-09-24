import { v } from "convex/values";
export const topicNodeFields = {
  id: v.string(), name: v.string(), parent: v.union(v.string(), v.null()),
  level: v.union(v.literal("domain"), v.literal("field"), v.literal("subfield"), v.literal("topic")),
  path: v.array(v.string()), ancestors: v.array(v.string()), childCount: v.number(), revision: v.string(),
  searchText: v.string(), domainId: v.string(), fieldId: v.string(), subfieldId: v.string(),
};
export const metadataValidator = v.object({title: v.string(), date: v.union(v.string(), v.null()), itemType: v.string(), creators: v.array(v.string()), abstract: v.union(v.string(), v.null())});
