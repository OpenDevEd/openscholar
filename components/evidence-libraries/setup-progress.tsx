"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, Settings , CircleDashed } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  type SetupStep,
  setupPercent,
  setupSteps,
} from "@/lib/evidence-libraries/setup/steps";
import {
  publicOperationErrorMessage,
  publicOperationIssueMessages,
} from "@/lib/evidence-libraries/public-operation-error";
import { cn } from "@/lib/utils";
import { AdminAreaLink } from "./admin-area-link";
import { FieldGroup } from "./configuration/fields";
import { InlineNotice } from "./configuration/section-card";
import { LibraryAddressLink } from "./library-address-link";
import { LibraryNotFound } from "./library-not-found";
import { SetupHero } from "./live-hero";
import { LibraryPageShell } from "./library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "./configuration/panel-header";
import { LibraryStatusChip } from "./library-status-chip";

export function SetupProgress({ libraryId }: { libraryId: string }) {
  const setupQuery = useProtectedQuery(
    api.evidenceLibraries.queries.getSetupDraftSelection,
    { libraryId },
  );
  const retrySetup = useMutation(api.evidenceLibraries.mutations.retrySetup);

  if (setupQuery.data === undefined) {
    return <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />;
  }
  if (setupQuery.data === null) return <LibraryNotFound />;

  return <SetupProgressView setup={setupQuery.data} retrySetup={retrySetup} />;
}

export type SetupProgressData = NonNullable<
  FunctionReturnType<typeof api.evidenceLibraries.queries.getSetupDraftSelection>
>;

/** The page itself, given the setup data. Kept separate so it can render without a query. */
export function SetupProgressView({
  setup,
  retrySetup,
}: {
  setup: SetupProgressData;
  retrySetup: (args: { libraryId: SetupProgressData["library"]["_id"] }) => Promise<unknown>;
}) {
  const t = useTranslations("evidenceLibraries.setup");
  const [retrying, setRetrying] = useState(false);
  const status = setup.status;
  const failed = status === "setup_failed";
  const active = status === "active";
  const base = `/evidence-libraries/${setup.library._id}`;
  const address = setup.publicAddress;
  const steps = setupSteps({
    status: setup.setupOperation.status,
    stage: setup.setupOperation.stage,
    receipts: setup.setupOperation.setupReceipts,
    updatedAt: setup.setupOperation.updatedAt,
  });
  const percent = setupPercent(steps);
  const current = steps.find((s) => s.status === "running" || s.status === "failed") ?? steps[5];
  // Building, stopped and live share one surface; a draft has not started and keeps the plain list;
  // a library being deleted only says so.
  const hero = status === "setting_up" || failed || active;
  const deleting = status === "deleting";
  const publicError = failed
    ? publicOperationErrorMessage(
        setup.setupOperation.error,
        t("deploymentError"),
      )
    : undefined;
  const publicReasons = failed
    ? publicOperationIssueMessages(
        setup.setupOperation.issues,
        t("deploymentError"),
      )?.filter((reason) => reason !== publicError)
    : undefined;

  function retry() {
    if (retrying) return;
    setRetrying(true);
    void retrySetup({ libraryId: setup.library._id })
      .then(() => toast(t("retryingTitle"), { description: t("retryingDescription") }))
      .catch(() => toast.error(t("retryError")))
      .finally(() => setRetrying(false));
  }

  return (
    <LibraryPageShell
      title={setup.identity.name}
      image={setup.faviconUrl}
      backHref="/evidence-libraries"
      backLabel={t("backToLibraries")}
      titleAside={<><LibraryStatusChip status={status} /><LibraryAddressLink address={address} className="hidden text-sm text-muted-foreground @5xl:inline-flex" /></>}
      actions={
        <>
          {status === "draft" || active ? (
            <Button asChild size="sm" variant={active ? "outline" : "default"} className={BAR_ACTION}>
              <Link href={`${base}/configuration`}>
                <Settings />
                <span className={BAR_LABEL}>{t("configure")}</span>
              </Link>
            </Button>
          ) : null}
          {active ? (
            <Button asChild size="sm" className={BAR_ACTION}>
              <AdminAreaLink libraryId={setup.library._id}>
                <ExternalLink />
                <span className={BAR_LABEL}>{t("openAdmin")}</span>
              </AdminAreaLink>
            </Button>
          ) : null}
        </>
      }
    >
      <div
        className={cn("space-y-4", hero ? "p-0" : "p-4 md:p-6")}
        data-deleting={deleting || undefined}
        role={failed ? "alert" : "status"}
        aria-live="polite"
        aria-busy={retrying}
        data-setup-status={status}
        data-setup-step={current.key}
      >
        {hero ? (
          <SetupHero
            status={status}
            name={setup.identity.name}
            address={address}
            steps={steps}
            percent={percent}
            currentStep={current}
            errorMessage={publicError}
            errorReasons={publicReasons}
            onRetry={retry}
            retrying={retrying}
          />
        ) : deleting ? (
          <InlineNotice tone="warning">{t("deletingHint")}</InlineNotice>
        ) : (
          <FieldGroup title={t("groupTitle")}>
            <div className="space-y-4">
              <InlineNotice
                tone="info"
                action={
                  <Button asChild size="sm" variant="outline" className="h-7">
                    <Link href={`${base}/configuration`}>{t("configure")}</Link>
                  </Button>
                }
              >
                {t("draftHint")}
              </InlineNotice>
              <ol className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-background">
                {steps.map((step) => (
                  <DraftStepRow key={step.key} step={step} />
                ))}
              </ol>
            </div>
          </FieldGroup>
        )}
      </div>
    </LibraryPageShell>
  );
}

/** One step of a draft library: nothing has run yet, so every row is waiting. */
function DraftStepRow({ step }: { step: SetupStep }) {
  const t = useTranslations("evidenceLibraries.setup");
  return (
    <li data-step={step.key} data-state={step.status} className="flex items-start gap-3 p-3">
      <span className="flex size-5 shrink-0 items-center justify-center">
        <CircleDashed aria-hidden className="size-3.5 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium text-muted-foreground">{t(`steps.${step.key}.name`)}</p>
        <p className="text-xs text-muted-foreground">{t(`steps.${step.key}.waiting`)}</p>
      </div>
    </li>
  );
}
