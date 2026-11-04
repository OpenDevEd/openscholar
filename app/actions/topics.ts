"use server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { readOpenAlexWorks } from "@/lib/openalex/read-works";
import { topicIdSchema } from "@/lib/topics/contract";
import { ensureTopicCatalog } from "@/lib/topics/ensure-catalog";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { activeSearchSource } from "@/lib/search/active-source";
import { sourceForId } from "@/lib/search/source";

export async function readTopic(id: string) {
  topicIdSchema.parse(id);
  // The description is read from the platform's copy of the catalog, so that copy must exist first.
  await ensureTopicCatalog();
  return fetchAction(api.topics.details.get, {id});
}
export async function readTopicWorks(id: string, cursor: string) {
  topicIdSchema.parse(id);
  if (!cursor || cursor.length > 8192) throw new Error("Invalid topic cursor");
  const source = await activeSearchSource();
  return (await spendOpenAlexRequests(1, source)) ?? readOpenAlexWorks({filter: {...({topics: {id}}), is_paratext: false, is_retracted: false}, cursor, perPage: 10, sortBy: {field: "cited_by_count", order: "desc"}}, source);
}

/** One work by its ID, as a list's paper: for focus mode on a paper a chat names. Null when its source has none. */
export async function readWork(id: string) {
  const work = /^(?:https:\/\/(?:openalex\.org|openscholar\.ai)\/)?((?:W|OS)\d+)$/i.exec(id)?.[1]?.toUpperCase();
  if (!work) throw new Error("Invalid work ID");
  const source = sourceForId(work, await activeSearchSource());
  const limited = await spendOpenAlexRequests(1, source);
  if (limited) return limited;
  const read = await readOpenAlexWorks({filter: {openalex_id: work} as never, cursor: "*", perPage: 1}, source);
  return read.results[0] ?? null;
}
