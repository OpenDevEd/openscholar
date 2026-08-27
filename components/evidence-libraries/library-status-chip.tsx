"use client";

import { useTranslations } from "next-intl";
import { StatusChip, type StatusTone } from "./configuration/status-chip";

export type LibraryStatus =
  | "draft"
  | "setting_up"
  | "setup_failed"
  | "active"
  | "deleting";

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
