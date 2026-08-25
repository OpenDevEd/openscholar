"use client";

import { AlertTriangle, Check, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  doneStepCount,
  type LibraryStatus,
  type MockLibrary,
} from "@/lib/evidence-libraries/mock/data";

const STATUS_CLASS: Record<LibraryStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  setting_up: "bg-primary/15 text-primary",
  active: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  setup_failed: "bg-destructive/15 text-destructive",
  deleting: "bg-destructive/15 text-destructive",
};

function StatusIcon({ status }: { status: LibraryStatus }) {
  if (status === "setting_up" || status === "deleting") return <Spinner />;
  if (status === "active") return <Check />;
  if (status === "setup_failed") return <AlertTriangle />;
  return <GitBranch />;
}

export function LibraryStatusBadge({ library }: { library: MockLibrary }) {
  const t = useTranslations("evidenceLibraryMock");
  return (
    <Badge
      variant="secondary"
      data-status={library.status}
      className={cn("gap-1.5", STATUS_CLASS[library.status])}
    >
      <StatusIcon status={library.status} />
      {t(`status.${library.status}`)}
      {library.status === "setting_up" ? (
        <span className="font-mono text-[11px] opacity-80">
          {t("stepsOfFive", { done: doneStepCount(library) })}
        </span>
      ) : null}
    </Badge>
  );
}
