"use client";

import { ConvexError } from "convex/values";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { RefreshCw, HistoryIcon } from "@/components/icons";
import { useFormatter, useTranslations } from "next-intl";
import { Suspense, use, useDeferredValue, useState, type ReactNode } from "react";
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  runtimeUpdateState,
  shortCommit,
} from "@/lib/evidence-libraries/configuration/versions";
import { FieldGroup, Panel } from "../fields";
import { InlineNotice, SectionCard } from "../section-card";
import { StatusChip } from "../status-chip";
import { ReleaseNotes, VersionHistory } from "./versions-views";

type RuntimeState = FunctionReturnType<typeof api.evidenceLibraries.updates.check>;
type VersionRow = FunctionReturnType<
  typeof api.evidenceLibraries.versions.listVersions
>[number];

/** The check never throws into render; a failure becomes a message in the panel. */
type RuntimeCheck =
  | { ok: true; state: RuntimeState }
  | { ok: false; message: string };

/** What the owner is told about an address that is not answering as ours. */
const ADDRESS_STATE_MESSAGE = {
  "not-ours": "versions.addressTaken",
  unreachable: "versions.addressSilent",
} as const;

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

type CheckAction = (args: FunctionArgs<typeof api.evidenceLibraries.updates.check>) => Promise<RuntimeState>;

/**
 * One update check per page open, shared with `use()` across renders. The
 * outer key is the action callback, which Convex creates once per mounted
 * section, so opening the page again checks again and Strict Mode's second
 * render reuses the first call. Each refresh uses a new key so React observes
 * the new promise instead of retaining the previous result.
 */
const runtimeChecks = new WeakMap<CheckAction, Map<string, Promise<RuntimeCheck>>>();

function runtimeCheck(
  check: CheckAction,
  libraryId: Id<"evidenceLibraries">,
  refreshKey: string,
  fallback: string,
  refresh: boolean,
): Promise<RuntimeCheck> {
  let byLibrary = runtimeChecks.get(check);
  if (!byLibrary) {
    byLibrary = new Map();
    runtimeChecks.set(check, byLibrary);
  }
  const cacheKey = `${libraryId}:${refreshKey}`;
  const cached = byLibrary.get(cacheKey);
  if (cached) return cached;
  const promise = settle(check({ libraryId, refresh }), fallback);
  byLibrary.set(cacheKey, promise);
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
  refreshKey,
}: {
  libraryId: Id<"evidenceLibraries">;
  /** The library is active and running; drafts have no software to check. */
  live: boolean;
  /** A platform operation is applying; no update or restore may start. */
  operationRunning: boolean;
  /** Changes after a runtime update finishes, causing one fresh software check. */
  refreshKey: string;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const tc = useTranslations("common");
  const check = useAction(api.evidenceLibraries.updates.check);
  const startRuntimeUpdate = useMutation(
    api.evidenceLibraries.versions.startRuntimeUpdate,
  );
  const moveAddress = useAction(
    api.evidenceLibraries.addressActions.moveLibraryAddress,
  );
  const setDomainPrimary = useMutation(
    api.evidenceLibraries.versions.setDomainPrimary,
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
  const addressNotice =
    addressNotices.data?.find((notice) => notice.libraryId === libraryId) ??
    null;
  // A silent custom domain is not fixed by moving the platform address: the
  // way out is to send the library back to it.
  const domains = useProtectedQuery(
    api.evidenceLibraries.domains.listDomains,
    addressNotice ? { libraryId } : "skip",
  );
  const deadDomain = domains.data?.domains.find(
    (domain) =>
      domain.role === "primary" &&
      `https://${domain.host}` === addressNotice?.address,
  );

  // Opening the page checks for updates once; "Check again" asks once more.
  const [checkCount, setCheckCount] = useState(0);
  const checkError = t("versions.checkError");
  const checkPromise = live
    ? runtimeCheck(check, libraryId, `${refreshKey}:${checkCount}`, checkError, checkCount > 0)
    : null;
  // Keep the last result visible while a manual or post-update check suspends.
  const deferredCheckPromise = useDeferredValue(checkPromise);
  const checking = checkPromise !== deferredCheckPromise;
  const [busy, setBusy] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [restoring, setRestoring] = useState<VersionRow | null>(null);

  const blocked = busy || checking || operationRunning;

  function checkAgain() {
    setCheckCount((count) => count + 1);
  }

  function confirmUpdate() {
    setUpdateOpen(false);
    setBusy(true);
    void startRuntimeUpdate({ libraryId })
      .catch((error: unknown) =>
        toast.error(errorMessage(error, t("versions.updateError"))),
      )
      .finally(() => setBusy(false));
  }

  function confirmMove() {
    setMoveOpen(false);
    setBusy(true);
    if (deadDomain) {
      void setDomainPrimary({
        libraryId,
        domainId: deadDomain.domainId,
        primary: false,
      })
        .then((result) => {
          toast(t("versions.addressMoveStarted"), {
            description: t("versions.addressMoveStartedDescription", {
              address: result.address.replace(/^https?:\/\//, ""),
            }),
          });
        })
        .catch((error: unknown) =>
          toast.error(errorMessage(error, t("versions.addressMoveError"))),
        )
        .finally(() => setBusy(false));
      return;
    }
    void moveAddress({ libraryId })
      .then((result) => {
        checkAgain();
        if (result.status !== "moving") {
          toast.error(t("versions.addressMoveError"));
          return;
        }
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
      .catch((error: unknown) =>
        toast.error(errorMessage(error, t("versions.restoreError"))),
      )
      .finally(() => setBusy(false));
  }

  return (
    <SectionCard
      id="sec-versions"
      icon={HistoryIcon}
      title={t("sections.versions")}
      description={t("versions.description")}
    >
      {addressNotice?.addressState ? (
        <InlineNotice
          tone="danger"
          role="alert"
          data-address-state={addressNotice.addressState}
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              disabled={blocked}
              onClick={() => setMoveOpen(true)}
            >
              {deadDomain
                ? t("versions.addressBack")
                : t("versions.addressMove")}
            </Button>
          }
        >
          {t(ADDRESS_STATE_MESSAGE[addressNotice.addressState], {
            host: addressNotice.address.replace(/^https?:\/\//, ""),
          })}
        </InlineNotice>
      ) : null}

      <div data-section-part="software">
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
              promise={deferredCheckPromise ?? checkPromise}
              blocked={blocked}
              onUpdate={() => setUpdateOpen(true)}
              checkAgain={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={checkAgain}
                  disabled={blocked}
                  aria-busy={checking}
                >
                  {checking ? <Spinner aria-hidden="true" /> : <RefreshCw />}
                  {t("versions.checkAgain")}
                </Button>
              }
            />
          </Suspense>
        ) : (
          <Panel tone="muted" data-runtime-state="not-running">
            <p className="text-sm text-muted-foreground">
              {t("versions.notRunning")}
            </p>
          </Panel>
        )}
      </div>

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
        ) : (
          <VersionHistory
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
              {deadDomain
                ? t("domain.confirmOffTitle")
                : t("versions.addressMoveTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deadDomain
                ? t("domain.confirmOffBody", {
                    address: domains.data?.platformAddress ?? "",
                  })
                : t("versions.addressMoveBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMove}>
              {deadDomain
                ? t("domain.confirmAction")
                : t("versions.addressMoveConfirm")}
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
              {t("versions.restoreTitle", { rev: restoring?.revisionKey ?? "" })}
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
  checkAgain,
}: {
  promise: Promise<RuntimeCheck>;
  blocked: boolean;
  onUpdate: () => void;
  /** The "Check again" button; it lives inside the panel, next to Update. */
  checkAgain: ReactNode;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const format = useFormatter();
  const result = use(promise);
  if (!result.ok) {
    return (
      <Panel
        tone="muted"
        role="alert"
        data-runtime-state="check-failed"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm text-destructive">{result.message}</p>
        {checkAgain}
      </Panel>
    );
  }
  const { running, latest, changes, releases, checkedAt } = result.state;
  const state = runtimeUpdateState({ running, latest });
  const updateAvailable = state === "update-available";
  return (
    <Panel tone="muted" className="space-y-3" data-runtime-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {updateAvailable ? (
          <StatusChip tone="warning">{t("versions.updateAvailable")}</StatusChip>
        ) : (
          <StatusChip tone="success">{t("versions.upToDate")}</StatusChip>
        )}
        <div className="flex items-center gap-1">
          {checkAgain}
          {updateAvailable ? (
            <Button type="button" size="sm" disabled={blocked} onClick={onUpdate}>
              <RefreshCw />
              {t("versions.update")}
            </Button>
          ) : null}
        </div>
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
      {updateAvailable && (releases.length > 0 || changes.length > 0) ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t("versions.changesHeading")}
          </p>
          <ReleaseNotes releases={releases} changes={changes} />
        </div>
      ) : null}
    </Panel>
  );
}
