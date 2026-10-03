"use client";

import { Clock, CloudUpload, PencilLine, RefreshCw, Trash2, type AppIcon } from "@/components/icons";
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
const LIBRARY_ICON: Record<LibraryStatus, AppIcon | "tone"> = {
  draft: PencilLine,
  setting_up: "tone",
  active: "tone",
  setup_failed: "tone",
  deleting: Trash2,
};

/**
 * A library's status from its row and its newest operation, for pages that
 * load the library itself. The same rule as the list's overview query.
 */
export function libraryStatusOf(
  state: "provisioning" | "active" | "disabled",
  operation: { kind: string; status: string } | null,
): LibraryStatus {
  if (state === "disabled") return "deleting";
  if (state === "active") return "active";
  if (operation?.kind === "setup" && operation.status === "running") return "setting_up";
  if (operation?.kind === "setup" && operation.status === "failed") return "setup_failed";
  return "draft";
}

/** The build a live library is running: a software update, or published changes. */
export type LibraryOperation = NonNullable<
  FunctionReturnType<typeof api.evidenceLibraries.queries.listLibraryOverviews>[number]["operation"]
>;

/**
 * A library's one status word. A live library that is updating or publishing
 * says that instead of Active.
 */
export function LibraryStatusChip({
  status,
  operation,
  labelClassName,
}: {
  status: LibraryStatus;
  operation?: LibraryOperation | null;
  /** Where room is short, such as a page header on a phone, the word can go to screen readers only. */
  labelClassName?: string;
}) {
  const t = useTranslations("evidenceLibraries.status");
  if (status === "active" && operation) return <LibraryOperationChip operation={operation} labelClassName={labelClassName} />;
  return (
    <StatusChip tone={LIBRARY_TONE[status]} icon={LIBRARY_ICON[status]} data-status={status}>
      <span className={labelClassName}>{t(status)}</span>
    </StatusChip>
  );
}

function LibraryOperationChip({ operation, labelClassName }: { operation: LibraryOperation; labelClassName?: string }) {
  const t = useTranslations("evidenceLibraries.operation");
  const update = Boolean(operation.runtimeUpdate);
  const queued = operation.stage === "queued";
  const Icon = queued ? Clock : update ? RefreshCw : CloudUpload;
  return (
    <StatusChip tone={queued ? "neutral" : "running"} data-status={queued ? "queued" : update ? "updating" : "applying"}>
      <Icon aria-hidden className={update && !queued ? "animate-spin [animation-duration:2s] motion-reduce:animate-none" : undefined} />
      <span className={labelClassName}>{t(queued ? "queued" : update ? "updating" : "applying")}</span>
    </StatusChip>
  );
}
