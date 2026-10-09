"use client";

// A person or an organization looks the same wherever one is listed: their photo or logo,
// their name with You beside yours, and a role as its icon and its name.

import type { ComponentProps, ComponentType, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Crown, Eye, Mail, MessageSquare, PenLine, ShieldCheck, UserRound } from "@/components/icons";
import { cn } from "@/lib/utils";
import { IdentityAvatar } from "./identity-avatar";

/** Each role's icon, the same in every list and every picker. */
export const ROLE_ICONS = {
  owner: Crown,
  admin: ShieldCheck,
  editor: ShieldCheck,
  creator: PenLine,
  member: UserRound,
  view: Eye,
  chat: MessageSquare,
} satisfies Record<string, ComponentType<{ className?: string }>>;
export type RoleKind = keyof typeof ROLE_ICONS;

/** A role that can't be changed here: its icon, then its name. A tooltip's trigger gives it its handlers and ref. */
export function RoleLabel({ role, className, children, ...props }: ComponentProps<"span"> & { role: RoleKind }) {
  const Icon = ROLE_ICONS[role];
  return (
    <span {...props} className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** Marks you, after your name. */
export function YouTag({ className }: { className?: string }) {
  const t = useTranslations("common");
  return <span className={cn("shrink-0 rounded-full bg-foreground/[0.07] px-2 text-2xs font-normal leading-5 text-muted-foreground", className)}>{t("you")}</span>;
}

/** A name, cut where it runs out of room, with You after yours. */
export function PersonName({ name, you = false, className }: { name: string; you?: boolean; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="min-w-0 truncate">{name}</span>
      {you ? <YouTag /> : null}
    </span>
  );
}

/** A chip led by someone's photo and named for them, with You after yours: who made an item in an organization's list. */
export function PersonTag({ name, imageUrl, you = false }: { name: string; imageUrl?: string; you?: boolean }) {
  return (
    <span className="inline-flex h-6 min-w-0 max-w-full shrink items-center gap-1.5 whitespace-nowrap rounded-full bg-muted pl-0.5 pr-2.5 text-xs text-muted-foreground">
      <IdentityAvatar name={name} imageUrl={imageUrl} className="size-5" />
      <PersonName name={name} you={you} />
    </span>
  );
}

/** Someone invited by email, who has no account to show a photo from yet. Sized as a list row's photo. */
export function EmailAvatar() {
  return (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Mail className="size-4" />
    </span>
  );
}

/** A person or an organization in a list: their photo or logo, their name over a detail line, then what ends the row. */
export function IdentityRow({ avatar, name, you = false, detail, className, children }: { avatar: ReactNode; name: string; you?: boolean; detail?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {avatar}
      <div className="min-w-0 flex-1">
        <PersonName name={name} you={you} className="text-sm font-medium" />
        {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      {children}
    </div>
  );
}
