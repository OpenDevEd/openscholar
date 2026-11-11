"use client";

import { redirect, usePathname, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useWorkspaceSlug, workspaceHref } from "@/lib/workspaces/href";
import { bareWorkspacePath, outsiderTarget, pageItem } from "@/lib/workspaces/paths";
import { useWorkspace } from "@/lib/workspaces/url";

type Item = NonNullable<ReturnType<typeof pageItem>>;

/** The workspace an item is in, when it's one of the person's: an organization's address, or none for their own. Undefined while it's read, null when it's none of theirs. */
export function useItemHome(item: Item | null) {
  const here = useWorkspace();
  return useProtectedQuery(api.workspaces.queries.homeOf, item && here ? { ...item, here } : "skip").data;
}

/**
 * Opens a link to an item in the workspace it's in (#651), when that's another of the person's
 * workspaces than the address names: a search shared in an organization opens there, whichever
 * workspace the link was opened from. A search's link carries its document's ID (#653): a
 * guest's page goes by that, in their own workspace, and a member's by the ID it has in its.
 */
export function ItemHome() {
  const slug = useWorkspaceSlug();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = bareWorkspacePath(pathname);
  const item = pageItem(path, params);
  const home = useItemHome(item);
  if (home && item && (home.slug !== slug || home.id !== undefined)) {
    const query = params.toString();
    // Only a search goes by another ID, and its address is its results page.
    redirect(workspaceHref(home.slug, home.id === undefined ? path : `/results/${encodeURIComponent(home.id)}`) + (query ? `?${query}` : ""));
  }
  return null;
}

/**
 * Leaves an organization's page once the person can't act in it any more: they were removed,
 * they left in another tab, or it was deleted. They go to the same page in their own workspace, item and all,
 * as the organization's layout sends someone who was never its member (app/o/[slug]/layout.tsx): the page there
 * says the item isn't theirs, where the section's start would say nothing of what happened to it.
 */
export function WorkspaceGone() {
  const slug = useWorkspaceSlug();
  const pathname = usePathname();
  const params = useSearchParams();
  // False once the server says they aren't in it; undefined while it's still being read. One being deleted is still theirs: the deletion may fail.
  const member = useProtectedQuery(api.workspaces.queries.memberAt, slug ? { slug } : "skip").data;
  if (slug && member === false) redirect(outsiderTarget(pathname, params.size ? `?${params.toString()}` : ""));
  return null;
}
