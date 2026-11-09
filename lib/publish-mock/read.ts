// MOCK (mock/publish-reports): plain rules that give the mock's sample reports their goals, places and keywords, and the
// country an OpenAlex institution's place names. A report someone uploads is read by the model (./reader.ts).
import { COUNTRIES } from "@/lib/constants";
import { SDGS } from "@/lib/openalex/vocabulary";

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

/** The few words the text leans on most, as keywords. */
export function keywordsFrom(text: string, limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const w of words(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}
