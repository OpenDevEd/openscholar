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
  const [, section, id] = path.split("/");
  if (section === "results" && id) return { kind: "search", id: decodeURIComponent(id) };
  if (section === "extraction" && id && id !== "new") return { kind: "extraction", id };
  if (section === "evidence-libraries" && id && id !== "new") return { kind: "library", id };
  if (section === "authors" && id) return { kind: "profile", id };
  const job = path === "/screening" ? params.get("job") : null;
  if (job && job !== "new") return { kind: "screening", id: job };
  const collection = path === "/library" ? params.get("col") : null;
  return collection ? { kind: "collection", id: collection } : null;
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
  const item = pageItem(path, params);
  const here = useWorkspace();
  const home = useProtectedQuery(api.workspaces.queries.homeOf, item && here ? { ...item, here } : "skip").data;
  if (home && home.slug !== slug) {
    const query = params.toString();
    redirect(workspaceHref(home.slug, path) + (query ? `?${query}` : ""));
  }
  return null;
}
