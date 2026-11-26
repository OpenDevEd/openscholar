"use client";

// Small pieces the screening page's views share.
import { useEffect, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { Asterisk, Star, type AppIcon } from "@/components/icons";
import { RECORD_KINDS } from "@/components/record-kinds";
import { cn } from "@/lib/utils";
import type { PaperSet } from "@/lib/screening/setup";
import { ZoteroIcon } from "@/components/icons/zotero-icon";

/** Where a screening's papers came from, each with its kind's icon (components/record-kinds.ts). */
export const SOURCE_ICON: Record<PaperSet["kind"], AppIcon> = { search: RECORD_KINDS.search.icon, collection: RECORD_KINDS.collection.icon, saved: RECORD_KINDS.savedPapers.icon, screening: RECORD_KINDS.screening.icon, zotero: ZoteroIcon, evidenceLibrary: RECORD_KINDS.library.icon };

/** After a required question's text: a paper not answered yes there is never included. */
export function RequiredMark() {
  const t = useTranslations("screeningPage");
  return <Asterisk role="img" aria-label={t("required")} strokeWidth={2.5} className="ms-1 inline size-3.5 align-[-0.125em] text-primary" />;
}

/** A small fact chip: an icon, then a short label. */
export function Chip({ icon: Icon, children, className }: { icon?: AppIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground/[0.06] px-2 text-xs tabular-nums text-muted-foreground", className)}>
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}

export function Stars({ count, of = 5 }: { count: number; of?: number }) {
  const t = useTranslations("screeningPage");
  return (
    <span role="img" aria-label={t("starsOf", { count, of })} className="inline-flex shrink-0 items-center gap-0.5">
      {Array.from({ length: of }, (_, i) => (
        <Star key={i} aria-hidden className={cn("size-3", i < count ? "fill-rating text-rating" : "text-muted-foreground/30")} />
      ))}
    </span>
  );
}

/** A thin meter, filled to `value` of `max`. */
export function Meter({ value, max, className, fill = "bg-primary" }: { value: number; max: number; className?: string; fill?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", fill)} style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} />
    </div>
  );
}

/**
 * A number that rolls to each new value, the way iOS counts a balance up, as the
 * assistant's numbers do. It jumps straight there when motion is reduced.
 */
export function AnimatedNumber({ value }: { value: number }) {
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const spring = useSpring(value, { stiffness: 120, damping: 22 });
  const text = useTransform(spring, (n) => Math.round(n).toLocaleString(locale));
  // The spring is an animation system outside React: point it at each new value.
  useEffect(() => {
    if (reduceMotion) spring.jump(value);
    else spring.set(value);
  }, [spring, value, reduceMotion]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}
