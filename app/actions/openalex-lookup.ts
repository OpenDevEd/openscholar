"use server";
import { z } from "zod";
import { LOOKUP_ID_LETTER, type LookupEntity } from "@/lib/openalex/autocomplete";
import { lookupRequests, readOpenAlexNames, searchOpenAlex } from "@/lib/openalex/lookup";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";

const entitySchema = z.enum(["authors", "funders", "sources", "institutions"]);

/** Authors, funders, journals or institutions whose names start with the words typed, for a filter's picker. */
export async function searchOpenAlexRecords(entity: LookupEntity, query: string) {
  const kind = entitySchema.parse(entity);
  const text = z.string().trim().min(1).max(200).parse(query);
  return (await spendOpenAlexRequests(lookupRequests(kind))) ?? searchOpenAlex(kind, text);
}

/** Names for records a filter holds by ID, so its chips show them. */
export async function readOpenAlexRecordNames(entity: LookupEntity, ids: string[]) {
  const kind = entitySchema.parse(entity);
  const valid = z.array(z.string().regex(new RegExp(`^${LOOKUP_ID_LETTER[kind]}\\d+$`))).min(1).max(100).parse(ids);
  return (await spendOpenAlexRequests()) ?? readOpenAlexNames(kind, valid);
}
