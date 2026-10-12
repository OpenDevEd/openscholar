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

export const format = internalAction({
  // `data`: the paper as citation data, as JSON (lib/citations/paper-data.ts).
  args: { data: v.string(), style: v.string() },
  returns: v.object({ style: v.string(), citation: v.string() }),
  handler: async (_ctx, { data, style }) => {
    // Its DOI's metadata from the publisher where there is some, as the citation button reads it; what OpenAlex has otherwise.
    const paper = await getPaperCitationMetadata(JSON.parse(data));
    const main = CITATION_FORMATS.find((format) => format.id === style);
    if (main) return { style: main.label, citation: formatCitation(paper, "en-US", main.id).text };
    const other = (await loadCitationStyles()).find((each) => each.id === style && each.asset);
    if (!other?.asset) throw createError("VALIDATION_ERROR", `No citation style is called "${style.slice(0, 100)}". Use apa, harvard, chicago, mla, vancouver or bibtex, or a style's ID as the citation picker lists it, such as ieee.`);
    // The style's own file, served with the app.
    return { style: other.label, citation: (await formatAdditionalCitation(paper, "en-US", { ...other, asset: new URL(other.asset, requireAppUrl()).href })).text };
  },
});
