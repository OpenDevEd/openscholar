"use client";

// The models a job will run on, as AI settings set them (#689). Shown where a screening or an
// extraction is set up, and changed only in AI settings, so there's one place that changes them.

import { useTranslations } from "next-intl";
import { ChevronRight } from "@/components/icons";
import { NodeCard, type MapModel } from "@/components/settings/model-map";
import { Zone } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import Link from "@/components/workspace-link";
import { cn } from "@/lib/utils";

/** Each model with what it answers, side by side, under a link to AI settings. */
export function ModelsInUse({ label, uses }: { label: string; uses: Array<{ label: string; model: MapModel }> }) {
  const t = useTranslations("models");
  return (
    <Zone
      label={label}
      aside={
        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
          <Link href="/settings/ai">
            {t("changeInSettings")}
            <ChevronRight />
          </Link>
        </Button>
      }
    >
      <div className={cn("grid gap-3", uses.length > 1 && "sm:grid-cols-2")}>
        {uses.map((use) => (
          <div key={use.label} className="space-y-1.5">
            <p className="px-1 text-xs text-muted-foreground">{use.label}</p>
            {/* It only shows the model: AI settings change it. */}
            <NodeCard paidBy="credits" model={use.model} tabIndex={-1} />
          </div>
        ))}
      </div>
    </Zone>
  );
}
