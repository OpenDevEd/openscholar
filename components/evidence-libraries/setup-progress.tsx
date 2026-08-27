"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, ExternalLink, RefreshCw, Settings, X } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  type SetupStep,
  setupPercent,
  setupSteps,
} from "@/lib/evidence-libraries/setup/steps";
import { cn } from "@/lib/utils";
import { FieldGroup } from "./configuration/fields";
import { InlineNotice } from "./configuration/section-card";
import { LibraryAddressLink } from "./library-address-link";
import { LibraryNotFound } from "./library-not-found";
import { SetupHero } from "./live-hero";
import { LibraryPageShell } from "./library-page-shell";
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
  const hero = status === "setting_up" || status === "setup_failed" || status === "active";

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
      description={<LibraryAddressLink address={address} />}
      backHref="/evidence-libraries"
      backLabel={t("backToLibraries")}
      titleAside={<LibraryStatusChip status={status} />}
      actions={
        <>
          {status === "draft" || active ? (
            <Button asChild variant={active ? "outline" : "default"}>
              <Link href={`${base}/configuration`}>
                <Settings />
                {t("configure")}
              </Link>
            </Button>
          ) : null}
          {active ? (
            <Button asChild>
              <Link href={`${base}/admin`}>
                <ExternalLink />
                {t("openAdmin")}
              </Link>
            </Button>
          ) : null}
        </>
      }
    >
      <div
        className={cn("space-y-4", hero ? "p-0" : "p-4 md:p-6")}
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
            errorMessage={failed ? setup.setupOperation.error?.message : undefined}
            onRetry={retry}
            retrying={retrying}
          />
        ) : null}

        {hero ? null : (
        <FieldGroup title={t("groupTitle")}>
          <div className="space-y-4">
            {active ? null : (
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">{t(`steps.${current.key}.name`)}</span>
                  <span className="tabular-nums">{percent}%</span>
                </div>
                <Progress
                  value={percent}
                  aria-label={t("groupTitle")}
                  className={cn(
                    failed && "bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive",
                  )}
                />
              </div>
            )}

            {status === "draft" ? (
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
            ) : null}

            <ol className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-background">
              {steps.filter((step) => !(active && step.key === "active")).map((step) => (
                <StepRow
                  key={step.key}
                  step={step}
                  errorMessage={
                    step.status === "failed" ? setup.setupOperation.error?.message : undefined
                  }
                  onRetry={retry}
                  retrying={retrying}
                />
              ))}
            </ol>
          </div>
        </FieldGroup>
        )}
      </div>
    </LibraryPageShell>
  );
}

function StepMark({ status }: { status: SetupStep["status"] }) {
  if (status === "done") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-emerald-600 dark:text-emerald-400">
        <Check className="size-4" />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-primary">
        <Spinner className="size-4" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-destructive">
        <X className="size-4" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <span className="size-2 rounded-full bg-muted-foreground/50" />
    </span>
  );
}

function StepRow({
  step,
  errorMessage,
  onRetry,
  retrying,
}: {
  step: SetupStep;
  errorMessage: string | undefined;
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations("evidenceLibraries.setup");
  const format = useFormatter();
  const line =
    step.status === "failed"
      ? (errorMessage ?? t("deploymentError"))
      : t(`steps.${step.key}.${step.status}`);

  return (
    <li data-step={step.key} data-state={step.status} className="space-y-3 p-3">
      <div className="flex items-start gap-3">
        <StepMark status={step.status} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className={cn("text-sm font-medium", step.status === "waiting" && "text-muted-foreground")}>
            {t(`steps.${step.key}.name`)}
          </p>
          <p className="text-xs text-muted-foreground">{line}</p>
        </div>
        {step.at ? (
          <span className="text-xs font-mono text-muted-foreground tabular-nums">
            {format.dateTime(new Date(step.at), { timeStyle: "medium" })}
          </span>
        ) : null}
      </div>
      {step.status === "failed" ? (
        <InlineNotice
          tone="danger"
          action={
            <Button size="sm" variant="outline" className="h-7" onClick={onRetry} disabled={retrying}>
              <RefreshCw />
              {t("retry")}
            </Button>
          }
        >
          {t("stoppedHint")}
        </InlineNotice>
      ) : null}
    </li>
  );
}
