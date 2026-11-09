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

/**
 * The organisations a person belongs to, by Clerk ID. Asked of Clerk, not read from the session: the session names
 * only the workspace that's open, and Publish opens outside any, so an organisation's limit would never apply.
 */
export async function organizationsOf(userId: string): Promise<string[]> {
  try {
    const memberships = await (await clerkClient()).users.getOrganizationMembershipList({ userId, limit: 100 });
    return memberships.data.map((membership) => membership.organization.id);
  } catch (error) {
    console.error("[publish mock] organisations couldn't be read", String(error).slice(0, 300));
    return [];
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
