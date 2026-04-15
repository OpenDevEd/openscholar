"use client";

import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";

export function BasketEmptyState() {
  const t = useTranslations("extraction.basket");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
      <FlaskConical className="size-12 text-muted-foreground/40" />
      <p className="text-sm font-semibold text-foreground">
        {t("emptyHeading")}
      </p>
      <p className="max-w-[240px] text-center text-xs text-muted-foreground">
        {t("emptyBody")}
      </p>
    </div>
  );
}
