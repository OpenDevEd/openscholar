"use client";

import {
  AlertTriangle,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
import { LibraryStatusBadge } from "./library-status-badge";
import { PrototypeBadge } from "./prototype-badge";

const STEP_ICONS: Record<SetupStepKey, LucideIcon> = {
  database: Database,
  storage: HardDrive,
  application: Box,
  deployment: Rocket,
  readiness: HeartPulse,
  active: Check,
};

export function SetupProgress({ libraryId }: { libraryId: string }) {
  const t = useTranslations("evidenceLibraryMock.setup");
  const library = useEvidenceLibraryMockStore(selectLibrary(libraryId));
  const startSetup = useEvidenceLibraryMockStore((s) => s.startSetup);
  const retrySetup = useEvidenceLibraryMockStore((s) => s.retrySetup);

  if (!library) return <LibraryNotFound />;

  const failed = library.status === "setup_failed";
  const done = library.status === "active";
  const base = `/evidence-libraries/${library.id}`;

  function retry() {
    if (!library) return;
    toast(t("retryingTitle"), { description: t("retryingDescription") });
    retrySetup(library.id);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-4 flex justify-end">
        <PrototypeBadge />
      </div>
      <PageHeader
        title={library.name}
        description={t("headerDescription", { address: library.address })}
        icon={Rocket}
      />
      <Card
        role={failed ? "alert" : "status"}
        aria-live="polite"
        data-setup-status={library.status}
      >
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {done ? t("titleReady") : failed ? t("titleFailed") : t("titleRunning")}
            </CardTitle>
            <LibraryStatusBadge library={library} />
          </div>
          <CardDescription>
            {done
              ? t("descReady")
              : failed
                ? t("descFailed")
                : t("descRunning", { step: Math.min(doneStepCount(library) + 1, 5) })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="relative space-y-1 border-l border-border/70 pl-0">
            {library.steps.map((step) => (
              <StepRow key={step.key} step={step} onRetry={retry} />
            ))}
          </ol>
        </CardContent>
        <CardFooter className="justify-end gap-2">
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
        </CardFooter>
      </Card>
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
        "relative -ml-px grid grid-cols-[auto_1fr_auto] items-start gap-x-3 py-3 pl-4",
        step.status === "waiting" && "opacity-60",
      )}
    >
      <span
        className={cn(
          "absolute -left-3 top-3.5 flex size-6 items-center justify-center rounded-full border bg-background",
          step.status === "done" && "border-emerald-600 bg-emerald-600 text-white",
          step.status === "running" && "border-primary text-primary",
          step.status === "failed" && "border-destructive bg-destructive text-white",
        )}
      >
        {step.status === "done" ? (
          <Check className="size-3.5" />
        ) : step.status === "running" ? (
          <Spinner className="size-3.5" />
        ) : step.status === "failed" ? (
          <X className="size-3.5" />
        ) : (
          <Icon className="size-3.5 text-muted-foreground" />
        )}
      </span>
      <span className="w-2" aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {t(`steps.${step.key}.name`)}
          {step.status === "running" ? (
            <Badge variant="secondary" className="bg-primary/15 text-primary">
              {t("running")}
            </Badge>
          ) : null}
          {step.status === "failed" ? (
            <Badge variant="destructive">{t("failed")}</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{line}</p>
        {step.status === "failed" ? (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle />
            <AlertTitle>{t("stoppedHere")}</AlertTitle>
            <AlertDescription>
              <p>{t("stoppedHint")}</p>
              <Button size="sm" className="mt-2" onClick={onRetry}>
                <RefreshCw />
                {t("retryFromStep")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
      <span className="font-mono text-xs text-muted-foreground">{step.at}</span>
    </li>
  );
}
