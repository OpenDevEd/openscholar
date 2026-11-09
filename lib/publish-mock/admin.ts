// MOCK (mock/publish-reports): who is an Openscholar admin, asked of Convex as the admin pages ask it
// (convex/admins/queries.ts). The real build's reviewing and settings are Convex functions that check this themselves.
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function isAdmin() {
  const session = await auth();
  if (!session.userId) return false;
  const token = (await session.getToken({ template: "convex" })) ?? undefined;
  return fetchQuery(api.admins.queries.amI, {}, { token }).catch((error: unknown) => {
    console.error("[publish mock] the admin check couldn't be made", String(error));
    return false;
  });
}

export async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("Only an admin can do this.");
}
