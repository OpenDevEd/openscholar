"use client";

import { Check, ExternalLink, Layers, Play, RefreshCw, Settings, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { doneStepCount, type SetupStep } from "@/lib/evidence-libraries/mock/data";
import { selectLibrary, useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { FieldGroup } from "./config/fields";
import { LibraryNotFound } from "./library-not-found";
import { LIBRARY_TONE, StatusChip } from "./library-status-badge";
import { PanelHeader } from "./panel-header";
import { InlineNotice } from "./section-card";

/** The five build steps; the sixth row ("Live") is the result. */
const BUILD_STEPS = 5;

export function SetupProgress({ libraryId }: { libraryId: string }) {
  const t = useTranslations("evidenceLibraryMock.setup");
  const tm = useTranslations("evidenceLibraryMock");
  const library = useEvidenceLibraryMockStore(selectLibrary(libraryId));
  const startSetup = useEvidenceLibraryMockStore((s) => s.startSetup);
  const retrySetup = useEvidenceLibraryMockStore((s) => s.retrySetup);

  if (!library) return <LibraryNotFound />;

  const failed = library.status === "setup_failed";
  const active = library.status === "active";
  const base = `/evidence-libraries/${library.id}`;
  const address = `https://${library.address}`;
  const percent = active ? 100 : Math.round((doneStepCount(library) / BUILD_STEPS) * 100);
  const currentStep =
    library.steps.find((s) => s.status === "running" || s.status === "failed")?.key ?? "active";

  function retry() {
    if (!library) return;
    toast(t("retryingTitle"), { description: t("retryingDescription") });
    retrySetup(library.id);
  }

  return (
    <div className="w-full pb-16">
      <div className="sticky top-14 z-20 border-b border-border/40 bg-background lg:top-0">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6">
          <PanelHeader
            icon={Layers}
            className="border-b-0 px-0 md:px-0"
            title={library.name}
            eyebrow={address}
            backHref="/evidence-libraries"
            backLabel={t("backToLibraries")}
            titleAside={
              <StatusChip tone={LIBRARY_TONE[library.status]} data-status={library.status}>
                {tm(`status.${library.status}`)}
              </StatusChip>
            }
          >
            {library.status === "draft" ? (
              <Button onClick={() => startSetup(library.id)}>
                <Play />
                {t("startSetup")}
              </Button>
            ) : null}
            {failed ? (
              <Button onClick={retry} data-retry>
                <RefreshCw />
                {t("retry")}
              </Button>
            ) : null}
            {active ? (
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
            ) : null}
          </PanelHeader>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer>
          <div
            className="space-y-4 p-4 md:p-6"
            role={failed ? "alert" : "status"}
            aria-live="polite"
            data-setup-status={library.status}
          >
            <FieldGroup title={t("groupTitle")}>
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">{t(`steps.${currentStep}.name`)}</span>
                    <span className="tabular-nums">{percent}%</span>
                  </div>
                  <Progress
                    value={percent}
                    aria-label={t("groupTitle")}
                    className={cn(
                      failed && "bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive",
                      active && "bg-emerald-500/20 [&>[data-slot=progress-indicator]]:bg-emerald-500",
                    )}
                  />
                </div>

                <ol className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-background">
                  {library.steps.map((step) => (
                    <StepRow key={step.key} step={step} onRetry={retry} />
                  ))}
                </ol>

                {active ? (
                  <InlineNotice
                    tone="info"
                    action={
                      <Button asChild size="sm" variant="outline" className="h-7">
                        <a href={address} target="_blank" rel="noopener noreferrer">
                          <ExternalLink />
                          {t("openLibrary")}
                        </a>
                      </Button>
                    }
                  >
                    {t("liveAt", { address })}
                  </InlineNotice>
                ) : null}
              </div>
            </FieldGroup>
          </div>
        </CommandCenterContainer>
      </div>
    </div>
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

function StepRow({ step, onRetry }: { step: SetupStep; onRetry: () => void }) {
  const t = useTranslations("evidenceLibraryMock.setup");
  const line =
    step.status === "failed"
      ? t("deploymentError")
      : step.status === "running"
        ? t(`steps.${step.key}.running`)
        : step.status === "done"
          ? t(`steps.${step.key}.done`)
          : t(`steps.${step.key}.waiting`);

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
          <span className="text-xs font-mono text-muted-foreground tabular-nums">{step.at}</span>
        ) : null}
      </div>
      {step.status === "failed" ? (
        <InlineNotice
          tone="danger"
          action={
            <Button size="sm" variant="outline" className="h-7" onClick={onRetry}>
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
