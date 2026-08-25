"use client";

import {
  ArrowLeft,
  Box,
  Check,
  Database,
  ExternalLink,
  HardDrive,
  HeartPulse,
  Play,
  RefreshCw,
  Rocket,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  doneStepCount,
  type SetupStep,
  type SetupStepKey,
} from "@/lib/evidence-libraries/mock/data";
import {
  selectLibrary,
  useEvidenceLibraryMockStore,
} from "@/lib/evidence-libraries/mock/store";
import { LibraryNotFound } from "./library-not-found";
import { LibraryStatusBadge, StatusChip } from "./library-status-badge";
import { PanelHeader } from "./panel-header";
import { PrototypeBadge } from "./prototype-badge";
import { InlineNotice, SectionCard } from "./section-card";

const STEP_ICONS: Record<SetupStepKey, LucideIcon> = {
  database: Database,
  storage: HardDrive,
  application: Box,
  deployment: Rocket,
  readiness: HeartPulse,
  active: Check,
};

const TOTAL_STEPS = 5;

export function SetupProgress({ libraryId }: { libraryId: string }) {
  const t = useTranslations("evidenceLibraryMock.setup");
  const library = useEvidenceLibraryMockStore(selectLibrary(libraryId));
  const startSetup = useEvidenceLibraryMockStore((s) => s.startSetup);
  const retrySetup = useEvidenceLibraryMockStore((s) => s.retrySetup);

  if (!library) return <LibraryNotFound />;

  const failed = library.status === "setup_failed";
  const done = library.status === "active";
  const base = `/evidence-libraries/${library.id}`;
  const doneSteps = doneStepCount(library);
  const percent = Math.round((Math.min(doneSteps, TOTAL_STEPS) / TOTAL_STEPS) * 100);
  const currentStep =
    library.steps.find((s) => s.status === "running" || s.status === "failed")?.key ?? "active";

  function retry() {
    if (!library) return;
    toast(t("retryingTitle"), { description: t("retryingDescription") });
    retrySetup(library.id);
  }

  return (
    <div className="container mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex justify-end">
        <PrototypeBadge />
      </div>
      <CommandCenterContainer>
        <PanelHeader
          icon={Rocket}
          title={library.name}
          description={t("headerDescription", { address: library.address })}
        >
          <LibraryStatusBadge library={library} />
        </PanelHeader>

        <div className="max-w-2xl space-y-4 p-4 md:p-6">
          <SectionCard
            role={failed ? "alert" : "status"}
            aria-live="polite"
            data-setup-status={library.status}
            icon={done ? Check : failed ? X : Rocket}
            tone={failed ? "danger" : "default"}
            title={done ? t("titleReady") : failed ? t("titleFailed") : t("titleRunning")}
            description={
              done
                ? t("descReady")
                : failed
                  ? t("descFailed")
                  : t("descRunning", { step: Math.min(doneSteps + 1, TOTAL_STEPS) })
            }
          >
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {t(`steps.${currentStep}.name`)}
                </span>
                <span className="font-medium text-foreground tabular-nums">{percent}%</span>
              </div>
              <Progress
                value={percent}
                aria-label={t("titleRunning")}
                className={cn(
                  failed && "bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive",
                  done && "bg-emerald-500/20 [&>[data-slot=progress-indicator]]:bg-emerald-500",
                )}
              />
            </div>

            <ol className="space-y-2">
              {library.steps.map((step) => (
                <StepRow key={step.key} step={step} onRetry={retry} />
              ))}
            </ol>
          </SectionCard>

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {done ? (
              <>
                <Button asChild variant="outline">
                  <Link href={`${base}/configuration`}>
                    <Settings />
                    {t("configure")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={`${base}/admin`}>
                    <ExternalLink />
                    {t("openAdmin")}
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link href="/evidence-libraries">
                    <ArrowLeft />
                    {t("backToLibraries")}
                  </Link>
                </Button>
                {library.status === "draft" ? (
                  <Button onClick={() => startSetup(library.id)}>
                    <Play />
                    {t("startSetup")}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </CommandCenterContainer>
    </div>
  );
}

function StepRow({ step, onRetry }: { step: SetupStep; onRetry: () => void }) {
  const t = useTranslations("evidenceLibraryMock.setup");
  const Icon = STEP_ICONS[step.key];
  const line =
    step.status === "failed"
      ? t("deploymentError")
      : step.status === "running"
        ? t(`steps.${step.key}.running`)
        : step.status === "done"
          ? t(`steps.${step.key}.done`)
          : t(`steps.${step.key}.waiting`);

  return (
    <li
      data-step={step.key}
      data-state={step.status}
      className={cn(
        "rounded-xl border border-border/50 bg-background p-3 transition-colors",
        step.status === "running" && "border-l-[4px] border-l-primary bg-primary/5",
        step.status === "failed" && "border-destructive/30",
        step.status === "waiting" && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            step.status === "done" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            step.status === "running" && "bg-primary/10 text-primary",
            step.status === "failed" && "bg-destructive/10 text-destructive",
            step.status === "waiting" && "bg-muted/50 text-muted-foreground",
          )}
        >
          {step.status === "done" ? (
            <Check className="size-4" />
          ) : step.status === "running" ? (
            <Spinner className="size-4" />
          ) : step.status === "failed" ? (
            <X className="size-4" />
          ) : (
            <Icon className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{t(`steps.${step.key}.name`)}</span>
            {step.status === "running" ? (
              <StatusChip tone="running">{t("running")}</StatusChip>
            ) : null}
            {step.status === "failed" ? (
              <StatusChip tone="danger">{t("failed")}</StatusChip>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{line}</p>
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">{step.at}</span>
      </div>
      {step.status === "failed" ? (
        <InlineNotice
          tone="danger"
          title={t("stoppedHere")}
          className="mt-3"
          action={
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onRetry}>
              <RefreshCw />
              {t("retryFromStep")}
            </Button>
          }
        >
          {t("stoppedHint")}
        </InlineNotice>
      ) : null}
    </li>
  );
}
