/**
 * A paper cited in a citation style (#323), as the citation button on a paper does: its
 * record from OpenAlex, then written in the style by the same engine (./citationFormat.ts).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { readWork } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { paperToCitationData } from "../../lib/citations/paper-data";
import { CITATION_FORMATS } from "../../lib/citations/formats";
import { locales } from "../../i18n/config";
import type { PaperResult } from "../../lib/types/search.types";

/** What a citation reads of a paper (lib/citations/paper-data.ts). */
const CITED = "id,title,display_name,type,type_crossref,authorships,publication_date,publication_year,primary_location,language,biblio,doi";
const citedValidator = v.object({ title: v.string(), style: v.string(), citation: v.string() });

export const citeAction = defineUserAction({
  path: "research/citations:cite",
  description:
    "Cites one paper in a citation style, by its ID as results give it, such as W2741809807: apa, harvard, chicago, mla, vancouver or bibtex, or any of the citation picker's other styles by its ID, such as ieee or nature. " +
    "`language` is the language the person writes to you in, as en-US, en-GB, fr, hi, ja or zh, for the style's own words and dates; English otherwise. Returns the citation as text, with the paper's title and the style's name. The paper's record is one request against the person's OpenAlex allowance; its DOI's metadata comes from the publisher where there is some.",
  args: { id: v.string(), style: v.string(), language: v.optional(v.union(v.string(), v.null())) },
  returns: citedValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, { userId }, { id, style, language }): Promise<{ title: string; style: string; citation: string }> => {
    const work = /^(?:https:\/\/openalex\.org\/)?(W\d+)$/i.exec(id.trim())?.[1]?.toUpperCase();
    if (!work) throw createError("VALIDATION_ERROR", "A paper is cited by its ID, such as W2741809807.");
    const asked = style.trim().toLowerCase();
    // A style there isn't is refused before the paper is read: the main formats here, the picker's others where they're kept.
    if (!CITATION_FORMATS.some((format) => format.id === asked)) await ctx.runAction(internal.research.citationFormat.checkStyle, { style: asked });
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const paper = await readWork<PaperResult>(work, CITED, spender(ctx, person.clerkId));
    if (!paper) throw createError("NOT_FOUND", "OpenAlex has no paper by that ID.");
    const data = paperToCitationData(paper);
    if (!data) throw createError("VALIDATION_ERROR", "OpenAlex has no title for this paper, so it can't be cited.");
    const written: { style: string; citation: string } = await ctx.runAction(internal.research.citationFormat.format, { data: JSON.stringify(data), style: asked, language: language && (locales as readonly string[]).includes(language) ? language : "en-US" });
    return { title: data.title, ...written };
  },
});
export const cite = userAction(citeAction);
export const citeForAssistant = assistantAction(citeAction);
