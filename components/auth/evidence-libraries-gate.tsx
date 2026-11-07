"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { PageWrapper } from "@/components/PageWrapper";
import { useItemHome } from "@/components/workspaces/item-home";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { bareWorkspacePath, pageItem } from "@/lib/workspaces/paths";
import { AuthStatePanel } from "./auth-state-panel";

/**
 * Opens a community's page once the person is signed in and the page is in the workspace it opens in.
 * What they may do there is their role on the community, which its own queries check. `fallback`
 * replaces the full-screen loader while sign-in finishes.
 */
export function EvidenceLibrariesGate({ fallback, children }: { fallback?: ReactNode; children: ReactNode }) {
  const { phase, retryUserSync } = useAuthReadiness();
  // A link to a library of another of the person's workspaces opens there (components/workspaces/item-home.tsx):
  // until where it opens is known, this workspace isn't the page's.
  const slug = useWorkspaceSlug();
  const item = pageItem(bareWorkspacePath(usePathname()), useSearchParams());
  const home = useItemHome(item);
  const moving = phase === "authenticated" && item !== null && (home === undefined || (home !== null && home.slug !== slug));
  if (phase === "authenticated" && !moving) return children;

  const variant = phase === "sync_error" ? "sync_error_retry" : phase === "anonymous" ? "sign_in_required" : "loading";
  if (variant === "loading" && fallback) return fallback;
  return <PageWrapper><AuthStatePanel layout="fullscreen" variant={variant} onRetry={retryUserSync} /></PageWrapper>;
}
