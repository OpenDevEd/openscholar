"use node";
/**
 * Writes a paper's citation in a style (./citations.ts), with the engine and styles the
 * citation button uses (lib/citations). A Node action, so they load once per runtime and
 * never with the modules that list the assistant's actions.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";
import { getPaperCitationMetadata } from "../../lib/citations/server";
import { formatAdditionalCitation, formatCitation } from "../../lib/citations/formatter";
import { CITATION_FORMATS } from "../../lib/citations/formats";
import { loadCitationStyles } from "../../lib/citations/styles";

/** A style by its ID: one of the main formats, or one the citation picker lists. Its name, or a refusal that says what's taken. */
async function styleNamed(style: string) {
  const main = CITATION_FORMATS.find((format) => format.id === style);
  if (main) return { label: main.label, main: main.id };
  const other = (await loadCitationStyles()).find((each) => each.id === style && each.asset);
  if (!other?.asset) throw createError("VALIDATION_ERROR", `No citation style is called "${style.slice(0, 100)}". Use apa, harvard, chicago, mla, vancouver or bibtex, or a style's ID as the citation picker lists it, such as ieee.`);
  return { label: other.label, other };
}

/** Whether a style is one there is, before a paper is read for it. */
export const checkStyle = internalAction({
  args: { style: v.string() },
  returns: v.null(),
  handler: async (_ctx, { style }) => {
    await styleNamed(style);
    return null;
  },
});

export const format = internalAction({
  // `data`: the paper as citation data, as JSON (lib/citations/paper-data.ts).
  args: { data: v.string(), style: v.string() },
  returns: v.object({ style: v.string(), citation: v.string() }),
  handler: async (_ctx, { data, style }) => {
    // Its DOI's metadata from the publisher where there is some, as the citation button reads it; what OpenAlex has otherwise.
    const paper = await getPaperCitationMetadata(JSON.parse(data));
    const named = await styleNamed(style);
    if (named.main) return { style: named.label, citation: formatCitation(paper, "en-US", named.main).text };
    // The style's own file, served with the app.
    return { style: named.label, citation: (await formatAdditionalCitation(paper, "en-US", { ...named.other!, asset: new URL(named.other!.asset!, requireAppUrl()).href })).text };
  },
});
