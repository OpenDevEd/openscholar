"use server";
// The site's lookups of people on ORCID and institutions on ROR (lib/people/identifiers.ts), for a signed-in person:
// a report's details form and the profile setup.
import { auth } from "@clerk/nextjs/server";
import { findOrcidPeople, findRorOrganisations, type OrcidPerson, type RorOrganisation } from "@/lib/people/identifiers";

/** People on ORCID for a name or the words typed, those at the person's institutions first. */
export async function findOrcid(words: string, institutions: string[]): Promise<Array<OrcidPerson & { near: boolean }>> {
  const text = words.trim().slice(0, 200);
  if (!text || !(await auth()).userId) return [];
  return findOrcidPeople(text, institutions.slice(0, 5).map((i) => i.slice(0, 200)));
}

/** Organisations on ROR for an institution's name as it is typed, for the ones OpenAlex doesn't know. */
export async function findRor(words: string): Promise<RorOrganisation[]> {
  const text = words.trim().slice(0, 200);
  if (!text || !(await auth()).userId) return [];
  return findRorOrganisations(text).catch(() => []);
}
