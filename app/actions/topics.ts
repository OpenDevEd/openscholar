"use server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { readOpenAlexWorks } from "@/lib/openalex/read-works";
import { topicIdSchema } from "@/lib/topics/contract";
import { ensureTopicCatalog } from "@/lib/topics/ensure-catalog";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";

export async function readTopic(id: string) {
  topicIdSchema.parse(id);
  // The description is read from the platform's copy of the catalog, so that copy must exist first.
  await ensureTopicCatalog();
  return fetchAction(api.topics.details.get, {id});
}
export async function readTopicWorks(id: string, cursor: string) {
  topicIdSchema.parse(id);
  if (!cursor || cursor.length > 8192) throw new Error("Invalid topic cursor");
  return (await spendOpenAlexRequests()) ?? readOpenAlexWorks({filter: {...({topics: {id}}), is_paratext: false, is_retracted: false}, cursor, perPage: 10, sortBy: {field: "cited_by_count", order: "desc"}});
}
