// People found on ORCID and institutions found on ROR, for a report's authors and a person's profile. Both public APIs
// answer a search without a token. The site's lookups ask them from the Next server; reading a report asks from Convex.

const ORCID_SEARCH = "https://pub.orcid.org/v3.0/expanded-search/";
/** ORCID and ROR both ask a client to name itself. */
const USER_AGENT = "Openscholar (https://openscholar.ai)";

export type OrcidPerson = { orcid: string; name: string; institutions: string[] };

/** The people on one page of an ORCID search, and how many it found in all. */
async function searchOrcidPage(q: string, rows: number): Promise<{ people: OrcidPerson[]; found: number }> {
  const url = new URL(ORCID_SEARCH);
  url.searchParams.set("q", q);
  url.searchParams.set("rows", String(rows));
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ORCID search ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { "expanded-result": Array<{ "orcid-id": string; "given-names"?: string | null; "family-names"?: string | null; "institution-name"?: string[] }> | null; "num-found"?: number };
  const people = (body["expanded-result"] ?? []).map((r) => ({
    orcid: r["orcid-id"],
    name: [r["given-names"], r["family-names"]].filter(Boolean).join(" "),
    institutions: [...new Set(r["institution-name"] ?? [])],
  }));
  return { people, found: body["num-found"] ?? people.length };
}
const searchOrcid = async (q: string, rows: number) => (await searchOrcidPage(q, rows)).people;

/** How many people the match reads: more than that found means it can't tell one person from the rest. */
const MATCH_ROWS = 20;

/** A phrase for ORCID's search, with nothing in it that its query language reads. */
const phrase = (words: string) => `"${words.replace(/["\\]/g, " ").trim()}"`;
/** A name as letters and digits alone, so Björn Haßler and Bjorn Hassler are the same, and University of Medicine 1 and 2 are not. */
const folded = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** People on ORCID for the words typed, best first: those at one of the author's institutions, then everyone else. */
export async function findOrcidPeople(words: string, institutions: string[] = []) {
  const at = atInstitutions(institutions);
  const [near, all] = await Promise.all([
    at ? searchOrcid(`given-and-family-names:(${words.replace(/[():"\\]/g, " ")}) AND ${at}`, 5) : [],
    searchOrcid(words, 8),
  ]);
  const seen = new Set(near.map((person) => person.orcid));
  return [...near.map((person) => ({ ...person, near: true })), ...all.filter((person) => !seen.has(person.orcid)).map((person) => ({ ...person, near: false }))];
}

/**
 * The ORCID iD of the one person on ORCID with exactly this name who has worked at one of these institutions, and
 * the institution that matched; null when there is no such person or there are several. ponytail: one request per
 * author with no iD, and a name spelt differently from its ORCID record (Bjoern for Björn) finds nobody.
 */
export async function matchOrcid(name: string, institutions: string[]): Promise<{ orcid: string; institution: string } | null> {
  const named = institutions.filter((i) => queryWords(i).length);
  const at = atInstitutions(named);
  if (!name.trim() || !at) return null;
  const q = `given-and-family-names:${phrase(name)} AND ${at}`;
  const { people, found } = await searchOrcidPage(q, MATCH_ROWS);
  // Every person the search found is read, or none is taken: one more past the page could share the name.
  if (found > people.length) return null;
  // Only someone whose own record names one of the author's institutions: the search matches words spread over
  // several of a record's affiliations too.
  const matches = people.flatMap((person) => {
    const institution = folded(person.name) === folded(name) ? named.find((i) => person.institutions.some((at) => sameInstitution(i, at))) : undefined;
    return institution ? [{ orcid: person.orcid, institution }] : [];
  });
  return matches.length === 1 ? matches[0]! : null;
}

/** Words that tell one organisation's name from another's; "The Research and Evaluation Centre" is research, evaluation, centre. */
const LINKING_WORDS = new Set(["and", "of", "the", "for", "in", "at"]);
const telling = (words: string) => words.split(" ").filter((word) => word && !LINKING_WORDS.has(word));
const institutionWords = (name: string) => telling(organisationName(name));
/** The same words with their accents: ORCID's affiliation search reads "montreal" and "montréal" as different words. */
const queryWords = (name: string) => telling(name.normalize("NFC").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim());
/** ORCID's search for anyone with an affiliation holding every word of one of these institutions; none for no words. */
const atInstitutions = (institutions: string[]) => {
  const each = institutions.map(queryWords).filter((words) => words.length);
  return each.length ? `(${each.map((words) => `affiliation-org-name:(${words.map((w) => `+${w}`).join(" ")})`).join(" OR ")})` : "";
};

/**
 * Whether an institution on an ORCID record is the one a PDF printed: the record's name holds every word of the
 * printed one, so "Campbell South Asia" is "Campbell Collaboration South Asia" and "The Research and Evaluation
 * Centre" is "Research & Evaluation Centre UK". ponytail: a short printed name can sit inside another organisation's
 * ("University of Oxford" in "Oxford Brookes University"); the person's exact name and being the only match guard it.
 */
export function sameInstitution(printed: string, recorded: string) {
  const words = institutionWords(printed);
  const held = new Set(institutionWords(recorded));
  return words.length > 0 && words.every((word) => held.has(word));
}

const ROR_API = "https://api.ror.org/v2/organizations";
type RorRecord = { id: string; status: string; names: Array<{ value: string; types: string[] }>; locations: Array<{ geonames_details?: { name?: string; country_name?: string } }> };
/**
 * An organisation on ROR: its ROR ID, its name as ROR shows it, its other names and acronyms ("FCDO", "Bill & Melinda
 * Gates Foundation"), and its city and country as "Cambridge, United Kingdom".
 */
export type RorOrganisation = { ror: string; name: string; aliases: string[]; place: string };

const rorName = (record: RorRecord) => record.names.find((n) => n.types.includes("ror_display"))?.value ?? record.names[0]?.value ?? "";
const placeOf = (record: RorRecord) => [record.locations[0]?.geonames_details?.name, record.locations[0]?.geonames_details?.country_name].filter(Boolean).join(", ");
const organisationOf = (record: RorRecord): RorOrganisation => {
  const name = rorName(record);
  return { ror: record.id, name, aliases: record.names.map((n) => n.value).filter((value) => value !== name), place: placeOf(record) };
};

/** ROR's API asks no key; it allows 2,000 requests in five minutes from one address. */
async function rorGet<T>(parameters: Record<string, string>): Promise<T> {
  const url = new URL(ROR_API);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ROR ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()) as T;
}

/**
 * Active organisations on ROR whose names hold every word typed, the last one as the start of a word, so a name half
 * typed finds them: ROR's plain search matches whole words only.
 */
export async function findRorOrganisations(words: string): Promise<RorOrganisation[]> {
  const terms = words.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const query = terms.map((term, i) => (i === terms.length - 1 ? `${term}*` : term)).join(" AND ");
  const { items } = await rorGet<{ items: RorRecord[] }>({ "query.advanced": `names.value:(${query})` });
  return items.filter((record) => record.status === "active").slice(0, 6).map(organisationOf);
}

/**
 * What ROR says of an organisation: the Funder Registry ID it lists (`100000001`), which Crossref's funder DOIs are made
 * from, or none when Crossref has no such funder; and its first type ("education", "funder"…). Both are null for an
 * organisation ROR doesn't have. Unreadable answers throw, so a deposit waits rather than going without them.
 */
export async function rorFacts(ror: string): Promise<{ fundref: string | null; type: string | null }> {
  const response = await fetch(`${ROR_API}/${encodeURIComponent(ror)}`, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return { fundref: null, type: null };
  if (!response.ok) throw new Error(`ROR ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const record = (await response.json()) as { types?: string[]; external_ids?: Array<{ type: string; preferred: string | null; all: string[] }> };
  const fundref = record.external_ids?.find((id) => id.type === "fundref");
  return { fundref: fundref?.preferred ?? fundref?.all[0] ?? null, type: record.types?.[0] ?? null };
}

/** An organisation's name as letters and digits alone, "&" read as "and", without a leading "The": "The Data Lab" is "Data Lab". */
const organisationName = (name: string) => folded(name.replace(/&/g, " and ")).replace(/^the /, "");

/**
 * The one record among these that carries exactly the name printed; none when none does, or several do (a Ministry
 * of Health in every country). A registry's best guess is never taken for a name it doesn't carry.
 */
export function namedExactly<T>(records: readonly T[], printed: string, namesOf: (record: T) => string[]): T | undefined {
  const same = records.filter((record) => namesOf(record).some((name) => organisationName(name) === organisationName(printed)));
  return same.length === 1 ? same[0] : undefined;
}

/**
 * The organisation ROR's affiliation matcher picks for a printed name, only when that name is one of its own. The
 * matcher picks an organisation named anywhere inside the text it's given, so alone it reads "Enugu Schools Data Lab"
 * as The Data Lab.
 */
export async function matchRor(affiliation: string): Promise<RorOrganisation | null> {
  const { items } = await rorGet<{ items: Array<{ chosen: boolean; organization: RorRecord }> }>({ affiliation });
  const chosen = items.filter((item) => item.chosen).map((item) => item.organization);
  const named = namedExactly(chosen, affiliation, (record) => record.names.map((n) => n.value));
  return named ? organisationOf(named) : null;
}
