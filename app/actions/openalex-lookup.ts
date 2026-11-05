"use server";
import { z } from "zod";
import { LOOKUP_ID, type LookupEntity } from "@/lib/openalex/autocomplete";
import { lookupRequests, readOpenAlexNames, searchOpenAlex } from "@/lib/openalex/lookup";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { chosenSource } from "@/lib/search/active-source";
import { isOwnId, type SearchSource } from "@/lib/search/source";

const entitySchema = z.enum(["authors", "funders", "sources", "institutions"]);

/** Authors, funders, journals or institutions whose names start with the words typed, for a filter's picker. */
export async function searchOpenAlexRecords(entity: LookupEntity, query: string, source?: SearchSource) {
  const kind = entitySchema.parse(entity);
  const text = z.string().trim().min(1).max(200).parse(query);
  return (await spendOpenAlexRequests(lookupRequests(kind))) ?? searchOpenAlex(kind, text, await chosenSource(source));
}

/** Names for records a filter holds by ID, so its chips show them. Our index reads OpenAlex's IDs too, and only it reads its own. */
export async function readOpenAlexRecordNames(entity: LookupEntity, ids: string[], source?: SearchSource) {
  const kind = entitySchema.parse(entity);
  const valid = z.array(z.string().regex(LOOKUP_ID[kind])).min(1).max(100).parse(ids);
  return (await spendOpenAlexRequests()) ?? readOpenAlexNames(kind, valid, valid.some(isOwnId) ? "openscholar" : await chosenSource(source));
}
