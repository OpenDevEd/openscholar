import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { SEARCH_SOURCE_FLAG, sourceFromFlag, type SearchSource } from "./source";

/** How long this server trusts what it last read. A site admin's change reaches every search within this. */
const KEPT_MS = 10_000;

let known: { source: SearchSource; at: number } | null = null;

/**
 * The source a request from the browser reads: the one the page says, so results are never kept under the wrong source
 * in the moments after a switch; the site's when it says none or something else.
 */
export const chosenSource = async (given: unknown): Promise<SearchSource> => (given === "openalex" || given === "openscholar" ? given : await activeSearchSource());

/** The source the site's searches read. When Convex can't say, the last one it said, and OpenAlex before it has said any. */
export async function activeSearchSource(): Promise<SearchSource> {
  if (known && Date.now() - known.at < KEPT_MS) return known.source;
  try {
    const flags = await fetchQuery(api.featureFlags.queries.list);
    known = { source: sourceFromFlag(flags.page.find((flag) => flag.key === SEARCH_SOURCE_FLAG)?.enabled), at: Date.now() };
    return known.source;
  } catch (error) {
    console.error("[search source] couldn't read the active source", error);
    return known?.source ?? "openalex";
  }
}
