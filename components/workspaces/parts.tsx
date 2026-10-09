"use client";

// How a workspace shows (#651): its tile, its colour and its plan, read the same way in the rail,
// the switcher and the join page.

import type { FunctionReturnType } from "convex/server";
import { Home } from "@/components/icons";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
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

/** The most workspaces the switcher lists. ponytail: one page; page on if people join more than 20 organizations. */
const LISTED = 20;

/** The workspaces the person can switch to, their own first, and the one the page is in; undefined while they load. */
export function useWorkspaces() {
  const here = useWorkspace();
  const { data } = useProtectedQuery(api.organizations.queries.workspaces, inWorkspace(here, { paginationOpts: { cursor: null, numItems: LISTED } }));
  const all = data?.page;
  return { all, current: all?.find((workspace) => workspace.workspaceId === here) };
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
  // Clerk gives every organization a logo: its own, or one it makes.
  return <IdentityAvatar name={workspace.name} imageUrl={workspace.imageUrl} kind="organization" className={cn(TILE_BOX[size], TILE_CORNER[size])} />;
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
