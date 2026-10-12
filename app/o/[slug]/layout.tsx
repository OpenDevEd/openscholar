import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { ADDRESS_HEADER, outsiderTarget } from "@/lib/workspaces/paths";

/**
 * An organization's pages (#651): each one under /o/<slug> is the page of the same path outside
 * it, in the organization's workspace. Someone who isn't its member is sent to that page in their
 * own workspace, where what the organization shared with them is (#653): a link to one of its chats
 * opens there for a guest, as it opens here for its members.
 */
export default async function OrganizationLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  if (!token) notFound();
  if (!(await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }))) {
    const address = new URL((await headers()).get(ADDRESS_HEADER) ?? "/", "http://address");
    redirect(outsiderTarget(address.pathname, address.search));
  }
  return children;
}
