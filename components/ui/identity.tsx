"use client";

// A person or an organization looks the same wherever one is listed: their photo or logo,
// their name with You beside yours, and a role as its icon and its name.

import type { ComponentProps, ComponentType, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { Crown, Eye, Mail, MessageSquare, PenLine, ShieldCheck, UserRound } from "@/components/icons";
import { cn } from "@/lib/utils";
import { IdentityAvatar } from "./identity-avatar";
import { TooltipHint } from "./tooltip";

/** One tint per person, picked from their ID, so someone keeps their colour in every chat and list. */
const TINTS = ["#2dd4bf", "#a78bfa", "#fb923c", "#60a5fa", "#f472b6", "#34d399", "#facc15", "#818cf8"];
export const tintOf = (id: string) => TINTS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TINTS.length]!;

/** Each role's icon, the same in every list and every picker. */
export const ROLE_ICONS = {
  owner: Crown,
  admin: ShieldCheck,
  editor: ShieldCheck,
  creator: PenLine,
  member: UserRound,
  view: Eye,
  edit: PenLine,
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
/** An address offers its line breaks after "@" and each ".", so it wraps between its parts, not mid-word ("exam / ple.com"). */
const breakable = (name: string) => (name.includes("@") ? name.split(/(?<=[@.])/).flatMap((part, at) => (at ? [<wbr key={at} />, part] : [part])) : name);

export function PersonName({ name, you = false, wrap = false, className }: { name: string; you?: boolean; /** Where a second line costs nothing, a long name or an address runs onto it and is read whole. */ wrap?: boolean; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {/* A name cut short for room, an address most of all, is read whole under the pointer. */}
      <TooltipHint label={name} onlyWhenClipped><span className={cn("min-w-0", wrap ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate")}>{wrap ? breakable(name) : name}</span></TooltipHint>
      {you ? <YouTag /> : null}
    </span>
  );
}

/** A chip led by someone's photo and named for them, with You after yours: who made an item in an organization's list. */
export function PersonTag({ name, imageUrl, you = false, before }: { name: string; imageUrl?: string; you?: boolean; before?: string }) {
  return (
    <span className="inline-flex h-6 min-w-0 max-w-full shrink items-center gap-1.5 whitespace-nowrap rounded-full bg-muted ps-0.5 pe-2.5 text-xs text-muted-foreground">
      <IdentityAvatar name={name} imageUrl={imageUrl} className="size-5" />
      {before ? <span className="shrink-0">{before}</span> : null}
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
export function IdentityRow({ avatar, name, you = false, wrap = false, detail, className, children }: { avatar: ReactNode; name: string; you?: boolean; /** In a list whose rows may be two lines tall: the name and the line under it each run onto a second line before they are cut. */ wrap?: boolean; detail?: ReactNode; className?: string; children?: ReactNode }) {
  const line = cn("text-xs text-muted-foreground", wrap ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate");
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="flex shrink-0 self-start">{avatar}</span>
      <div className="min-w-0 flex-1">
        <PersonName name={name} you={you} wrap={wrap} className="text-sm font-medium" />
        {detail ? (typeof detail === "string" ? <TooltipHint label={detail} onlyWhenClipped><p className={line}>{detail}</p></TooltipHint> : <p className={line}>{detail}</p>) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A person's photo in a stack; someone who has the item open right now (`here`) gets a ring in
 * their colour that ripples outward. A chat's members and an item's presence show people this way.
 */
export function PresentAvatar({ member }: { member: { userId: string; name: string; here?: boolean; imageUrl?: string | null } }) {
  const reduceMotion = useReducedMotion();
  const tint = tintOf(member.userId);
  return (
    <span className="relative flex size-6 shrink-0">
      {member.here && !reduceMotion ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: `0 0 0 1.5px ${tint}` }}
          animate={{ scale: [1.15, 1.7], opacity: [0.6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <span className="relative flex rounded-full ring-2 ring-card" style={{ boxShadow: member.here ? `0 0 0 2px var(--card), 0 0 0 3.5px ${tint}` : undefined }}>
        <IdentityAvatar name={member.name} imageUrl={member.imageUrl} className="size-6" />
      </span>
    </span>
  );
}
