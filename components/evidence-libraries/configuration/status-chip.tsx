"use client";

import type { HTMLAttributes } from "react";
import { CircleCheck, CircleDashed, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Status chip recipe used across the app: `/10` tinted background, `600`/`700`
 * text, raw palette for success and warning, the destructive token for errors.
 * See `app/settings/billing/page.tsx` and `components/extraction/job-list-item.tsx`.
 */
const STATUS_TONE = {
  neutral: "bg-muted text-muted-foreground border-border/50",
  running: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 ink-success border-success/20",
  warning: "bg-warning/10 ink-warning border-warning/20",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
} as const;

export type StatusTone = keyof typeof STATUS_TONE;

const STATUS_ICON: Record<StatusTone, { icon: LucideIcon; className: string }> = {
  neutral: { icon: CircleDashed, className: "text-muted-foreground" },
  running: { icon: LoaderCircle, className: "animate-spin text-primary motion-reduce:animate-none" },
  success: { icon: CircleCheck, className: "ink-success" },
  warning: { icon: TriangleAlert, className: "ink-warning" },
  danger: { icon: CircleX, className: "text-destructive" },
};

/**
 * A state as a coloured icon, never a dot: a check when done, a spinner while
 * running, a cross when it failed. The label is its accessible name and tooltip.
 * Pass `icon` for a state with its own sign, such as paused.
 */
export function StatusIcon({ tone, label, icon, className, ...rest }: HTMLAttributes<HTMLSpanElement> & {
  tone: StatusTone;
  label: string;
  icon?: LucideIcon;
}) {
  const { icon: toneIcon, className: toneClass } = STATUS_ICON[tone];
  const Icon = icon ?? toneIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} className={cn("inline-flex shrink-0", className)} {...rest}>
          <Icon aria-hidden className={cn("size-4", toneClass)} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function StatusChip({
  tone,
  icon,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone: StatusTone;
  /** A sign before the words: the tone's own (a check, a spinner, a cross), or a state's own icon. */
  icon?: LucideIcon | "tone";
}) {
  const Icon = icon === "tone" ? STATUS_ICON[tone].icon : icon;
  const spins = icon === "tone" && tone === "running";
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium [&>svg]:size-3",
        STATUS_TONE[tone],
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon aria-hidden className={spins ? "animate-spin motion-reduce:animate-none" : undefined} /> : null}
      {children}
    </span>
  );
}
