"use client";

import { Clock, CloudUpload, PencilLine, RefreshCw, Trash2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
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

/** Active, setting up and setup failed take their tone's sign: the check extraction uses when done, a spinner, a cross. */
const LIBRARY_ICON: Record<LibraryStatus, LucideIcon | "tone"> = {
  draft: PencilLine,
  setting_up: "tone",
  active: "tone",
  setup_failed: "tone",
  deleting: Trash2,
};

/** The build a live library is running: a software update, or published changes. */
export type LibraryOperation = NonNullable<
  FunctionReturnType<typeof api.evidenceLibraries.queries.listLibraryOverviews>[number]["operation"]
>;

/**
 * A library's one status word. A live library that is updating or publishing
 * says that instead of Active.
 */
export function LibraryStatusChip({ status, operation }: { status: LibraryStatus; operation?: LibraryOperation | null }) {
  const t = useTranslations("evidenceLibraries.status");
  if (status === "active" && operation) return <LibraryOperationChip operation={operation} />;
  return (
    <StatusChip tone={LIBRARY_TONE[status]} icon={LIBRARY_ICON[status]} data-status={status}>
      {t(status)}
    </StatusChip>
  );
}

function LibraryOperationChip({ operation }: { operation: LibraryOperation }) {
  const t = useTranslations("evidenceLibraries.operation");
  const update = Boolean(operation.runtimeUpdate);
  const queued = operation.stage === "queued";
  const Icon = queued ? Clock : update ? RefreshCw : CloudUpload;
  return (
    <StatusChip tone={queued ? "neutral" : "running"} data-status={queued ? "queued" : update ? "updating" : "applying"}>
      <Icon aria-hidden className={update && !queued ? "animate-spin [animation-duration:2s] motion-reduce:animate-none" : undefined} />
      {t(queued ? "queued" : update ? "updating" : "applying")}
    </StatusChip>
  );
}
