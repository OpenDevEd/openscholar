"use server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { readOpenAlexWorks } from "@/lib/openalex/read-works";
import { z } from "zod";
import { topicIdSchema, topicNodeIdSchema } from "@/lib/topics/contract";
export async function readTopic(id: string) {
  topicIdSchema.parse(id);
  return fetchAction(api.topics.details.get, {id});
}
export async function readTopicWorks(id: string, cursor: string) {
  topicIdSchema.parse(id);
  if (!cursor || cursor.length > 8192) throw new Error("Invalid topic cursor");
  return readOpenAlexWorks({filter: {...({topics: {id}}), is_paratext: false, is_retracted: false}, cursor, perPage: 10, sortBy: {field: "cited_by_count", order: "desc"}});
}
export async function readTopicDirectory(input: {parent?: string | null; query?: string; ancestor?: string; cursor: string | null; limit: number}) {
  await fetchAction(api.topics.catalog.initialize, {});
  return fetchQuery(api.topics.catalog.directory, input);
}

export async function readTopicNodes(ids: readonly string[]) {
  const valid = z.array(topicNodeIdSchema).max(100).parse(ids);
  await fetchAction(api.topics.catalog.initialize, {});
  return fetchQuery(api.topics.catalog.resolve, {ids: valid});
}
