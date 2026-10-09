"use client";

import { Building2, UserRound } from "@/components/icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * A person's photo, round, or an organization's logo, square with rounded corners. Its icon
 * shows only while the picture loads or when there is none: never an initial.
 */
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
    <Avatar className={cn(kind === "organization" && "rounded-lg", className)} aria-hidden="true">
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
