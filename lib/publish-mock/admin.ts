// MOCK (mock/publish-reports): who is an Openscholar admin, asked of Convex as the admin pages ask it
// (convex/admins/queries.ts). The real build's reviewing and settings are Convex functions that check this themselves.
import { auth, clerkClient } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Account } from "./types";

/** How long an answer is kept, so an admin's every click doesn't wait on Convex. MOCK: the real functions check in place. */
const REMEMBER_MS = 60_000;
const answers = new Map<string, { admin: boolean; at: number }>();

export async function isAdmin() {
  const session = await auth();
  if (!session.userId) return false;
  const known = answers.get(session.userId);
  if (known && Date.now() - known.at < REMEMBER_MS) return known.admin;
  const token = (await session.getToken({ template: "convex" })) ?? undefined;
  try {
    const admin = await fetchQuery(api.admins.queries.amI, {}, { token });
    answers.set(session.userId, { admin, at: Date.now() });
    return admin;
  } catch (error) {
    // Not remembered: the next click asks again.
    console.error("[publish mock] the admin check couldn't be made", String(error));
    return false;
  }
}

export async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("Only an admin can do this.");
}

const memberships = new Map<string, { orgIds: string[]; adminOf: string[]; at: number }>();
/**
 * The organisations a person belongs to, by Clerk ID: a report started in an organisation's workspace is its
 * members' to work on. Asked of Clerk and remembered for a minute, since every step of a report asks. MOCK: the real
 * build's functions take the workspace and check the person may act there, as the app's other sections do.
 */
async function membershipsOf(userId: string): Promise<{ orgIds: string[]; adminOf: string[] }> {
  const known = memberships.get(userId);
  if (known && Date.now() - known.at < REMEMBER_MS) return known;
  try {
    const list = await (await clerkClient()).users.getOrganizationMembershipList({ userId, limit: 100 });
    // A workspace's admins are its organisation's, as everywhere in the app (convex/workspaces/actor.ts).
    const answer = { orgIds: list.data.map((m) => m.organization.id), adminOf: list.data.filter((m) => m.role === "org:admin").map((m) => m.organization.id), at: Date.now() };
    memberships.set(userId, answer);
    return answer;
  } catch (error) {
    console.error("[publish mock] organisations couldn't be read", String(error).slice(0, 300));
    return { orgIds: [], adminOf: [] };
  }
}
export const organizationsOf = async (userId: string): Promise<string[]> => (await membershipsOf(userId)).orgIds;

/** Who is acting on a report: the person, the organisations whose workspaces they are a member of, and the ones they are an admin of. */
export type Actor = { userId: string; orgIds: string[]; adminOf: string[] };
export const actorFor = async (userId: string): Promise<Actor> => ({ userId, ...(await membershipsOf(userId)) });
export async function actor(): Promise<Actor | null> {
  const { userId } = await auth();
  return userId ? actorFor(userId) : null;
}

/** The organisation a workspace's address names (/o/<slug>), or null when Clerk has none such. */
export async function organizationAt(slug: string): Promise<{ id: string; name: string } | null> {
  try {
    const { id, name } = await (await clerkClient()).organizations.getOrganization({ slug });
    return { id, name };
  } catch {
    return null;
  }
}

/** An organisation's place in addresses now, by its Clerk ID; undefined when it's gone. */
export async function slugOf(organizationId: string): Promise<string | undefined> {
  try {
    return (await (await clerkClient()).organizations.getOrganization({ organizationId })).slug ?? undefined;
  } catch {
    return undefined;
  }
}

type ClerkUser = { id: string; firstName: string | null; lastName: string | null; imageUrl: string; primaryEmailAddress: { emailAddress: string } | null };
type ClerkOrganization = { id: string; name: string; imageUrl: string; membersCount?: number };
const person = (user: ClerkUser): Account => {
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  return { kind: "person", id: user.id, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || email, detail: email, imageUrl: user.imageUrl || null };
};
const organization = (o: ClerkOrganization): Account => ({
  kind: "organization",
  id: o.id,
  name: o.name,
  detail: o.membersCount === undefined ? "Organisation" : `${o.membersCount} ${o.membersCount === 1 ? "member" : "members"}`,
  imageUrl: o.imageUrl || null,
});

/** How many of each a list shows at once: the ones last active first, narrowed by what's typed. */
const ACCOUNTS = 25;

/** Openscholar's accounts and organisations, as Clerk has them, for an admin to pick from. */
export async function accountsMatching(query: string): Promise<{ people: Account[]; organizations: Account[] }> {
  const clerk = await clerkClient();
  const q = query.trim();
  const [users, organizations] = await Promise.all([
    clerk.users.getUserList({ ...(q ? { query: q } : {}), limit: ACCOUNTS, orderBy: "-last_active_at" }),
    clerk.organizations.getOrganizationList({ ...(q ? { query: q } : {}), limit: ACCOUNTS, includeMembersCount: true }),
  ]);
  return { people: users.data.map(person), organizations: organizations.data.map(organization) };
}

/** One account by its Clerk ID, or null when Clerk has none such. */
export async function accountOf(kind: Account["kind"], id: string): Promise<Account | null> {
  const clerk = await clerkClient();
  try {
    return kind === "person" ? person(await clerk.users.getUser(id)) : organization(await clerk.organizations.getOrganization({ organizationId: id, includeMembersCount: true }));
  } catch {
    return null;
  }
}
