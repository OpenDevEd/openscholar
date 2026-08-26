"use client";

import { cn } from "@/lib/utils";

/**
 * Status chip recipe used across the app: `/10` tinted background, `600`/`700`
 * text, raw palette for success and warning, the destructive token for errors.
 * See `app/settings/billing/page.tsx` and `components/extraction/job-list-item.tsx`.
 */
export const STATUS_TONE = {
  neutral: "bg-muted text-muted-foreground border-border/50",
  running: "bg-primary/10 text-primary border-primary/20",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
} as const;

export type StatusTone = keyof typeof STATUS_TONE;

/** Small dot used next to rail items. */
export const STATUS_DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  running: "bg-primary animate-pulse",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-destructive",
};

export function StatusChip({
  tone,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone: StatusTone }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium [&>svg]:size-3",
        STATUS_TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
