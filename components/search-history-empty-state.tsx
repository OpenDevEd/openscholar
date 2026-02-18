"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { History } from "lucide-react";

export function SearchHistoryEmptyState() {
  const t = useTranslations();

  return (
    <div className="text-center py-12">
      <div className="flex justify-center mb-4">
        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-600/10 flex items-center justify-center">
          <History className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {t("emptyStates.noSearchHistory")}
      </h3>
      <p className="text-muted-foreground text-sm max-w-md mx-auto">
        {t("emptyStates.startSearching")}
      </p>
    </div>
  );
}
