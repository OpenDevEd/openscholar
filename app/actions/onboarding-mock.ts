"use server";
// MOCK (mock/onboarding): a new account's profile setup, kept in a local file by Clerk user. The real build keeps it on
// the user's row in Convex (an optional `onboarding` field) and the email choices with the mailing service.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { auth, currentUser } from "@clerk/nextjs/server";
import { blankSetup, EMAILS, type ProfileSetup } from "@/lib/onboarding-mock/types";
import type { Affiliation } from "@/lib/publish-mock/types";

const DIR = path.join(process.cwd(), ".onboarding-mock");
const FILE = path.join(DIR, "state.json");
/** Accounts made from this moment are asked on their first visit; older ones only when they open it from Settings. */
const RELEASED_AT = Date.parse("2026-11-10T00:00:00Z");

type State = Record<string, ProfileSetup>;
const readState = async (): Promise<State> => JSON.parse(await readFile(FILE, "utf8").catch(() => "{}")) as State;
async function writeState(state: State) {
  await mkdir(DIR, { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${FILE}.tmp`, FILE);
}

/** The person's answers, and whether the setup should open on its own: a new account that hasn't finished or skipped it. */
export async function readProfileSetup(): Promise<{ setup: ProfileSetup; due: boolean } | null> {
  const user = await currentUser();
  if (!user) return null;
  const kept = (await readState())[user.id];
  return { setup: kept ?? blankSetup(), due: !kept && user.createdAt >= RELEASED_AT };
}

const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const isAffiliation = (a: unknown): a is Affiliation => {
  const x = a as Affiliation;
  return !!x && typeof x.name === "string" && x.name.trim() !== "" && x.name.length <= 300 && (x.id === null || typeof x.id === "string") && typeof x.country === "string" && (x.ror === undefined || /^https:\/\/ror\.org\/0[a-z0-9]{8}$/.test(x.ror));
};

/** Saves the answers and marks the setup finished. */
export async function saveProfileSetup(answers: Pick<ProfileSetup, "affiliations" | "orcid" | "emails">): Promise<ProfileSetup> {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in to save your profile.");
  if (!Array.isArray(answers.affiliations) || answers.affiliations.length > 10 || !answers.affiliations.every(isAffiliation)) throw new Error("Those institutions can't be saved.");
  if (answers.orcid !== "" && !ORCID.test(answers.orcid)) throw new Error("That isn't an ORCID iD.");
  const emails = Object.fromEntries(EMAILS.map(({ id }) => [id, answers.emails?.[id] === true])) as ProfileSetup["emails"];
  const state = await readState();
  const setup: ProfileSetup = { affiliations: answers.affiliations, orcid: answers.orcid, emails, finishedAt: Date.now() };
  state[userId] = setup;
  await writeState(state);
  return setup;
}

/** Remembers that the person skipped the setup, so it doesn't open on its own again. Answers saved before stay. */
export async function skipProfileSetup(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  const state = await readState();
  state[userId] = { ...(state[userId] ?? blankSetup()), skippedAt: Date.now() };
  await writeState(state);
}
