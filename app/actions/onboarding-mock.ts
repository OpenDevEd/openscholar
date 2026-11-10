"use server";
// MOCK (mock/onboarding): a person's profile setup: their institutions, ORCID iD and the emails they want. The real
// build makes these Convex functions and passes the email choices on to the mailing service.
import { auth } from "@clerk/nextjs/server";
import { readSetupState, setupDue, writeSetupState } from "@/lib/onboarding-mock/store";
import { blankSetup, EMAILS, type ProfileAnswers, type ProfileSetup } from "@/lib/onboarding-mock/types";
import type { Affiliation } from "@/lib/publish-mock/types";

/** The person's answers, and whether the setup still stands in front of every page. */
export async function readProfileSetup(): Promise<{ setup: ProfileSetup; due: boolean } | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const kept = (await readSetupState())[userId];
  return { setup: kept ?? blankSetup(), due: await setupDue(userId, kept) };
}

const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const isAffiliation = (a: unknown): a is Affiliation => {
  const x = a as Affiliation;
  return !!x && typeof x.name === "string" && x.name.trim() !== "" && x.name.length <= 300 && (x.id === null || typeof x.id === "string") && typeof x.country === "string" && (x.ror === undefined || /^https:\/\/ror\.org\/0[a-z0-9]{8}$/.test(x.ror));
};

/** Saves the answers, from the setup or from Settings; the setup is then done. */
export async function saveProfileSetup(answers: ProfileAnswers): Promise<ProfileSetup> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in to save your profile.");
  if (!Array.isArray(answers.affiliations) || answers.affiliations.length > 10 || !answers.affiliations.every(isAffiliation)) throw new Error("Those institutions can't be saved.");
  if (answers.orcid !== "" && !ORCID.test(answers.orcid)) throw new Error("That isn't an ORCID iD.");
  const emails = Object.fromEntries(EMAILS.map(({ id }) => [id, answers.emails?.[id] === true])) as ProfileSetup["emails"];
  const state = await readSetupState();
  const { preview: _, ...kept } = state[userId] ?? blankSetup();
  const setup: ProfileSetup = { ...kept, affiliations: answers.affiliations, orcid: answers.orcid, emails, finishedAt: kept.finishedAt ?? Date.now() };
  state[userId] = setup;
  await writeSetupState(state);
  return setup;
}

/** The person skipped the setup: it stands in front of pages no more. Answers saved before stay. */
export async function skipProfileSetup(): Promise<ProfileSetup> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in to skip the setup.");
  const state = await readSetupState();
  const { preview: _, ...kept } = state[userId] ?? blankSetup();
  const setup: ProfileSetup = { ...kept, skippedAt: Date.now() };
  state[userId] = setup;
  await writeSetupState(state);
  return setup;
}
