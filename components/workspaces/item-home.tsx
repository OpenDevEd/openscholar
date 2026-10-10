"use client";

import { redirect, usePathname, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useWorkspaceSlug, workspaceHref } from "@/lib/workspaces/href";
import { bareWorkspacePath } from "@/lib/workspaces/paths";
import { useWorkspace } from "@/lib/workspaces/url";

type Item = { kind: "search" | "screening" | "extraction" | "collection" | "library" | "profile"; id: string };

/** The item a page shows, by its address: a search's results, a screening, an extraction, a collection, an Evidence Library or an author profile. */
export function pageItem(path: string, params: URLSearchParams): Item | null {
  const [, section, id, page] = path.split("/");
  if (section === "results" && id) return { kind: "search", id: decodeURIComponent(id) };
  if (section === "extraction" && id && id !== "new") return { kind: "extraction", id };
  if (section === "evidence-libraries" && id && id !== "new") return { kind: "library", id };
  // An invitation to a profile is the invitee's own to answer, outside any workspace.
  if (section === "authors" && id && page !== "invitation") return { kind: "profile", id };
  const job = path === "/screening" ? params.get("job") : null;
  if (job && job !== "new") return { kind: "screening", id: job };
  const collection = path === "/library" ? params.get("col") : null;
  return collection ? { kind: "collection", id: collection } : null;
}

/** The workspace an item is in, when it's one of the person's: an organization's address, or none for their own. Undefined while it's read, null when it's none of theirs. */
export function useItemHome(item: Item | null) {
  const here = useWorkspace();
  return useProtectedQuery(api.workspaces.queries.homeOf, item && here ? { ...item, here } : "skip").data;
}

/**
 * Opens a link to an item in the workspace it's in (#651), when that's another of the person's
 * workspaces than the address names: a search shared in an organization opens there, whichever
 * workspace the link was opened from.
 */
export function ItemHome() {
  const slug = useWorkspaceSlug();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = bareWorkspacePath(pathname);
  const home = useItemHome(pageItem(path, params));
  if (home && home.slug !== slug) {
    const query = params.toString();
    redirect(workspaceHref(home.slug, path) + (query ? `?${query}` : ""));
  }
  return null;
}

/**
 * Leaves an organization's page once the person can't act in it any more: they were removed,
 * they left in another tab, or it was deleted. They get the same page in their own workspace,
 * in place of one that waits for data it won't be given.
 */
export function WorkspaceGone() {
  const slug = useWorkspaceSlug();
  const pathname = usePathname();
  const params = useSearchParams();
  // Null once the server says they aren't in it; undefined while it's still being read.
  const there = useProtectedQuery(api.workspaces.queries.bySlug, slug ? { slug } : "skip").data;
  if (slug && there === null) {
    const query = params.toString();
    redirect(bareWorkspacePath(pathname) + (query ? `?${query}` : ""));
  }
  return null;
}
