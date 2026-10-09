"use client";

// How a workspace shows (#651): its tile, its colour and its plan, read the same way in the rail,
// the switcher and the join page.

import type { FunctionReturnType } from "convex/server";
import { Home } from "@/components/icons";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { api } from "@/convex/_generated/api";
import { useProtectedPaginatedQuery, useProtectedQuery } from "@/lib/auth/use-auth-query";
import { defaultPlanId, findPlan } from "@/lib/billing/catalog";
import { useBillingCatalog } from "@/lib/billing/catalog-provider";
import { ORGANIZATION_PLAN } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { ORGANIZATION_COLOURS } from "@/lib/workspaces/colours";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

export type WorkspaceRow = FunctionReturnType<typeof api.organizations.queries.workspaces>["page"][number];
/** Enough of a workspace to draw it, which an invitation has before it's one of yours. */
export type WorkspaceLook = Pick<WorkspaceRow, "kind" | "name" | "imageUrl"> & { workspaceId?: string; plan?: string; colour?: string };

/** Clerk's limit on a free organization's members, invitations included. */
export const FREE_MEMBERS = 5;

/** Workspaces a list of them reads at a time; the one you're in is read apart. */
const LISTED = 20;

/**
 * The workspaces the person can switch to, their own first, a page at a time: `list` is
 * undefined while the first page loads, and `more` says there are more for `loadMore` to read.
 */
export function useWorkspaces() {
  const read = useProtectedPaginatedQuery(api.organizations.queries.workspaces, inWorkspace(useWorkspace(), {}), { initialNumItems: LISTED });
  return {
    list: read.status === "LoadingFirstPage" ? undefined : read.results,
    more: read.status === "CanLoadMore" || read.status === "LoadingMore",
    loading: read.status === "LoadingMore",
    loadMore: () => read.loadMore(LISTED),
  };
}

/** The workspace the page is in, read on its own: it may not be on the switcher's first page. Undefined while it loads. */
export function useCurrentWorkspace() {
  return useProtectedQuery(api.organizations.queries.workspace, inWorkspace(useWorkspace(), {})).data;
}

/** Your own workspace's colour, the brand's; an organization takes another until its admins pick one. */
const OWN_TINT = "#2563eb";
const TINTS = ORGANIZATION_COLOURS.filter((colour) => colour !== OWN_TINT);

/** A workspace's colour, which tints the rail while you're in it. */
export function workspaceTint(workspace: WorkspaceLook) {
  if (workspace.kind === "personal") return OWN_TINT;
  if (workspace.colour) return workspace.colour;
  const seed = workspace.workspaceId ?? workspace.name;
  return TINTS[[...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TINTS.length]!;
}

/** `row` matches a person's photo in a list row. */
const TILE_BOX = { xs: "size-5", sm: "size-6", md: "size-8", row: "size-9", lg: "size-10", xl: "size-24" } as const;
const TILE_CORNER = { xs: "rounded-md", sm: "rounded-md", md: "rounded-lg", row: "rounded-lg", lg: "rounded-xl", xl: "rounded-3xl" } as const;

/**
 * A workspace's picture: your photo for your own, an organization's logo for one. `home` is the
 * switcher's mark for your own, where your account's photo sits just below it.
 */
export function WorkspaceTile({ workspace, size = "md", home = false }: { workspace: WorkspaceLook; size?: keyof typeof TILE_BOX; home?: boolean }) {
  const tint = workspaceTint(workspace);
  if (workspace.kind === "personal" && home) {
    return (
      <span aria-hidden className={cn("flex shrink-0 items-center justify-center", TILE_BOX[size], TILE_CORNER[size])} style={{ backgroundColor: `color-mix(in oklab, ${tint} 22%, var(--background))`, color: tint }}>
        <Home className="size-[55%]" />
      </span>
    );
  }
  if (workspace.kind === "personal") return <IdentityAvatar name={workspace.name} imageUrl={workspace.imageUrl} className={TILE_BOX[size]} />;
  if (workspace.imageUrl) return <IdentityAvatar name={workspace.name} imageUrl={workspace.imageUrl} kind="organization" className={cn(TILE_BOX[size], TILE_CORNER[size])} />;
  // One whose admins uploaded no logo has one made for it, in its colour.
  return <GeneratedLogo seed={workspace.workspaceId ?? workspace.name} tint={tint} className={cn("shrink-0", TILE_BOX[size], TILE_CORNER[size])} />;
}

/** A seeded number from 0 to 1, the same for the same seed and step. */
const seeded = (seed: string, step: number) => {
  let hash = 2166136261 + step * 16777619;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 1000) / 1000;
};

/** An organization's made logo: its colour, with three shapes placed by its seed. */
function GeneratedLogo({ seed, tint, className }: { seed: string; tint: string; className?: string }) {
  const at = (step: number, from: number, span: number) => from + seeded(seed, step) * span;
  return (
    <svg aria-hidden viewBox="0 0 40 40" className={cn("overflow-hidden", className)}>
      <rect width="40" height="40" fill={tint} />
      <circle cx={at(1, 8, 24)} cy={at(2, 8, 24)} r={at(3, 9, 7)} fill="white" fillOpacity="0.55" />
      <rect x={at(4, 6, 18)} y={at(5, 14, 16)} width="16" height="16" rx="4" fill="black" fillOpacity="0.28" transform={`rotate(${at(6, 0, 90)} 20 20)`} />
      <circle cx={at(7, 10, 20)} cy={at(8, 10, 20)} r={at(9, 3, 3)} fill="white" fillOpacity="0.85" />
    </svg>
  );
}

/** A chip led by a workspace's tile and named for it; a long name is cut. */
export function WorkspaceTag({ workspace, size = "md", strong = false }: { workspace: WorkspaceLook; size?: "sm" | "md"; strong?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-muted pr-2.5 text-xs", size === "sm" ? "h-6 pl-0.5" : "h-7 pl-1", strong && "font-medium text-foreground")}>
      <WorkspaceTile workspace={workspace} size="xs" />
      <span className="min-w-0 truncate">{workspace.name}</span>
    </span>
  );
}

/** A workspace's tile with the hairline the switcher gives it. */
export function Framed({ children }: { children: React.ReactNode }) {
  return <span className="flex shrink-0 rounded-lg shadow-[0_1px_2px_rgb(0_0_0/0.08),inset_0_0_0_1px_rgb(0_0_0/0.06)]">{children}</span>;
}

/** A workspace's plan: its name, and whether it's one that's paid for. Empty while the catalog loads. */
export function usePlanOf(workspace: WorkspaceLook) {
  const catalog = useBillingCatalog();
  // One whose account isn't read yet is on the plan every workspace of its kind starts on.
  const id = workspace.plan ?? (workspace.kind === "organization" ? ORGANIZATION_PLAN : catalog ? defaultPlanId(catalog) : undefined);
  const plan = catalog && id ? findPlan(catalog, id) : undefined;
  return { name: plan?.name ?? "", paid: !!plan && id !== ORGANIZATION_PLAN && id !== (catalog ? defaultPlanId(catalog) : undefined) };
}

/** A workspace's plan, as a pill: tinted while it's a paid one. */
export function PlanChip({ workspace, className }: { workspace: WorkspaceLook; className?: string }) {
  const { name, paid } = usePlanOf(workspace);
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-medium", paid ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground", className)}>{name}</span>;
}

/** Where a workspace's settings or its plan and credits are: an organization's under its address, your own's with your account. */
export const settingsHref = (workspace: Pick<WorkspaceRow, "kind" | "slug"> | undefined, page: "" | "/billing" = "") =>
  workspace?.kind === "organization" && workspace.slug ? `/o/${workspace.slug}/settings${page || "/workspace"}` : `/settings${page}`;
