// MOCK (mock/publish-reports): what the metadata model would read from a report's text, done with plain rules so the
// mock shows real catalog topics, goals, designs, places, funders, references and links. The real build asks the model
// set on the admin page, with these fields as its structured answer.
import { COUNTRIES } from "@/lib/constants";
import { SDGS, STUDY_DESIGNS } from "@/lib/openalex/vocabulary";
import type { Funding, Relation } from "./types";

const STOP = new Set(
  "about above after again against among and are because been before being between both but can could does doing down during each from further have having here into itself just more most other over own same should such than that their them then there these they this those through under until very were what when where which while will with within without would your across also among using used use two one per the for our its has had was not all any how who why may".split(" "),
);
const words = (text: string) => text.toLowerCase().match(/\p{L}[\p{L}'-]+/gu)?.filter((w) => w.length > 3 && !STOP.has(w)) ?? [];

const SDG_WORDS: Record<string, RegExp> = {
  "1": /\bpoverty|cash transfer|social protection\b/i,
  "2": /\bhunger|food security|nutrition|smallholder\b/i,
  "3": /\bhealth|disease|mortality\b/i,
  "4": /\bschool|pupil|teacher|learning|education|literacy|numeracy\b/i,
  "5": /\bgirls?\b|\bwomen\b|gender/i,
  "6": /\bwater|sanitation\b/i,
  "8": /\bemployment|jobs?\b|livelihood/i,
  "10": /\binequalit|wealth gap/i,
  "13": /\bclimate|heat|flood|drought|temperature/i,
};
/** The goals the text is plainly about. */
export const suggestSdgs = (text: string) => SDGS.filter((goal) => SDG_WORDS[goal.id]?.test(text)).map((goal) => goal.id);

const DESIGN_WORDS: Record<string, RegExp> = {
  "systematic-review": /systematic review/i,
  "meta-analysis": /meta-?analys/i,
  "randomized-controlled-trial": /randomi[sz]ed (controlled )?trial|randomly assigned|\bRCT\b/i,
  "observational-study": /observational|cohort|we follow|panel data|cross-sectional/i,
  "study-protocol": /study protocol/i,
};
export const suggestDesigns = (text: string) => STUDY_DESIGNS.filter((design) => DESIGN_WORDS[design.id]?.test(text)).map((design) => design.id);

const SHORT = new Intl.DisplayNames(["en"], { type: "region" });
/** Each country's names as text says them: its short English name and the catalog's formal one. */
const COUNTRY_NAMES = Object.entries(COUNTRIES).map(([code, formal]) => ({ code, names: [...new Set([SHORT.of(code) ?? formal, formal.split(",")[0]!])].filter((n) => n.length > 3) }));

/** The countries a text names, most named first. */
export function countriesIn(text: string): string[] {
  const counts = COUNTRY_NAMES.map(({ code, names }) => ({ code, n: names.reduce((sum, name) => sum + (text.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"))?.length ?? 0), 0) }));
  return counts.filter((c) => c.n > 0).sort((a, b) => b.n - a.n).map((c) => c.code);
}

/** The country an institution's place names, as OpenAlex's lookup gives it ("Accra, Ghana"). */
export function countryOfPlace(place: string | undefined): string {
  const last = place?.split(",").at(-1)?.trim();
  if (!last) return "";
  return COUNTRY_NAMES.find(({ names }) => names.some((n) => n.toLowerCase() === last.toLowerCase()))?.code ?? "";
}

/** Funders the text thanks, with their grant numbers. */
export function fundingIn(text: string): Funding[] {
  const out: Funding[] = [];
  for (const match of text.matchAll(/(?:funded|supported|financed) by (?:the )?([A-Z][\w&' -]{3,80}?)(?:\s*\((?:grant|award)?\s*(?:no\.?|number)?\s*([A-Z0-9][\w/.-]{2,30})\))?(?=[.,;]|\s+(?:and|under)\b)/g)) {
    const name = match[1]!.trim();
    if (!out.some((f) => f.funder.name === name)) out.push({ funder: { id: null, name }, awards: match[2] ? [match[2]] : [] });
  }
  return out;
}

/** The DOIs the text cites, apart from its own. */
export function doisIn(text: string, own: string): string[] {
  const found = (text.match(/\b10\.\d{4,9}\/[^\s"<>,;)]+/g) ?? []).map((doi) => doi.replace(/[.]+$/, "").toLowerCase());
  return [...new Set(found)].filter((doi) => doi !== own.toLowerCase());
}

/** Links to the work's data and code. */
export function linksIn(text: string): Relation[] {
  const found = text.match(/https?:\/\/[^\s)"<>]+/g) ?? [];
  return [...new Set(found)].flatMap((url): Relation[] =>
    /github\.com|gitlab\.com/.test(url) ? [{ kind: "code", target: url }] : /zenodo\.org|osf\.io|dataverse|figshare|datadryad/.test(url) ? [{ kind: "data", target: url }] : [],
  );
}

/** The few words the text leans on most, as keywords. */
export function keywordsFrom(text: string, limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const w of words(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}
