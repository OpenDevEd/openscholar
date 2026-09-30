import "server-only";
import { z } from "zod";
import { openAlexUrl } from "./request-url";

export type FunderOption = { id: string; name: string; detail?: string };

const autocompleteSchema = z.object({
  results: z.array(z.object({ id: z.string(), display_name: z.string(), hint: z.string().nullable().optional() })),
});
const fundersSchema = z.object({
  results: z.array(z.object({ id: z.string(), display_name: z.string() })),
});

async function readOpenAlex(path: string, parameters: Record<string, string>): Promise<unknown> {
  const response = await fetch(openAlexUrl(path, parameters), { signal: AbortSignal.timeout(12000), next: { revalidate: 3600 } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("OpenAlex funder lookup failed", { path, status: response.status, body: body.slice(0, 500) });
    throw new Error(`OpenAlex funders unavailable: ${response.status}`);
  }
  return response.json();
}

const bareId = (id: string) => id.split("/").at(-1)!;

/** Funders whose names start with the words typed, as OpenAlex's autocomplete finds them. */
export async function searchOpenAlexFunders(query: string): Promise<FunderOption[]> {
  const body = autocompleteSchema.parse(await readOpenAlex("autocomplete/funders", { q: query }));
  return body.results.map((funder) => ({
    id: bareId(funder.id),
    name: funder.display_name,
    ...(funder.hint ? { detail: funder.hint } : {}),
  }));
}

export async function readOpenAlexFunderNames(ids: readonly string[]): Promise<Record<string, string>> {
  const body = fundersSchema.parse(
    await readOpenAlex("funders", { filter: `openalex_id:${ids.join("|")}`, select: "id,display_name", "per-page": "100" }),
  );
  return Object.fromEntries(body.results.map((funder) => [bareId(funder.id), funder.display_name]));
}
