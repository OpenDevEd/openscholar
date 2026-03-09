"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ScreeningStatus =
  | "pending"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed"
  | "creditsExhausted";

function getStatusBadgeVariant(
  status: ScreeningStatus
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "pending":
    case "processing":
      return "default";
    case "completed":
      return "secondary";
    case "cancelled":
      return "outline";
    case "failed":
    case "creditsExhausted":
      return "destructive";
  }
}

interface ScreeningProgressProps {
  jobId: Id<"screeningJobs">;
}

export function ScreeningProgress({ jobId }: ScreeningProgressProps) {
  const t = useTranslations("screeningDialog");
  const progress = useQuery(api.screening.queries.getScreeningProgress, {
    jobId,
  });

  if (progress === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("progressTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-2 rounded-full bg-muted" />
            <div className="h-4 w-48 rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (progress === null) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("progressTitle")}</CardTitle>
          <Badge variant={getStatusBadgeVariant(progress.status)}>
            {t(`jobStatus.${progress.status}`)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={progress.percentComplete} />
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t("progressStatus", {
              processed: progress.processedPapers,
              total: progress.totalPapers,
            })}
          </span>
          <span>
            {t("progressQualified", {
              count: progress.qualifiedPapers,
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
