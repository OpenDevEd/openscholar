"use client";

import { Building2, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function IdentityAvatar({
  name,
  imageUrl,
  kind = "person",
  className,
}: {
  name: string;
  imageUrl?: string | null;
  kind?: "person" | "organization";
  className?: string;
}) {
  const Icon = kind === "organization" ? Building2 : UserRound;
  return (
    <Avatar className={className} aria-hidden="true">
      {imageUrl ? (
        <AvatarImage
          src={imageUrl}
          alt={name}
          className={kind === "organization" ? "object-contain" : "object-cover"}
        />
      ) : null}
      <AvatarFallback className="rounded-[inherit]" delayMs={imageUrl ? 150 : 0}>
        <Icon className="size-1/2" />
      </AvatarFallback>
    </Avatar>
  );
}
