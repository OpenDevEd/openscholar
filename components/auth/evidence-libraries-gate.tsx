"use client";

import type { ReactNode } from "react";
import { redirect, usePathname, useSearchParams } from "next/navigation";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { PageWrapper } from "@/components/PageWrapper";
import { useItemHome } from "@/components/workspaces/item-home";
import { useWorkspaceSlug, workspaceHref } from "@/lib/workspaces/href";
import { bareWorkspacePath, pageItem } from "@/lib/workspaces/paths";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import { AuthStatePanel } from "./auth-state-panel";

/**
 * Opens a page of Evidence Libraries when the workspace it's in has them, or a library was
 * shared with the person there; anyone else goes to the plans for organizations, where they're
 * asked for. `fallback` replaces the full-screen loader while that's checked. A page passes
 * itself in a state that runs no queries, so its frame shows at once and stays mounted when
 * access is confirmed.
 */
export function EvidenceLibrariesGate({ fallback, children }: { fallback?: ReactNode; children: ReactNode }) {
  const { data, phase } = useWorkspaceFeatures();
  const { retryUserSync } = useAuthReadiness();
  // A link to a library of another of the person's workspaces opens there (components/workspaces/item-home.tsx):
  // until where it opens is known, this workspace's answer isn't the page's, and going to the plans would come before the move.
  const slug = useWorkspaceSlug();
  const item = pageItem(bareWorkspacePath(usePathname()), useSearchParams());
  const home = useItemHome(item);
  const moving = phase === "authenticated" && item !== null && (home === undefined || (home !== null && home.slug !== slug));
  if (phase === "authenticated" && data?.evidenceLibraries && !moving) return children;
  if (phase === "authenticated" && data !== undefined && !moving) redirect(workspaceHref(slug, "/pricing?audience=org"));

  const variant = phase === "sync_error" ? "sync_error_retry" : phase === "anonymous" ? "sign_in_required" : "loading";
  if (variant === "loading" && fallback) return fallback;
  return <PageWrapper><AuthStatePanel layout="fullscreen" variant={variant} onRetry={retryUserSync} /></PageWrapper>;
}
