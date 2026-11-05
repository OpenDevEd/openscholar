import { SEARCH_SOURCE_NAMES, sourceForId } from "../../lib/search/source";
/**
 * An author as OpenAlex keeps them (#323): who they are, where they work and what they
 * publish on, for the assistant to say about someone a search found. Their papers are a
 * search filtered by them (./papers.ts).
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { readAuthor } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { linkLabel } from "../assistant/links";
import { AUTHOR_LISTED as LISTED, authorValidator } from "./searchValidators";

type OpenAlexAuthor = {
  id: string;
  display_name?: string | null;
  orcid?: string | null;
  works_count?: number;
  cited_by_count?: number;
  summary_stats?: { h_index?: number } | null;
  last_known_institutions?: Array<{ id?: string | null; display_name?: string | null; country_code?: string | null }> | null;
  topics?: Array<{ id?: string; display_name?: string; count?: number }> | null;
};
const lastPart = (id: string) => id.split("/").at(-1)!;

export const getAction = defineUserAction({
  path: "research/authors:get",
  description:
    "Reads an author by their OpenAlex ID, such as A5023888391, as results and research/lookup:find give it: their name, ORCID, where they work now, the research areas they publish in most, how many papers they have, how often they're cited and their h-index. " +
    "Their papers are research/papers:search with `authors`. One request against the person's OpenAlex allowance.",
  args: { id: v.string() },
  returns: authorValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, { userId }, { id }): Promise<Infer<typeof authorValidator>> => {
    const asked = /^(?:https:\/\/(?:openalex\.org|openscholar\.ai)\/)?((?:A|OSA)\d+)$/i.exec(id.trim())?.[1]?.toUpperCase();
    if (!asked) throw createError("VALIDATION_ERROR", "An author is read by their OpenAlex ID, such as A5023888391.");
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const source = sourceForId(asked, await ctx.runQuery(internal.featureFlags.internal.searchSource, {}));
    const author = await readAuthor<OpenAlexAuthor>(asked, "id,display_name,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,topics", spender(ctx, person.clerkId), source);
    if (!author) throw createError("NOT_FOUND", `${SEARCH_SOURCE_NAMES[source]} has no author by that ID.`);
    const name = author.display_name?.trim() || asked;
    return {
      id: asked,
      name,
      ...(author.orcid ? { orcid: author.orcid.replace(/^https?:\/\/orcid\.org\//, "") } : {}),
      institutions: (author.last_known_institutions ?? []).slice(0, LISTED).flatMap((at) => (at.id && at.display_name ? [{ id: lastPart(at.id), name: at.display_name, ...(at.country_code ? { country: at.country_code } : {}) }] : [])),
      areas: (author.topics ?? []).slice(0, LISTED).flatMap((topic) => (topic.id && topic.display_name ? [{ id: lastPart(topic.id), name: topic.display_name, papers: topic.count ?? 0 }] : [])),
      papers: author.works_count ?? 0,
      citations: author.cited_by_count ?? 0,
      ...(typeof author.summary_stats?.h_index === "number" ? { hIndex: author.summary_stats.h_index } : {}),
      // On our index a person's name finds their papers here, since nothing links out to OpenAlex.
      link: source === "openalex" ? `[${linkLabel(name)}](https://openalex.org/${asked})` : `[${linkLabel(name)}](/results?author=${asked})`,
    };
  },
});
export const get = userAction(getAction);
export const getForAssistant = assistantAction(getAction);
