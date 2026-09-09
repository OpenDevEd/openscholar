"use client";

import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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
    <Avatar className="size-5 rounded-md" aria-hidden="true">
      {imageUrl && <AvatarImage src={imageUrl} alt="" />}
      <AvatarFallback className="rounded-md text-[9px] font-semibold">
        {name.slice(0, 2)}
      </AvatarFallback>
    </Avatar>
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
