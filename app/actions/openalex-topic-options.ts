"use server";

import type { OpenAlexTopicLevel } from "@/lib/evidence-libraries/openalex-source-query";

export type OpenAlexTopicOption = {
  id: string;
  name: string;
  within: string;
};

const ENDPOINT: Record<OpenAlexTopicLevel, string> = {
  field: "fields",
  subfield: "subfields",
  topic: "topics",
};
const PARENT: Record<OpenAlexTopicLevel, string> = {
  field: "domain",
  subfield: "field",
  topic: "subfield",
};

export async function searchOpenAlexTopicOptions(
  level: OpenAlexTopicLevel,
  search: string,
): Promise<OpenAlexTopicOption[]> {
  const url = new URL(`https://api.openalex.org/${ENDPOINT[level]}`);
  url.searchParams.set("per_page", "40");
  url.searchParams.set("sort", "works_count:desc");
  url.searchParams.set("select", `id,display_name,${PARENT[level]}`);
  if (search.trim()) url.searchParams.set("search", search.trim());
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (apiKey) url.searchParams.set("api_key", apiKey);
  const mailto = process.env.OPENALEX_CONTACT_EMAIL?.trim();
  if (mailto) url.searchParams.set("mailto", mailto);

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);
  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) return [];
  return body.results.flatMap((value): OpenAlexTopicOption[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.display_name !== "string")
      return [];
    const parent = row[PARENT[level]];
    return [
      {
        id: row.id.split("/").pop() ?? row.id,
        name: row.display_name,
        within:
          parent && typeof parent === "object" && !Array.isArray(parent)
            ? String((parent as Record<string, unknown>).display_name ?? "")
            : "",
      },
    ];
  });
}
