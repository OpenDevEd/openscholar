"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SearchHistoryHeaderSectionProps {
  title: string;
  count: number;
  variant?: "compact" | "full";
}

export function SearchHistoryHeaderSection({
  title,
  count,
  variant = "compact",
}: SearchHistoryHeaderSectionProps) {
  const t = useTranslations();

  return (
    <div className="flex items-center gap-2">
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
        <Clock className="h-4 w-4 text-white" />
      </div>
      {variant === "compact" ? (
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      ) : (
        <CardTitle className="text-xl">{title}</CardTitle>
      )}
      <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded-full">
        {count}
        {variant === "full" ? ` ${t("commandCenter.searchPlural")}` : ""}
      </span>
    </div>
  );
}
