"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { PageWrapper } from "@/components/PageWrapper";
import { useItemHome } from "@/components/workspaces/item-home";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { bareWorkspacePath, pageItem } from "@/lib/workspaces/paths";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import { AuthStatePanel } from "./auth-state-panel";

/**
 * Opens a page of Evidence Libraries when the workspace it's in has them, or a library was
 * shared with the person there. With `authors`, a page that manages author profiles, which
 * takes the workspace's plan itself. `fallback` replaces the full-screen loader while that's
 * checked. A page passes itself in a state that runs no queries, so its frame shows at once and
 * stays mounted when access is confirmed.
 */
export function EvidenceLibrariesGate({ authors = false, fallback, children }: { authors?: boolean; fallback?: ReactNode; children: ReactNode }) {
  const { data, phase } = useWorkspaceFeatures();
  const { retryUserSync } = useAuthReadiness();
  const t = useTranslations("auth");
  // A link to a library of another of the person's workspaces opens there (components/workspaces/item-home.tsx):
  // until where it opens is known, this workspace's answer isn't the page's, and saying no would flash before the move.
  const slug = useWorkspaceSlug();
  const item = pageItem(bareWorkspacePath(usePathname()), useSearchParams());
  const home = useItemHome(item);
  const moving = phase === "authenticated" && item !== null && (home === undefined || (home !== null && home.slug !== slug));
  if (phase === "authenticated" && data?.[authors ? "authors" : "evidenceLibraries"] && !moving) return children;

  const variant = phase === "sync_error" ? "sync_error_retry"
    : phase === "anonymous" ? "sign_in_required"
    : data === undefined || moving ? "loading" : "no_access";
  if (variant === "loading" && fallback) return fallback;
  return <PageWrapper><AuthStatePanel
    layout="fullscreen"
    variant={variant}
    onRetry={retryUserSync}
    {...(variant === "no_access" ? {
      title: t("organizationFeatureTitle"),
      description: t("organizationFeatureDescription"),
      primaryHref: "/", primaryLabel: t("backToSearch"),
    } : {})}
  /></PageWrapper>;
}
