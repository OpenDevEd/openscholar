"use server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { openAlexUrl } from "@/lib/openalex/request-url";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";

const authorSchema = z.object({
  display_name: z.string(),
  orcid: z.string().nullish(),
  works_count: z.number(),
  cited_by_count: z.number(),
  summary_stats: z.object({ h_index: z.number().nullish() }).nullish(),
  last_known_institutions: z.array(z.object({ display_name: z.string(), country_code: z.string().nullish() })).nullish(),
  topics: z.array(z.object({ id: z.string(), display_name: z.string(), count: z.number() })).nullish(),
});

export type AuthorCard = {
  name: string;
  orcid: string | null;
  works: number;
  citations: number;
  hIndex: number | null;
  institution: { name: string; country: string | null } | null;
  /** The author's top topics, with how many of their papers each holds, most first. */
  topics: { id: string; name: string; papers: number }[];
  /** The hand-made profile that links this OpenAlex author, when one does. */
  profileId: string | null;
};

/**
 * The hand-made profile linked to an OpenAlex author: among those named like them and the
 * newest, the one whose OpenAlex id matches. Null when the caller's organisation has no
 * author profiles.
 */
// ponytail: mock lookup, misses an older profile named unlike its OpenAlex author; an index on authorProfiles.openalex replaces it in the real build.
async function linkedProfile(id: string, name: string) {
  const session = await auth();
  const token = (await session.getToken({ template: "convex" })) ?? undefined;
  const pages = await Promise.all([name, ""].map((search) =>
    fetchQuery(api.authors.profiles.list, { search, paginationOpts: { cursor: null, numItems: 30 } }, { token }).catch(() => null)));
  return pages.flatMap((rows) => rows?.page ?? []).find((profile) => profile.openalex === id)?._id ?? null;
}

/** The "test author" profile on shared dev, which every mock card without a linked profile goes to. */
const DEMO_PROFILE = "t57aha45aqex5padqh3wcgekgd8fqjca";

/** How many of an author's topics the card lists. */
const TOP_TOPICS = 3;

/** What an author's hover card shows, from OpenAlex and the author profiles. */
export async function readAuthorCard(id: string) {
  if (!/^A\d+$/.test(id)) throw new Error("Invalid OpenAlex author");
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const url = openAlexUrl(`authors/${id}`, { select: "display_name,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,topics" });
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OpenAlex author returned ${response.status}`);
  const author = authorSchema.parse(await response.json());
  const institution = author.last_known_institutions?.[0];
  return {
    name: author.display_name,
    orcid: author.orcid?.replace("https://orcid.org/", "") ?? null,
    works: author.works_count,
    citations: author.cited_by_count,
    hIndex: author.summary_stats?.h_index ?? null,
    institution: institution ? { name: institution.display_name, country: institution.country_code ?? null } : null,
    topics: (author.topics ?? []).slice(0, TOP_TOPICS).map((topic) => ({ id: topic.id.replace("https://openalex.org/", ""), name: topic.display_name, papers: topic.count })),
    // ponytail: mock only, every author links to the demo profile so the card shows its page link; the real build links a matched profile or the author's own page.
    profileId: (await linkedProfile(id, author.display_name)) ?? DEMO_PROFILE,
  } satisfies AuthorCard;
}
