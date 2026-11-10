import "server-only";
// MOCK (mock/onboarding): the profile setup's answers, kept in a local file by Clerk user. The real build keeps them on
// the user's row in Convex (an optional `onboarding` field), where `createdAt` already says when the account began.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { clerkClient } from "@clerk/nextjs/server";
import type { ProfileSetup } from "./types";

const DIR = path.join(process.cwd(), ".onboarding-mock");
const FILE = path.join(DIR, "state.json");
/** Accounts made from this moment are asked on their first visit; older ones edit the same answers in Settings. */
const RELEASED_AT = Date.parse("2026-11-10T00:00:00Z");

type State = Record<string, ProfileSetup>;
export const readSetupState = async (): Promise<State> => JSON.parse(await readFile(FILE, "utf8").catch(() => "{}")) as State;
export async function writeSetupState(state: State) {
  await mkdir(DIR, { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${FILE}.tmp`, FILE);
}

/** When each account began, asked of Clerk once. ponytail: kept for the server's life; the real build reads the user's row. */
const began = new Map<string, number>();
async function beganAt(userId: string) {
  let at = began.get(userId);
  if (at === undefined) {
    at = (await (await clerkClient()).users.getUser(userId)).createdAt;
    began.set(userId, at);
  }
  return at;
}

/** Whether the account is new and has neither finished nor skipped the setup. */
export async function setupDue(userId: string, kept?: ProfileSetup) {
  const answers = kept ?? (await readSetupState())[userId];
  if (answers?.preview) return true;
  if (answers?.finishedAt || answers?.skippedAt) return false;
  return (await beganAt(userId)) >= RELEASED_AT;
}
