"use server";
import { z } from "zod";
import { readOpenAlexAuthorNames, searchOpenAlexAuthors } from "@/lib/openalex/authors";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";

const authorId = z.string().regex(/^A\d+$/);

export async function searchAuthors(query: string) {
  const text = z.string().trim().min(1).max(200).parse(query);
  return (await spendOpenAlexRequests()) ?? searchOpenAlexAuthors(text);
}

export async function readAuthorNames(ids: string[]) {
  const authors = z.array(authorId).min(1).max(100).parse(ids);
  return (await spendOpenAlexRequests()) ?? readOpenAlexAuthorNames(authors);
}
