import assets from "./assets/csl.json";
import { CSL } from "citeproc-ts";
import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import { CITATION_FORMATS, type CitationData, type Citations } from "@/lib/citations/formats";

const localeAssets: Record<string, unknown> = assets.locales;
const locales: Record<string, string> = { en: "en-GB", de: "de-DE", fr: "fr-FR", hi: "hi-IN", pt: "pt-PT", zh: "zh-CN", cn: "zh-CN", ja: "ja-JP" };

/** Every request gets its own processors; only immutable style assets are shared. */
export async function formatCitations(data: CitationData, language: string): Promise<Citations> {
	const locale = locales[language] ?? language;
	const entries = await Promise.all(CITATION_FORMATS.map(async (format) => {
		if (format.id === "bibtex") {
			const record = data;
			return [format.id, new Cite([record]).format("bibtex", { format: "text" }).trim()] as const;
		}
		const style = assets.styles[format.style];
		const engine = new CSL.Engine({ retrieveItem: () => structuredClone(data), retrieveLocale: (requested) => localeAssets[locales[requested] ?? requested] ?? assets.locales["en-US"] }, style, locale);
		engine.setOutputFormat("text");
		engine.updateItems([data.id]);
		const bibliography = engine.makeBibliography();
		const text = bibliography && bibliography[1][0]?.trim();
		if (!text) throw new Error(`Citation formatting failed: ${format.id}`);
		return [format.id, text] as const;
	}));
	return Object.fromEntries(entries) as Citations;
}
