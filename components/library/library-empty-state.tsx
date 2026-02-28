"use client";

import { useTranslations } from "next-intl";
import { Library, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface LibraryEmptyStateProps {
  variant: "empty-library" | "no-results";
  onClearFilters?: () => void;
}

export function LibraryEmptyState({
  variant,
  onClearFilters,
}: LibraryEmptyStateProps) {
  const t = useTranslations("libraryPage");

  if (variant === "empty-library") {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Library className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-1.5">
          {t("emptyLibraryTitle")}
        </h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          {t("emptyLibraryDescription")}
        </p>
        <Button asChild>
          <Link href="/">{t("emptyLibraryCta")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="rounded-full bg-muted p-3 mb-3">
        <SearchX className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t("noResultsTitle")}
      </p>
      {onClearFilters && (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          {t("clearFilters")}
        </Button>
      )}
    </div>
  );
}
