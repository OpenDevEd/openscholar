"use client";

// A person or an organization looks the same wherever one is listed: their photo or logo,
// their name with You beside yours, and a role as its icon and its name.

import type { ComponentType, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Crown, Eye, Mail, MessageSquare, PenLine, ShieldCheck } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Each role's icon, the same in every list and every picker. */
export const ROLE_ICONS = {
  owner: Crown,
  editor: ShieldCheck,
  creator: PenLine,
  view: Eye,
  chat: MessageSquare,
} satisfies Record<string, ComponentType<{ className?: string }>>;
export type RoleKind = keyof typeof ROLE_ICONS;

/** A role that can't be changed here: its icon, then its name. */
export function RoleLabel({ role, className, children }: { role: RoleKind; className?: string; children: ReactNode }) {
  const Icon = ROLE_ICONS[role];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground", className)}>
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
