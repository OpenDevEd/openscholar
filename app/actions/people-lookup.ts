"use server";
// The site's lookups of people on ORCID and institutions on ROR (lib/people/identifiers.ts), for a signed-in person:
// a report's details form and the profile setup.
import { auth } from "@clerk/nextjs/server";
import { findOrcidPeople, findRorOrganisations, type OrcidPerson, type RorOrganisation } from "@/lib/people/identifiers";

/** People on ORCID for a name or the words typed, those at the person's institutions first. */
export async function findOrcid(words: string, institutions: string[]): Promise<Array<OrcidPerson & { near: boolean }>> {
  const text = words.trim().slice(0, 200);
  if (!text || !(await auth()).userId) return [];
  try {
    return await findOrcidPeople(text, institutions.slice(0, 5).map((i) => i.slice(0, 200)));
  } catch (error) {
    // The picker says ORCID can't be searched now; why is kept here.
    console.error(JSON.stringify({ event: "orcid-search-failed", error: String(error).slice(0, 300) }));
    throw error;
  }
}

/** Organisations on ROR for an institution's name as it is typed, for the ones OpenAlex doesn't know. */
export async function findRor(words: string): Promise<RorOrganisation[]> {
  const text = words.trim().slice(0, 200);
  if (!text || !(await auth()).userId) return [];
  // OpenAlex's results still list without ROR's: a failed search adds none, and why is kept here.
  return findRorOrganisations(text).catch((error: unknown) => {
    console.error(JSON.stringify({ event: "ror-search-failed", error: String(error).slice(0, 300) }));
    return [];
  });
}
