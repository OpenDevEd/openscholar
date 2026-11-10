// MOCK (mock/author-lookup): people found on ORCID and institutions' ROR IDs, for a report's authors. ORCID's public
// API answers a search without a token; the real build sends the same requests from Convex.
import { openAlexFetch } from "@/lib/openalex/fetch";
import { openAlexUrl } from "@/lib/openalex/request-url";

const ORCID_SEARCH = "https://pub.orcid.org/v3.0/expanded-search/";
/** ORCID and OpenAlex both ask a client to name itself. */
const USER_AGENT = "Openscholar/1.0 (+https://openscholar.ai)";

export type OrcidPerson = { orcid: string; name: string; institutions: string[] };

async function searchOrcid(q: string, rows: number): Promise<OrcidPerson[]> {
  const url = new URL(ORCID_SEARCH);
  url.searchParams.set("q", q);
  url.searchParams.set("rows", String(rows));
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ORCID search ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { "expanded-result": Array<{ "orcid-id": string; "given-names"?: string | null; "family-names"?: string | null; "institution-name"?: string[] }> | null };
  return (body["expanded-result"] ?? []).map((r) => ({
    orcid: r["orcid-id"],
    name: [r["given-names"], r["family-names"]].filter(Boolean).join(" "),
    institutions: [...new Set(r["institution-name"] ?? [])],
  }));
}

/** A phrase for ORCID's search, with nothing in it that its query language reads. */
const phrase = (words: string) => `"${words.replace(/["\\]/g, " ").trim()}"`;
/** A name as letters alone, so Björn Haßler and Bjorn Hassler are the same. */
const folded = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLowerCase().replace(/[^\p{L} ]/gu, " ").replace(/\s+/g, " ").trim();

/** People on ORCID for the words typed, best first: those at one of the author's institutions, then everyone else. */
export async function findOrcidPeople(words: string, institutions: string[] = []) {
  const [near, all] = await Promise.all([
    institutions.length ? searchOrcid(`given-and-family-names:(${words.replace(/[():"\\]/g, " ")}) AND (${institutions.map((i) => `affiliation-org-name:${phrase(i)}`).join(" OR ")})`, 5) : [],
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
  if (!name.trim() || !institutions.length) return null;
  const q = `given-and-family-names:${phrase(name)} AND (${institutions.map((i) => `affiliation-org-name:${phrase(i)}`).join(" OR ")})`;
  const same = (await searchOrcid(q, 5)).filter((person) => folded(person.name) === folded(name));
  if (same.length !== 1) return null;
  const person = same[0]!;
  const institution = institutions.find((i) => person.institutions.some((at) => folded(at) === folded(i))) ?? institutions[0]!;
  return { orcid: person.orcid, institution };
}

/** An OpenAlex institution's ROR ID, as https://ror.org/…, or none when OpenAlex has none for it. */
export async function rorOf(institutionId: string): Promise<string | null> {
  const id = institutionId.split("/").at(-1)!;
  if (!/^I\d+$/.test(id)) return null;
  const response = await openAlexFetch(openAlexUrl(`institutions/${id}`, { select: "ror" }), { headers: { "User-Agent": USER_AGENT }, timeoutMs: 10_000 });
  if (!response.ok) throw new Error(`OpenAlex institution ${id} ${response.status}`);
  const { ror } = (await response.json()) as { ror?: string | null };
  return ror || null;
}

const ROR_API = "https://api.ror.org/v2/organizations";
type RorRecord = { id: string; status: string; names: Array<{ value: string; types: string[] }>; locations: Array<{ geonames_details?: { name?: string; country_name?: string } }> };
/** An organisation on ROR: its ROR ID, its name as ROR shows it, and its city and country as "Cambridge, United Kingdom". */
export type RorOrganisation = { ror: string; name: string; place: string };

const rorName = (record: RorRecord) => record.names.find((n) => n.types.includes("ror_display"))?.value ?? record.names[0]?.value ?? "";
const placeOf = (record: RorRecord) => [record.locations[0]?.geonames_details?.name, record.locations[0]?.geonames_details?.country_name].filter(Boolean).join(", ");
const organisationOf = (record: RorRecord): RorOrganisation => ({ ror: record.id, name: rorName(record), place: placeOf(record) });

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

/** The organisation ROR's affiliation matcher is sure a printed affiliation names, or none when it isn't sure. */
export async function matchRor(affiliation: string): Promise<RorOrganisation | null> {
  const { items } = await rorGet<{ items: Array<{ chosen: boolean; organization: RorRecord }> }>({ affiliation });
  const chosen = items.find((item) => item.chosen)?.organization;
  return chosen ? organisationOf(chosen) : null;
}
