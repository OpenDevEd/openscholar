"use client";

import { AlertTriangle, Check, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  doneStepCount,
  type LibraryStatus,
  type MockLibrary,
} from "@/lib/evidence-libraries/mock/data";

/**
 * Status chip recipe used across the app: `/10` tinted background, `600`/`700`
 * text, raw palette for success and warning, the destructive token for errors.
 * See `app/settings/billing/page.tsx:419` and `components/extraction/job-list-item.tsx:22`.
 */
export const STATUS_TONE = {
  neutral: "bg-muted text-muted-foreground border-border/50",
  running: "bg-primary/10 text-primary border-primary/20",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
} as const;

export type StatusTone = keyof typeof STATUS_TONE;

/** Small dot used next to list titles (`components/extraction/job-list-item.tsx:22-32`). */
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

const LIBRARY_TONE: Record<LibraryStatus, StatusTone> = {
  draft: "neutral",
  setting_up: "running",
  active: "success",
  setup_failed: "danger",
  deleting: "danger",
};

function StatusIcon({ status }: { status: LibraryStatus }) {
  if (status === "setting_up" || status === "deleting") return <Spinner />;
  if (status === "active") return <Check />;
  if (status === "setup_failed") return <AlertTriangle />;
  return <GitBranch />;
}

export function LibraryStatusBadge({ library }: { library: MockLibrary }) {
  const t = useTranslations("evidenceLibraryMock");
  return (
    <StatusChip tone={LIBRARY_TONE[library.status]} data-status={library.status}>
      <StatusIcon status={library.status} />
      {t(`status.${library.status}`)}
      {library.status === "setting_up" ? (
        <span className="font-mono font-normal normal-case tracking-normal opacity-80">
          {t("stepsOfFive", { done: doneStepCount(library) })}
        </span>
      ) : null}
    </StatusChip>
  );
}
