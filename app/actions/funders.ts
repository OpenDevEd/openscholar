"use server";
import { z } from "zod";
import { readOpenAlexFunderNames, searchOpenAlexFunders } from "@/lib/openalex/funders";

const funderId = z.string().regex(/^F\d+$/);

export async function searchFunders(query: string) {
  const text = z.string().trim().min(1).max(200).parse(query);
  return searchOpenAlexFunders(text);
}

export async function readFunderNames(ids: string[]) {
  return readOpenAlexFunderNames(z.array(funderId).min(1).max(100).parse(ids));
}
