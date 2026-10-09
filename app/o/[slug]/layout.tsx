import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { notFound } from "next/navigation";
import { api } from "@/convex/_generated/api";

/**
 * An organization's pages (#651): each one under /o/<slug> is the page of the same path outside
 * it, in the organization's workspace. Someone who isn't its member finds no page here.
 */
export default async function OrganizationLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  if (!token || !(await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }))) notFound();
  return children;
}
