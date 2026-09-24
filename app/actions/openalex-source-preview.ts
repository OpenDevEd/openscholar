"use server";

import { auth } from "@clerk/nextjs/server";
import type { OpenAlexQuery } from "@/lib/evidence-libraries/configuration/sources";

type PreviewWork = {
  id: string;
  title: string;
  publicationYear: number | null;
};

export type OpenAlexSourcePreview =
  | { ok: true; works: PreviewWork[] }
  | { ok: false; message: string };

function cleanQuery(query: OpenAlexQuery): OpenAlexQuery {
  const search = query.search?.trim();
  const filter = query.filter?.trim();
  if (!search && !filter) throw new Error("Enter a search or filter");
  if (search && search.length > 2_048) throw new Error("Search is too long");
  if (filter && filter.length > 16_384) throw new Error("Filter is too long");
  return { ...(search ? { search } : {}), ...(filter ? { filter } : {}) };
}

export async function previewOpenAlexSource(
  input: OpenAlexQuery,
): Promise<OpenAlexSourcePreview> {
  if (!(await auth()).userId) return {ok: false, message: "Sign in to preview a source"};
  let query: OpenAlexQuery;
  try {
    query = cleanQuery(input);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid query",
    };
  }
  const url = new URL("https://api.openalex.org/works");
  if (query.search) url.searchParams.set("search", query.search);
  if (query.filter) url.searchParams.set("filter", query.filter);
  url.searchParams.set("per-page", "10");
  url.searchParams.set("select", "id,title,publication_year");
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (apiKey) url.searchParams.set("api_key", apiKey);
  const mailto = process.env.OPENALEX_CONTACT_EMAIL?.trim();
  if (mailto) url.searchParams.set("mailto", mailto);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = (await response.json()) as {
      message?: unknown;
      results?: unknown;
    };
    if (!response.ok) {
      return {
        ok: false,
        message:
          typeof body.message === "string"
            ? body.message
            : `OpenAlex returned ${response.status}`,
      };
    }
    const works = Array.isArray(body.results)
      ? body.results.flatMap((value): PreviewWork[] => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return [];
          const work = value as Record<string, unknown>;
          if (typeof work.id !== "string" || typeof work.title !== "string")
            return [];
          return [
            {
              id: work.id,
              title: work.title,
              publicationYear:
                typeof work.publication_year === "number"
                  ? work.publication_year
                  : null,
            },
          ];
        })
      : [];
    return { ok: true, works };
  } catch {
    return { ok: false, message: "OpenAlex could not be reached" };
  }
}
