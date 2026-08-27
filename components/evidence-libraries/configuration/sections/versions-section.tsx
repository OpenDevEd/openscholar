"use client";

import { ConvexError } from "convex/values";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { History, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Suspense, use, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  canRestore,
  changedCards,
  runtimeUpdateState,
  shortCommit,
  type VersionStatus,
} from "@/lib/evidence-libraries/configuration/versions";
import { EmptyList, FieldGroup, Panel } from "../fields";
import { SectionCard } from "../section-card";
import { StatusChip, type StatusTone } from "../status-chip";

type RuntimeState = FunctionReturnType<
  typeof api.evidenceLibraries.updates.check
>;
type VersionRow = FunctionReturnType<
  typeof api.evidenceLibraries.versions.listVersions
>[number];

/** The check never throws into render; a failure becomes a message in the panel. */
type RuntimeCheck =
  | { ok: true; state: RuntimeState }
  | { ok: false; message: string };

const VERSION_TONE: Record<VersionStatus, StatusTone> = {
  live: "success",
  previous: "neutral",
  failed: "danger",
  deploying: "running",
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown };
    if (typeof data?.message === "string") return data.message;
  }
  return fallback;
}

function settle(
  promise: Promise<RuntimeState>,
  fallback: string,
): Promise<RuntimeCheck> {
  return promise.then(
    (state) => ({ ok: true as const, state }),
    (error: unknown) => ({
      ok: false as const,
      message: errorMessage(error, fallback),
    }),
  );
}

type CheckAction = (args: {
  libraryId: Id<"evidenceLibraries">;
}) => Promise<RuntimeState>;

/**
 * One update check per page open, shared with `use()` across renders. The
 * outer key is the action callback, which Convex creates once per mounted
 * section, so opening the page again checks again and Strict Mode's second
 * render reuses the first call. "Check again" and a started update replace
 * the entry.
 */
const runtimeChecks = new WeakMap<
  CheckAction,
  Map<string, Promise<RuntimeCheck>>
>();

function runtimeCheck(
  check: CheckAction,
  libraryId: Id<"evidenceLibraries">,
  fallback: string,
  { fresh = false } = {},
): Promise<RuntimeCheck> {
  let byLibrary = runtimeChecks.get(check);
  if (!byLibrary) {
    byLibrary = new Map();
    runtimeChecks.set(check, byLibrary);
  }
  const cached = byLibrary.get(libraryId);
  if (cached && !fresh) return cached;
  const promise = settle(check({ libraryId }), fallback);
  byLibrary.set(libraryId, promise);
  return promise;
}

/**
 * The Evidence Library software the library runs, with an Update button when
 * newer software exists, and every published version with Restore. Not a
 * draft section: nothing here is saved with the form.
 */
export function VersionsSection({
  libraryId,
  live,
  operationRunning,
}: {
  libraryId: Id<"evidenceLibraries">;
  /** The library is active and running; drafts have no software to check. */
  live: boolean;
  /** A platform operation is applying; no update or restore may start. */
  operationRunning: boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const tc = useTranslations("common");
  const check = useAction(api.evidenceLibraries.updates.check);
  const startRuntimeUpdate = useMutation(
    api.evidenceLibraries.versions.startRuntimeUpdate,
  );
  const startAddressMove = useMutation(
    api.evidenceLibraries.versions.startAddressMove,
  );
  const restoreRevision = useMutation(
    api.evidenceLibraries.versions.restoreRevision,
  );
  const versions = useProtectedQuery(
    api.evidenceLibraries.versions.listVersions,
    { libraryId },
  );
  // The address answer the last check stored. It stays right even when the
  // software check cannot reach GitHub, and clears itself once a move lands.
  const addressNotices = useProtectedQuery(
    api.evidenceLibraries.updates.listAddressNotices,
    live ? {} : "skip",
  );
  const addressState =
    addressNotices.data?.find((notice) => notice.libraryId === libraryId)
      ?.addressState ?? null;

  // Opening the page checks for updates once; "Check again" asks once more.
  const [, setCheckCount] = useState(0);
  const checkPromise = live
    ? runtimeCheck(check, libraryId, t("versions.checkError"))
    : null;
  const [busy, setBusy] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [restoring, setRestoring] = useState<VersionRow | null>(null);

  const blocked = busy || operationRunning;

  function checkAgain() {
    runtimeCheck(check, libraryId, t("versions.checkError"), { fresh: true });
    setCheckCount((count) => count + 1);
  }

  function confirmUpdate() {
    setUpdateOpen(false);
    setBusy(true);
    void startRuntimeUpdate({ libraryId })
      .then((result) => {
        checkAgain();
        toast(t("versions.updateStarted"), {
          description: t("versions.updateStartedDescription", {
            rev: shortCommit(result.to),
          }),
        });
      })
      .catch((error: unknown) =>
        toast.error(errorMessage(error, t("versions.updateError"))),
      )
      .finally(() => setBusy(false));
  }

  function confirmMove() {
    setMoveOpen(false);
    setBusy(true);
    void startAddressMove({ libraryId })
      .then((result) => {
        checkAgain();
        toast(t("versions.addressMoveStarted"), {
          description: t("versions.addressMoveStartedDescription", {
            address: result.movedTo.replace(/^https?:\/\//, ""),
          }),
        });
      })
      .catch((error: unknown) =>
        toast.error(errorMessage(error, t("versions.addressMoveError"))),
      )
      .finally(() => setBusy(false));
  }

  function confirmRestore() {
    const target = restoring;
    setRestoring(null);
    if (!target) return;
    setBusy(true);
    void restoreRevision({ libraryId, revisionId: target.revisionId })
      .then((result) => {
        toast(t("versions.restoreStarted"), {
          description: t("versions.restoreStartedDescription", {
            rev: target.revisionKey,
            next: result.revisionKey,
          }),
        });
      })
      .catch((error: unknown) =>
        toast.error(errorMessage(error, t("versions.restoreError"))),
      )
      .finally(() => setBusy(false));
  }

  return (
    <SectionCard
      id="sec-versions"
      className="scroll-mt-40"
      icon={History}
      title={t("sections.versions")}
      description={t("versions.description")}
    >
      {addressState ? (
        <Panel
          tone="muted"
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3"
          data-address-state={addressState}
        >
          <p className="text-sm text-destructive">
            {t("versions.addressNotReachable")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked}
            onClick={() => setMoveOpen(true)}
          >
            {t("versions.addressMove")}
          </Button>
        </Panel>
      ) : null}

      <FieldGroup
        title={t("versions.softwareHeading")}
        action={
          checkPromise ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={checkAgain}
              disabled={blocked}
            >
              <RefreshCw />
              {t("versions.checkAgain")}
            </Button>
          ) : null
        }
      >
        {checkPromise ? (
          <Suspense
            fallback={
              <Panel
                tone="muted"
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Spinner className="h-4 w-4" />
                {t("versions.checking")}
              </Panel>
            }
          >
            <SoftwarePanel
              promise={checkPromise}
              blocked={blocked}
              onUpdate={() => setUpdateOpen(true)}
            />
          </Suspense>
        ) : (
          <Panel tone="muted" data-runtime-state="not-running">
            <p className="text-sm text-muted-foreground">
              {t("versions.notRunning")}
            </p>
          </Panel>
        )}
      </FieldGroup>

      <FieldGroup title={t("versions.historyHeading")}>
        {versions.data === undefined ? (
          <Panel
            tone="muted"
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Spinner className="h-4 w-4" />
            {t("versions.loading")}
          </Panel>
        ) : versions.data.length === 0 ? (
          <EmptyList>{t("versions.empty")}</EmptyList>
        ) : (
          <VersionTable
            rows={versions.data}
            blocked={blocked}
            onRestore={setRestoring}
          />
        )}
      </FieldGroup>

      <AlertDialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("versions.updateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("versions.updateBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUpdate}>
              {t("versions.updateConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={moveOpen} onOpenChange={setMoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("versions.addressMoveTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("versions.addressMoveBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMove}>
              {t("versions.addressMoveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) setRestoring(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("versions.restoreTitle", {
                rev: restoring?.revisionKey ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("versions.restoreBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore}>
              {t("versions.restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function SoftwarePanel({
  promise,
  blocked,
  onUpdate,
}: {
  promise: Promise<RuntimeCheck>;
  blocked: boolean;
  onUpdate: () => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const format = useFormatter();
  const result = use(promise);
  if (!result.ok) {
    return (
      <Panel tone="muted" role="alert" data-runtime-state="check-failed">
        <p className="text-sm text-destructive">{result.message}</p>
      </Panel>
    );
  }
  const { running, latest, changes, checkedAt } = result.state;
  const state = runtimeUpdateState({ running, latest });
  const updateAvailable = state === "update-available";
  return (
    <Panel tone="muted" className="space-y-3" data-runtime-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {updateAvailable ? (
          <StatusChip tone="warning">
            {t("versions.updateAvailable")}
          </StatusChip>
        ) : (
          <StatusChip tone="success">{t("versions.upToDate")}</StatusChip>
        )}
        {updateAvailable ? (
          <Button type="button" size="sm" disabled={blocked} onClick={onUpdate}>
            <RefreshCw />
            {t("versions.update")}
          </Button>
        ) : null}
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-xs font-medium text-muted-foreground">
          {t("versions.runningLabel")}
        </dt>
        <dd className="font-mono" data-running={running}>
          {shortCommit(running)}
        </dd>
        <dt className="text-xs font-medium text-muted-foreground">
          {t("versions.latestLabel")}
        </dt>
        <dd className="font-mono" data-latest={latest}>
          {shortCommit(latest)}
        </dd>
        <dt className="text-xs font-medium text-muted-foreground">
          {t("versions.checkedLabel")}
        </dt>
        <dd>
          {format.dateTime(new Date(checkedAt), {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </dd>
      </dl>
      {updateAvailable && changes.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("versions.changesHeading")}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            {changes.map((change) => (
              <li key={change.sha}>
                <span className="mr-2 font-mono text-xs text-muted-foreground">
                  {shortCommit(change.sha)}
                </span>
                {change.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function VersionTable({
  rows,
  blocked,
  onRestore,
}: {
  rows: readonly VersionRow[];
  blocked: boolean;
  onRestore: (row: VersionRow) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const format = useFormatter();

  function changed(row: VersionRow) {
    if (row.kind === "runtime") {
      return row.runtimeCommit
        ? `${t("versions.softwareUpdate")} ${shortCommit(row.runtimeCommit)}`
        : t("versions.softwareUpdate");
    }
    const cards = changedCards(row.changedSections);
    return cards.length === 0
      ? t("versions.everything")
      : cards.map((card) => t(`sections.${card}`)).join(", ");
  }

  return (
    <div className="rounded-lg border border-border/50 bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("versions.colVersion")}</TableHead>
            <TableHead>{t("versions.colWhen")}</TableHead>
            <TableHead>{t("versions.colBy")}</TableHead>
            <TableHead>{t("versions.colChanged")}</TableHead>
            <TableHead>{t("versions.colStatus")}</TableHead>
            <TableHead className="w-28">
              <span className="sr-only">{t("versions.restore")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.operationId}
              data-version-status={row.status}
              data-revision={row.revisionKey}
            >
              <TableCell className="font-mono text-xs">
                {row.revisionKey}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {format.dateTime(new Date(row.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </TableCell>
              <TableCell className="text-sm">{row.by}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {changed(row)}
              </TableCell>
              <TableCell>
                <StatusChip tone={VERSION_TONE[row.status]}>
                  {t(`versions.status.${row.status}`)}
                </StatusChip>
              </TableCell>
              <TableCell className="text-right">
                {canRestore(row.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={blocked}
                    onClick={() => onRestore(row)}
                  >
                    {t("versions.restore")}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
