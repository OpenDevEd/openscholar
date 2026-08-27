"use client";

import { useTranslations } from "next-intl";
import type { LibraryOverviewStatus } from "@/convex/evidenceLibraries/queries";
import { StatusChip, type StatusTone } from "./configuration/status-chip";

export type LibraryStatus = LibraryOverviewStatus;

export const LIBRARY_TONE: Record<LibraryStatus, StatusTone> = {
  draft: "neutral",
  setting_up: "running",
  active: "success",
  setup_failed: "danger",
  deleting: "danger",
};

export function LibraryStatusChip({ status }: { status: LibraryStatus }) {
  const t = useTranslations("evidenceLibraries.status");
  return (
    <StatusChip tone={LIBRARY_TONE[status]} data-status={status}>
      {t(status)}
    </StatusChip>
  );
}
