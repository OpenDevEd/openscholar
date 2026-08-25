"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Small tag so everyone can see this screen runs on fake data. */
export function PrototypeBadge({
  variant = "prototype",
  className,
}: {
  variant?: "prototype" | "mock";
  className?: string;
}) {
  const t = useTranslations("evidenceLibraryMock");
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border border-dashed border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary",
        className,
      )}
      data-prototype-badge={variant}
    >
      {variant === "mock" ? t("mockBadge") : t("prototypeBadge")}
    </span>
  );
}
