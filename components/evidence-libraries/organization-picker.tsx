"use client";

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
