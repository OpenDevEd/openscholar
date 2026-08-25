"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

/** Small tag so everyone can see this screen runs on fake data. */
export function PrototypeBadge({ variant = "prototype" }: { variant?: "prototype" | "mock" }) {
  const t = useTranslations("evidenceLibraryMock");
  return (
    <Badge
      variant="outline"
      className="border-dashed border-primary/50 text-primary"
      data-prototype-badge={variant}
    >
      {variant === "mock" ? t("mockBadge") : t("prototypeBadge")}
    </Badge>
  );
}
