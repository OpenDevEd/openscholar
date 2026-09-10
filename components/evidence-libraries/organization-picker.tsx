"use client";

import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
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

export function useLibraryOrganizationChoice() {
  const query = useProtectedQuery(
    api.organizationFeatures.libraryOrganizations,
    {},
  );
  const [chosenId, choose] = useState<string | null>(null);
  const organizations = query.data ?? [];
  const selected =
    organizations.find((org) => org.id === chosenId) ?? organizations[0];
  return { organizations, selected, choose, isReady: query.isReady };
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
    typeof api.organizationFeatures.libraryOrganizations
  >;
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
