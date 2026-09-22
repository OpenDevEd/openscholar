import assets from "./assets/csl.json";
import { CSL } from "citeproc-ts";
import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import { CITATION_FORMATS, type CitationData, type Citations, type CitationStyle } from "@/lib/citations/formats";

import { loadCitationStyleAssets } from "./styles";

const localeAssets: Record<string, unknown> = assets.locales;
const locales: Record<string, string> = { en: "en-GB", de: "de-DE", fr: "fr-FR", hi: "hi-IN", pt: "pt-PT", zh: "zh-CN", cn: "zh-CN", ja: "ja-JP" };

/** Every request gets its own processors; only immutable style assets are shared. */
export async function formatCitations(data: CitationData, language: string): Promise<Citations> {
	const locale = locales[language] ?? language;
	const entries = await Promise.all(CITATION_FORMATS.map(async (format) => {
		if (format.id === "bibtex") {
			return [format.id, new Cite([data]).format("bibtex", { format: "text" }).trim()] as const;
		}
        return [format.id, renderCitation(data, locale, assets.styles[format.style], localeAssets)] as const;
	}));
	return Object.fromEntries(entries) as Citations;
}

function renderCitation(data: CitationData, locale: string, style: unknown, availableLocales: Record<string, unknown>): string {
  const engine = new CSL.Engine({ retrieveItem: () => structuredClone(data), retrieveLocale: requested => availableLocales[locales[requested] ?? requested] ?? assets.locales["en-US"] }, style, locale);
  engine.setOutputFormat("text");
  engine.updateItems([data.id]);
  const bibliography = engine.makeBibliography();
  // Note-only CSL styles intentionally define a citation without a bibliography.
  const text = (bibliography ? bibliography[1][0] : engine.makeCitationCluster([{ id: data.id }])).trim();
  if (!text) throw new Error("Citation formatting failed");
  return text;
}

export async function formatAdditionalCitation(data: CitationData, language: string, selected: CitationStyle): Promise<string> {
  if (!selected.asset) throw new Error("An additional citation style is required");
  const extra = await loadCitationStyleAssets(selected.asset);
  const style = extra.styles[selected.id];
  if (!style) throw new Error("Citation style not found");
  return renderCitation(data, locales[language] ?? language, style, { ...localeAssets, ...extra.locales });
}
