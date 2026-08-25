"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const setupStepMessageKeys = {
  database: "status.steps.database",
  storage: "status.steps.storage",
  application: "status.steps.application",
  deployment: "status.steps.deployment",
  health_check: "status.steps.healthCheck",
} as const;

type SetupStep = keyof typeof setupStepMessageKeys;
type SetupOperation = Pick<
  Doc<"evidenceLibraryConfigOperations">,
  "_id" | "error" | "stage" | "status"
>;

function requireSetupStep(stage: string): SetupStep {
  if (stage in setupStepMessageKeys) return stage as SetupStep;
  throw new Error(`Saved setup operation has an invalid step: ${stage}`);
}

export function EvidenceLibrarySetupStatus({
  libraryId,
  operation,
}: {
  libraryId: Id<"evidenceLibraries">;
  operation: SetupOperation;
}) {
  const t = useTranslations("evidenceLibrarySetup");
  const tAdmin = useTranslations("evidenceLibraryAdminLaunch");
  const retrySetup = useMutation(api.evidenceLibraries.mutations.retrySetup);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (operation.status === "queued") return null;

  if (operation.status === "succeeded") {
    return (
      <Card
        role="status"
        aria-labelledby="evidence-library-setup-ready-title"
        aria-describedby="evidence-library-setup-ready-description"
        data-setup-status="ready"
      >
        <CardHeader>
          <CardTitle id="evidence-library-setup-ready-title">
            {t("status.readyTitle")}
          </CardTitle>
          <CardDescription id="evidence-library-setup-ready-description">
            {t("status.readyDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-end border-t">
          <Button asChild>
            <Link href={`/evidence-libraries/${libraryId}/admin`}>
              {tAdmin("openAdmin")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const step = requireSetupStep(operation.stage);
  const stepText = t(setupStepMessageKeys[step]);

  if (operation.status === "running") {
    return (
      <Card
        role="status"
        aria-live="polite"
        aria-labelledby="evidence-library-setup-running-title"
        aria-describedby="evidence-library-setup-running-step"
        data-setup-status="running"
        data-setup-step={step}
      >
        <CardHeader>
          <CardTitle id="evidence-library-setup-running-title">
            {t("status.settingUpTitle")}
          </CardTitle>
          <CardDescription>{t("status.currentStepLabel")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p id="evidence-library-setup-running-step">{stepText}</p>
        </CardContent>
      </Card>
    );
  }

  if (!operation.error || operation.error.stage !== step) {
    throw new Error("Saved failed setup operation has an invalid error");
  }

  function handleRetry() {
    if (isRetrying) return;
    setIsRetrying(true);
    setRetryError(null);
    void retrySetup({ libraryId })
      .catch(() => setRetryError(t("status.retryError")))
      .finally(() => setIsRetrying(false));
  }

  return (
    <Card
      role="alert"
      aria-labelledby="evidence-library-setup-failed-title"
      aria-describedby="evidence-library-setup-failed-step evidence-library-setup-failed-error"
      aria-busy={isRetrying}
      data-setup-status="failed"
      data-setup-step={step}
    >
      <CardHeader>
        <CardTitle id="evidence-library-setup-failed-title">
          {t("status.failedTitle")}
        </CardTitle>
        <CardDescription>{t("status.failedStepLabel")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p id="evidence-library-setup-failed-step">{stepText}</p>
        <p id="evidence-library-setup-failed-error">
          {operation.error.message}
        </p>
        {retryError ? (
          <p className="text-sm text-destructive">{retryError}</p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end border-t">
        <Button type="button" onClick={handleRetry} disabled={isRetrying}>
          {isRetrying ? t("status.retrying") : t("status.retry")}
        </Button>
      </CardFooter>
    </Card>
  );
}
