"use server";
import { z } from "zod";
import { readOpenAlexFunderNames, searchOpenAlexFunders } from "@/lib/openalex/funders";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";

const funderId = z.string().regex(/^F\d+$/);

export async function searchFunders(query: string) {
  const text = z.string().trim().min(1).max(200).parse(query);
  await spendOpenAlexRequests();
  return searchOpenAlexFunders(text);
}

export async function readFunderNames(ids: string[]) {
  const funders = z.array(funderId).min(1).max(100).parse(ids);
  await spendOpenAlexRequests();
  return readOpenAlexFunderNames(funders);
}
