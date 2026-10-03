"use client";

import { Check, Copy, ExternalLink, RefreshCw, X , CircleDashed } from "@/components/icons";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { SetupStep } from "@/lib/evidence-libraries/setup/steps";
import { cn } from "@/lib/utils";

const BURST = Array.from({ length: 12 }, (_, i) => ({
  angle: i * 30,
  delay: (i % 4) * 40,
  primary: i % 3 === 0,
}));

export type SetupHeroStatus = "setting_up" | "setup_failed" | "active";

/**
 * The setup page as one surface in three states. Building: the mark spins,
 * the aurora is the app's orange, the receipt line ticks along. Stopped: red
 * mark, the saved error, Retry. Live: the check lands with a burst, the
 * address becomes the headline.
 */
export function SetupHero({
  status,
  name,
  address,
  steps,
  percent,
  currentStep,
  errorMessage,
  errorReasons,
  onRetry,
  retrying,
}: {
  status: SetupHeroStatus;
  name: string;
  address: string;
  steps: SetupStep[];
  percent: number;
  currentStep: SetupStep;
  errorMessage?: string;
  // What exactly stopped the setup, in the owner's words. Shown under the
  // headline message, which is often the general "could not be assembled".
  errorReasons?: readonly string[];
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations("evidenceLibraries.setup");
  const tl = useTranslations("evidenceLibraries.setup.live");
  const format = useFormatter();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const host = address.replace(/^https?:\/\//, "");
  const live = status === "active";
  const failed = status === "setup_failed";

  async function copyAddress() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(address);
    } catch {
      toast.error(tl("copyFailed"), { description: address });
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section
      data-live-hero
      data-state={status}
      aria-labelledby="library-live-title"
      className="el-hero relative overflow-hidden"
    >
      {/* Aurora backdrop: tinted by state, blurred and drifting. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="el-hero-blob el-hero-blob-a absolute -left-48 -top-56 size-[40rem] rounded-full" />
        <span className="el-hero-blob el-hero-blob-b absolute -right-48 -top-48 size-[36rem] rounded-full" />
        <span className="el-hero-blob el-hero-blob-c absolute -bottom-64 left-1/4 size-[40rem] rounded-full" />
        {live ? <span className="el-hero-sweep absolute inset-0" /> : null}
      </div>

      <div className="relative flex flex-col items-center gap-6 px-6 pb-8 pt-16 text-center sm:pt-20">
        <span className="relative flex size-16 items-center justify-center">
          {live
            ? BURST.map(({ angle, delay, primary }) => (
                <span
                  key={angle}
                  aria-hidden
                  style={{ ["--a" as string]: `${angle}deg`, animationDelay: `${520 + delay}ms` }}
                  className={cn(
                    "el-burst-dot absolute left-1/2 top-1/2 size-1.5 rounded-full",
                    primary ? "bg-primary" : "bg-success",
                  )}
                />
              ))
            : null}
          <Mark status={status} />
        </span>

        <div className="el-hero-rise space-y-2" style={{ animationDelay: live ? "560ms" : "0ms" }}>
          <h2 id="library-live-title" className="text-2xl font-semibold tracking-tight">
            {live ? tl("title", { name }) : failed ? tl("stopped") : tl("settingUp", { name })}
          </h2>
          <p className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}>
            {live
              ? tl("hint")
              : failed
                ? (errorMessage ?? t("deploymentError"))
                : t(`steps.${currentStep.key}.running`)}
          </p>
          {failed && errorReasons && errorReasons.length > 0 ? (
            <ul className="space-y-1 text-sm text-destructive">
              {errorReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {live ? (
          <div className="el-hero-rise flex flex-wrap items-center justify-center gap-2" style={{ animationDelay: "680ms" }}>
            <button
              type="button"
              onClick={copyAddress}
              data-copied={copied}
              aria-label={copied ? tl("copiedShort") : tl("copyAddress")}
              className="inline-flex h-10 max-w-full items-center gap-2 rounded-full border border-border-subtle bg-card px-4 font-mono text-sm shadow-xs backdrop-blur transition-colors hover:border-success/50 hover:bg-background"
            >
              <span className="truncate">{host}</span>
              {copied ? (
                <Check className="size-4 shrink-0 ink-success" aria-hidden />
              ) : (
                <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </button>
            <Button asChild size="lg" className="rounded-full">
              <a href={address} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                {tl("openLibrary")}
              </a>
            </Button>
          </div>
        ) : failed ? (
          <div className="el-hero-rise flex flex-col items-center gap-3">
            <Button size="lg" className="rounded-full" onClick={onRetry} disabled={retrying} data-retry>
              {retrying ? <Spinner role="presentation" aria-label={undefined} className="motion-reduce:animate-none" /> : <RefreshCw />}
              {t("retry")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("stoppedHint")}</p>
          </div>
        ) : (
          <div className="el-hero-rise flex w-full max-w-xs flex-col items-center gap-2">
            <Progress value={percent} aria-label={t("groupTitle")} className="h-1.5" />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{percent}%</span>
          </div>
        )}

        <ol
          className={cn(
            "el-hero-rise mt-4 flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t pt-4",
            live ? "border-success/15" : failed ? "border-destructive/15" : "border-primary/15",
          )}
          style={{ animationDelay: live ? "820ms" : "0ms" }}
        >
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            return (
              <li
                key={step.key}
                data-step={step.key}
                data-state={step.status}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs",
                  step.status === "waiting" && "text-muted-foreground",
                )}
              >
                <StepMark status={step.status} emphasis={isLast && live} />
                <span className={cn(isLast && live ? "font-semibold" : "font-medium")}>
                  {t(`steps.${step.key}.name`)}
                </span>
                {step.at ? (
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {format.dateTime(new Date(step.at), { timeStyle: "short" })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Mark({ status }: { status: SetupHeroStatus }) {
  if (status === "active") {
    return (
      <span className="el-hero-check flex size-16 items-center justify-center rounded-full bg-success text-success-foreground shadow-lg shadow-success/40 ring-8 ring-success/10">
        <Check className="size-8" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (status === "setup_failed") {
    return (
      <span className="flex size-16 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30 ring-8 ring-destructive/10">
        <X className="size-8" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  return (
    <span className="relative flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary ring-8 ring-primary/5">
      <span aria-hidden className="el-hero-orbit absolute inset-0 rounded-full border-2 border-transparent border-t-primary" />
      <Spinner role="presentation" aria-label={undefined} className="size-7 motion-reduce:animate-none" />
    </span>
  );
}

function StepMark({ status, emphasis }: { status: SetupStep["status"]; emphasis: boolean }) {
  if (status === "done") {
    return (
      <Check
        className={cn("size-3.5", emphasis ? "text-success" : "text-solid-success/70")}
        strokeWidth={3}
        aria-hidden
      />
    );
  }
  if (status === "running") {
    return <Spinner role="presentation" aria-label={undefined} className="size-3.5 text-primary motion-reduce:animate-none" />;
  }
  if (status === "failed") return <X className="size-3.5 text-destructive" strokeWidth={3} aria-hidden />;
  return <CircleDashed aria-hidden className="size-3.5 text-muted-foreground" />;
}
