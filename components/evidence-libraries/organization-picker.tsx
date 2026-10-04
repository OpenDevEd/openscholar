"use client";

import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

/** `preloaded` is the server's answer, used until the live query takes over, so the page knows at once. */
export function useLibraryOrganizationChoice(
  preloaded?: Preloaded<typeof api.organizationFeatures.listLibraryOrganizations>,
) {
  const query = useProtectedQuery(
    api.organizationFeatures.listLibraryOrganizations,
    {},
  );
  const [chosenId, choose] = useState<string | null>(null);
  const organizations = (query.data ?? (preloaded ? preloadedQueryResult(preloaded) : undefined))?.page ?? [];
  const selected =
    organizations.find((org) => org.id === chosenId) ?? organizations[0];
  return { organizations, selected, choose, isReady: query.isReady || Boolean(preloaded) };
}

export function LibraryOrganizationPicker({
  id,
  organizations,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  organizations: FunctionReturnType<
    typeof api.organizationFeatures.listLibraryOrganizations
  >["page"];
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label="Organization" className="w-full">
        <SelectValue placeholder="Choose an organization" />
      </SelectTrigger>
      <SelectContent>
        {organizations.map((org) => (
          <SelectItem key={org.id} value={org.id}>
            <OrganizationAvatar name={org.name} imageUrl={org.imageUrl} />
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
