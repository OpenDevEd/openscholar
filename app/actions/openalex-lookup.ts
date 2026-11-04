"use server";
import { z } from "zod";
import { LOOKUP_ID, type LookupEntity } from "@/lib/openalex/autocomplete";
import { lookupRequests, readOpenAlexNames, searchOpenAlex } from "@/lib/openalex/lookup";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { activeSearchSource } from "@/lib/search/active-source";
import { isOwnId } from "@/lib/search/source";

const entitySchema = z.enum(["authors", "funders", "sources", "institutions"]);

/** Authors, funders, journals or institutions whose names start with the words typed, for a filter's picker. `onOpenAlex` asks OpenAlex whatever the site's source is, for a community's source dialog, whose query OpenAlex runs. */
export async function searchOpenAlexRecords(entity: LookupEntity, query: string, onOpenAlex?: boolean) {
  const kind = entitySchema.parse(entity);
  const text = z.string().trim().min(1).max(200).parse(query);
  const source = onOpenAlex ? "openalex" : await activeSearchSource();
  return (await spendOpenAlexRequests(lookupRequests(kind), source)) ?? searchOpenAlex(kind, text, source);
}

/** Names for records a filter holds by ID, so its chips show them. Our index reads OpenAlex's IDs too, and only it reads its own. */
export async function readOpenAlexRecordNames(entity: LookupEntity, ids: string[]) {
  const kind = entitySchema.parse(entity);
  const valid = z.array(z.string().regex(LOOKUP_ID[kind])).min(1).max(100).parse(ids);
  const source = valid.some(isOwnId) ? "openscholar" : await activeSearchSource();
  return (await spendOpenAlexRequests(1, source)) ?? readOpenAlexNames(kind, valid, source);
}
