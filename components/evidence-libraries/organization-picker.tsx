"use client";

import { api } from "@/convex/_generated/api";
import type { Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { IdentityAvatar } from "@/components/ui/identity-avatar";

export function OrganizationAvatar({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl?: string | null;
}) {
  return (
    <IdentityAvatar name={name} imageUrl={imageUrl} kind="organization" className="size-5 rounded-md" />
  );
}

/** The organizations the person can make libraries in. `preloaded` is the server's answer, used until the live query takes over, so the page knows at once. */
export function useLibraryOrganizationChoice(
  preloaded?: Preloaded<typeof api.organizationFeatures.listLibraryOrganizations>,
) {
  const query = useProtectedQuery(
    api.organizationFeatures.listLibraryOrganizations,
    {},
  );
  const organizations = (query.data ?? (preloaded ? preloadedQueryResult(preloaded) : undefined))?.page ?? [];
  return { organizations, isReady: query.isReady || Boolean(preloaded) };
}
