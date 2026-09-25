import type { DigestRequest } from "./contract";

type Publication = DigestRequest["publications"][number];
export type CitationRepair = {text: string; href: string; key: string | null; method: "typo" | "jev" | "unlinked"; verified?: number};

const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = "~typesafe/jev-latest";
// Benchmarked on 54 real digest citations: a Jev pick is only trusted when its
// check scores at least 0.9. Wrong picks (another paper by the same authors)
// scored up to 0.88.
const VERIFIED = 0.9;
const SHORTLIST = 20;
// Link text may hold one level of brackets, as in [Mills [2026]](/lib/KEY).
const LINK = /\[((?:[^[\]]|\[[^[\]]*\])*)\]\(([^)\s]*)\)/g;
const CITATION = /^\/lib\/([A-Z0-9]{8})$/;

const fold = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (value: string) => new Set(fold(value).match(/[a-z]{4,}/g) ?? []);

/** The first author's surname and the year from link text such as "Mills et al., 2026". */
function citedAuthor(text: string) {
  const year = text.match(/\d{4}/)?.[0];
  const surname = fold(text.split(/,|\(| et al| and | & |\d/)[0]!.trim()).split(" ").at(-1) ?? "";
  return {surname, year};
}

/** The cited surname must be one of a creator's names and the cited year the publication's. */
function matchesCitation(publication: Publication, text: string) {
  const {surname, year} = citedAuthor(text);
  return Boolean(surname && year) && (publication.date ?? "").includes(year!)
    && publication.creators.some(creator => fold(creator).split(/[\s,]+/).includes(surname));
}

/** Edit distance where swapping two neighbouring characters counts as one edit. */
function editDistance(a: string, b: string) {
  const d = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => (i && j ? 0 : i + j)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

function sentenceAround(markdown: string, start: number, end: number) {
  const from = Math.max(markdown.lastIndexOf("\n", start), markdown.lastIndexOf(". ", start)) + 1;
  const stops = [markdown.indexOf(". ", end), markdown.indexOf("\n", end)].filter(index => index !== -1);
  return markdown.slice(from, stops.length ? Math.min(...stops) + 1 : markdown.length).trim();
}

function describe(publication: Publication, withAbstract = false) {
  const authors = publication.creators.slice(0, 3).join(", ") || "Unknown author";
  let text = `${authors} (${(publication.date ?? "n.d.").slice(0, 4)}). ${publication.title}`;
  if (withAbstract && publication.abstract) text += ` Abstract: ${publication.abstract.slice(0, 240)}`;
  return text.slice(0, 420);
}

async function askJev(questions: Record<string, unknown>, state: string, signal?: AbortSignal) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const response = await fetch(JEV_URL, {
    method: "POST",
    headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json"},
    body: JSON.stringify({model: JEV_MODEL, state, questions}),
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`Jev returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json() as {answers?: Record<string, {choice?: string; noul?: number}>}).answers ?? null;
}

/** Asks Jev which shortlisted publication a broken citation means, then has it check that pick. */
async function pickWithJev(text: string, sentence: string, publications: Publication[], signal?: AbortSignal) {
  const {surname, year} = citedAuthor(text);
  const context = words(sentence);
  const shortlist = publications
    .map(publication => {
      let score = [...words(`${publication.title} ${(publication.abstract ?? "").slice(0, 500)}`)].filter(word => context.has(word)).length;
      if (surname && publication.creators.some(creator => fold(creator).split(/[\s,]+/).includes(surname))) score += 10;
      if (year && (publication.date ?? "").includes(year)) score += 3;
      return {publication, score};
    })
    .sort((a, b) => b.score - a.score || a.publication.key.localeCompare(b.publication.key))
    .slice(0, SHORTLIST)
    .map(({publication}) => publication);
  const choice = (await askJev({c: {
    type: "choice",
    instructions: "Which publication does this citation refer to? Choose none if no option clearly matches the cited author, year and claim.",
    criteria: {...Object.fromEntries(shortlist.map(publication => [publication.key, describe(publication)])), none: "None of these publications matches the citation."},
  }}, `Passage from a research digest: ${sentence}\nThe citation [${text}] has a broken publication key.`, signal))?.c?.choice;
  const picked = shortlist.find(publication => publication.key === choice);
  if (!picked || !matchesCitation(picked, text)) return null;
  const verified = (await askJev({v: {
    type: "noul",
    instructions: `Is the citation '${text}' in this passage a reference to the candidate publication (same authors, year and topic)?`,
    criteria: {true: "It is this publication.", false: "It is a different publication."},
  }}, `Passage from a research digest: ${sentence}\nCandidate publication: ${describe(picked, true)}`, signal))?.v?.noul ?? 0;
  return {key: picked.key, verified};
}

/**
 * Keeps every valid citation, repairs broken ones where that is safe, and turns
 * the rest into plain text. A typo of a real key by the cited author is fixed
 * directly; otherwise Jev picks from a shortlist and must pass its own check.
 */
export async function repairCitations(markdown: string, publications: Publication[], signal?: AbortSignal) {
  const byKey = new Map(publications.map(publication => [publication.key, publication]));
  const broken = new Map<string, {text: string; href: string; sentence: string}>();
  for (const match of markdown.matchAll(LINK)) {
    const [whole, text, href] = match as unknown as [string, string, string];
    if (byKey.has(href.match(CITATION)?.[1] ?? "")) continue;
    broken.set(`${text}\u0000${href}`, {text, href, sentence: sentenceAround(markdown, match.index!, match.index! + whole.length)});
  }
  const repairs = await Promise.all([...broken.values()].map(async ({text, href, sentence}): Promise<CitationRepair> => {
    // Only a broken publication link can be repaired; any other link loses its target.
    if (!href.startsWith("/lib/")) return {text, href, key: null, method: "unlinked"};
    const key = href.slice(5).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const typos = publications.filter(publication => matchesCitation(publication, text)
      && (editDistance(key, publication.key) <= 2 || (key.length >= 4 && publication.key.startsWith(key.slice(0, 4)))));
    if (typos.length === 1) return {text, href, key: typos[0]!.key, method: "typo"};
    try {
      const pick = await pickWithJev(text, sentence, publications, signal);
      if (pick && pick.verified >= VERIFIED) return {text, href, key: pick.key, method: "jev", verified: pick.verified};
      return {text, href, key: null, method: "unlinked", ...(pick ? {verified: pick.verified} : {})};
    } catch (error) {
      // Even a timeout keeps the finished digest; only this citation loses its link.
      console.error("Digest citation check with Jev failed", {text, href, error});
      return {text, href, key: null, method: "unlinked"};
    }
  }));
  const fixed = new Map(repairs.map(repair => [`${repair.text}\u0000${repair.href}`, repair.key]));
  const repaired = markdown.replace(LINK, (whole, text: string, href: string) => {
    const id = `${text}\u0000${href}`;
    if (!fixed.has(id)) return whole;
    const key = fixed.get(id);
    return key ? `[${text}](/lib/${key})` : text;
  // Anything still shaped like a link target that is not a supplied publication loses it.
  }).replace(/\]\(([^)]*)\)/g, (whole, href: string) => (byKey.has(href.match(CITATION)?.[1] ?? "") ? whole : "]"));
  return {markdown: repaired, repairs};
}
