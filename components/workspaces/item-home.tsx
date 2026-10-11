"use client";

import { redirect, usePathname, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useWorkspaceSlug, workspaceHref } from "@/lib/workspaces/href";
import { bareWorkspacePath, pageItem, switchTarget } from "@/lib/workspaces/paths";
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
 * workspace the link was opened from. A search shared with the person from outside (#653) opens
 * in their own workspace under its document's ID, which is what a member's link to it becomes.
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
    redirect(workspaceHref(home.slug, home.id === undefined ? path : path.replace(item.id, home.id)) + (query ? `?${query}` : ""));
  }
  return null;
}

/**
 * Leaves an organization's page once the person can't act in it any more: they were removed,
 * they left in another tab, or it was deleted. They go to their own workspace as a switch to it
 * would take them, in place of a page that waits for data it won't be given.
 */
export function WorkspaceGone() {
  const slug = useWorkspaceSlug();
  const pathname = usePathname();
  const params = useSearchParams();
  // False once the server says they aren't in it; undefined while it's still being read. One being deleted is still theirs: the deletion may fail.
  const member = useProtectedQuery(api.workspaces.queries.memberAt, slug ? { slug } : "skip").data;
  if (slug && member === false) redirect(switchTarget(undefined, pathname, params.toString()));
  return null;
}
