"use client";

import {
  Check,
  Database,
  ExternalLink,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAction, useQueries } from "convex/react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { SourceStatus } from "@/convex/evidenceLibraries/sourceStatusValidators";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AdminAreaLink } from "@/components/evidence-libraries/admin-area-link";
import { cn } from "@/lib/utils";
import { DisclosureButton } from "../disclosure-button";
import { type StatusTone } from "../status-chip";

type Running = Extract<SourceStatus, { state: "running" }>;
type Failed = Extract<SourceStatus, { state: "failed" }>;

/**
 * The row's chip: the state in one word, so a long list scans quickly.
 * `null` is a source the library has not seen yet: it imports after Activate.
 */
export function useSourceStatusChip() {
  const t = useTranslations("evidenceLibraryConfiguration.sources.status");
  return (status: SourceStatus | null, paused: boolean): { label: string; tone: StatusTone } => {
    if (paused) return { label: t("chip.paused"), tone: "neutral" };
    if (!status || status.state === "idle") return { label: t("chip.waiting"), tone: "neutral" };
    if (status.state === "running") {
      return { label: t(status.phase === "import" ? "chip.importing" : "chip.searching"), tone: "running" };
    }
    if (status.state === "failed") return { label: t("chip.failed"), tone: "danger" };
    return { label: t("chip.upToDate"), tone: "success" };
  };
}

type PhaseState = "running" | "done" | "failed" | "waiting";

const PHASE_LOOK: Record<PhaseState, { text: string; ring: string }> = {
  running: { text: "text-primary", ring: "bg-primary/10" },
  done: { text: "text-emerald-700 dark:text-emerald-400", ring: "bg-emerald-500/10" },
  failed: { text: "text-destructive", ring: "bg-destructive/10" },
  waiting: { text: "text-muted-foreground", ring: "bg-muted" },
};

function Phase({ label, icon: Icon, state }: { label: string; icon: LucideIcon; state: PhaseState }) {
  const look = PHASE_LOOK[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", look.text)}>
      <span className={cn("grid size-6 place-items-center rounded-full", look.ring)}>
        {state === "running" ? (
          <Spinner role="presentation" aria-label={undefined} className="size-3.5" />
        ) : state === "done" ? (
          <Check aria-hidden className="size-3.5" strokeWidth={3} />
        ) : state === "failed" ? (
          <X aria-hidden className="size-3.5" strokeWidth={3} />
        ) : (
          <Icon aria-hidden className="size-3.5" />
        )}
      </span>
      {label}
    </span>
  );
}

function phaseStates(status: SourceStatus | null): [PhaseState, PhaseState] {
  if (!status) return ["waiting", "waiting"];
  switch (status.state) {
    case "running":
      return status.phase === "import" ? ["running", "waiting"] : ["done", "running"];
    case "succeeded":
      return ["done", "done"];
    case "failed":
      return ["failed", "waiting"];
    case "idle":
      return ["waiting", "waiting"];
  }
}

/** Import records, then Update search, with the one under way lit. */
function PhaseTrack({ status }: { status: SourceStatus | null }) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.status");
  const [importState, searchState] = phaseStates(status);
  return (
    <div className="flex items-center gap-2">
      <Phase label={t("steps.import")} icon={Database} state={importState} />
      <span
        aria-hidden
        className={cn(
          "h-px flex-1 transition-colors duration-500 motion-reduce:transition-none",
          importState === "done" ? "bg-emerald-500/50" : "bg-border",
        )}
      />
      <Phase label={t("steps.search")} icon={Search} state={searchState} />
    </div>
  );
}

/** A bar with no end, for a source that has not said how many records it holds. */
function OpenEndedBar({ label }: { label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className="relative h-2 w-full overflow-hidden rounded-full bg-foreground/10"
    >
      <span className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary animate-[source-open-ended_1.4s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" />
    </div>
  );
}

function RunningActivity({ status }: { status: Running }) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.status");
  const format = useFormatter();
  const fraction = status.total ? status.done / status.total : null;
  const label = t(status.phase === "import" ? "importProgress" : "searchProgress");
  const unit =
    status.total === null
      ? t(status.phase === "import" ? "soFar" : "searchSoFar")
      : t(status.phase === "import" ? "ofTotal" : "searchOfTotal", { total: status.total });
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-4">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">
            {format.number(status.done)}
          </span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </p>
        {fraction === null ? null : (
          <span className="text-lg font-semibold leading-none tabular-nums">
            {format.number(Math.floor(fraction * 100) / 100, { style: "percent" })}
          </span>
        )}
      </div>
      {fraction === null ? (
        <OpenEndedBar label={label} />
      ) : (
        <Progress
          aria-label={label}
          value={fraction * 100}
          className="h-2 bg-foreground/10 [&>[data-slot=progress-indicator]]:duration-700 [&>[data-slot=progress-indicator]]:ease-out motion-reduce:[&>[data-slot=progress-indicator]]:transition-none"
        />
      )}
      <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
        <span>{t("started", { time: format.dateTime(new Date(status.startedAt), { timeStyle: "short" }) })}</span>
        <span>
          {status.minutesLeft === null
            ? null
            : status.minutesLeft < 1
              ? t("underAMinute")
              : t("minutesLeft", { minutes: status.minutesLeft })}
        </span>
      </div>
    </div>
  );
}

/** A place in a library's admin: the library, and where in it to land. */
type AdminDestination = { libraryId: string; returnPath: string };

function SucceededActivity({ status, issuesIn }: { status: SourceStatus; issuesIn: AdminDestination }) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.status");
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const issues = Object.values(status.issues).reduce((sum, count) => sum + count, 0);
  const checked = status.lastSuccessAt ? format.relativeTime(new Date(status.lastSuccessAt), now) : null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1.5">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">
            {format.number(status.searchable ?? 0)}
          </span>
          <span className="text-sm text-muted-foreground">{t("searchable")}</span>
        </p>
        {checked ? (
          <p className="text-xs text-muted-foreground">
            {status.changed === null
              ? t("checked", { when: checked })
              : t("changed", { count: status.changed, when: checked })}
          </p>
        ) : null}
      </div>
      {issues > 0 ? (
        <Button asChild variant="outline" size="sm">
          <AdminAreaLink libraryId={issuesIn.libraryId} returnPath={issuesIn.returnPath}>
            <TriangleAlert className="text-amber-600 dark:text-amber-400" />
            {t("reviewIssues", { count: issues })}
            <ExternalLink className="text-muted-foreground" />
          </AdminAreaLink>
        </Button>
      ) : null}
    </div>
  );
}

function FailedActivity({
  status,
  provider,
  onRetry,
  retrying,
}: {
  status: Failed;
  provider: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.status");
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-lg font-semibold leading-tight tracking-tight text-destructive">
          {t("failedAt", { time: format.dateTime(new Date(status.failure.at), { timeStyle: "short" }) })}
        </p>
        <p className="text-sm leading-relaxed">{t(`failure.${status.failure.code}`, { provider })}</p>
        {status.lastSuccessAt ? (
          <p className="text-xs text-muted-foreground">
            {t("lastSuccess", { when: format.relativeTime(new Date(status.lastSuccessAt), now) })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? <Spinner /> : <RefreshCw />}
          {t("retry")}
        </Button>
        <DisclosureButton open={open} controls={detailsId} className="ml-0" onToggle={() => setOpen((value) => !value)}>
          {t("details")}
        </DisclosureButton>
      </div>
      {open ? (
        <pre id={detailsId} className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
          {status.failure.details}
        </pre>
      ) : null}
    </div>
  );
}

const BAND: Record<SourceStatus["state"] | "waiting", string> = {
  running: "bg-primary/[0.05]",
  succeeded: "bg-emerald-500/[0.05]",
  failed: "bg-destructive/[0.06]",
  idle: "bg-muted/40",
  waiting: "bg-muted/40",
};

/**
 * The foot of a source row: the two steps, then one large figure or
 * headline, tinted by state so the state reads before the words. A `null`
 * status is a source the library has not seen yet.
 */
export function SourceActivityBand({
  status,
  provider,
  issuesIn,
  onRetry,
  retrying,
}: {
  status: SourceStatus | null;
  /** The provider's name, for failure messages. */
  provider: string;
  /** The admin, opened on this source's record issues. */
  issuesIn: AdminDestination;
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.status");
  const chip = useSourceStatusChip();
  return (
    <section
      aria-label={t("label")}
      data-source-state={status?.state ?? "waiting"}
      className={cn(
        "space-y-4 px-4 pb-4 pt-3.5 transition-colors duration-300 motion-reduce:transition-none",
        BAND[status?.state ?? "waiting"],
      )}
    >
      {/* Only the state is announced; the counts change every few seconds. */}
      <span className="sr-only" aria-live="polite">
        {chip(status, false).label}
      </span>
      <PhaseTrack status={status} />
      {status?.state === "running" ? <RunningActivity status={status} /> : null}
      {status?.state === "succeeded" ? <SucceededActivity status={status} issuesIn={issuesIn} /> : null}
      {status?.state === "failed" ? (
        <FailedActivity status={status} provider={provider} onRetry={onRetry} retrying={retrying} />
      ) : null}
      {!status || status.state === "idle" ? (
        <p className="text-base font-semibold tracking-tight text-muted-foreground">
          {t(status ? "startsSoon" : "afterActivate")}
        </p>
      ) : null}
    </section>
  );
}

// A running import reports every few seconds; this long without one means it stopped.
const STALE_RUNNING_MS = 120_000;

export type SourceLive = { status: { label: string; tone: StatusTone }; activity: ReactNode };

/**
 * Each source's live chip and band, from the library's latest report. Returns
 * null for every source until the library has reported once, so a library
 * on older software keeps its plain rows.
 */
export function useSourceActivity(libraryId: Id<"evidenceLibraries">) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.status");
  const chip = useSourceStatusChip();
  const { canRunProtectedQueries } = useAuthReadiness();
  // useQueries hands a failure back instead of throwing it: a status the
  // backend cannot give yet (its functions deploy after the site) leaves the
  // plain rows rather than taking down the configuration editor.
  const result = useQueries(
    canRunProtectedQueries
      ? { report: { query: api.evidenceLibraries.sourceStatus.listForLibrary, args: { libraryId } } }
      : {},
  ).report as FunctionReturnType<typeof api.evidenceLibraries.sourceStatus.listForLibrary> | Error | undefined;
  const report = result instanceof Error ? null : result;
  const requestRun = useAction(api.zotero.runtimeReadActions.requestSourceRun);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const now = useNow({ updateInterval: 30_000 });

  function retry(sourceKey: string) {
    setRetrying((keys) => new Set(keys).add(sourceKey));
    requestRun({ libraryId, sourceKey })
      .then((result) => {
        // No running library to ask: nothing was requested.
        if (result.reason) throw new Error(result.reason);
        toast.success(t("retryStarted"));
      })
      .catch(() => toast.error(t("retryFailed")))
      .finally(() =>
        setRetrying((keys) => {
          const next = new Set(keys);
          next.delete(sourceKey);
          return next;
        }),
      );
  }

  return (sourceKey: string, paused: boolean, provider: string): SourceLive | null => {
    if (!report) return null;
    const status = report.sources.find((source) => source.key === sourceKey) ?? null;
    // A running import reports every few seconds; silence means the library
    // stopped reporting, so its last progress is no longer known.
    if (status?.state === "running" && now.getTime() - report.observedAt > STALE_RUNNING_MS) return null;
    return {
      activity: paused ? null : (
        <SourceActivityBand
          status={status}
          provider={provider}
          issuesIn={{ libraryId, returnPath: `/admin?source=${encodeURIComponent(sourceKey)}` }}
          onRetry={() => retry(sourceKey)}
          retrying={retrying.has(sourceKey)}
        />
      ),
      status: chip(status, paused),
    };
  };
}
