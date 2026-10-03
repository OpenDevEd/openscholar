"use client";

import Link from "next/link";
import { Library, SearchX } from "@/components/icons";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";

interface LibraryEmptyStateProps {
  variant: "empty-library" | "no-results";
  onClearFilters?: () => void;
}

export function LibraryEmptyState({
  variant,
  onClearFilters,
}: LibraryEmptyStateProps) {
  const t = useTranslations("libraryPage");
  const tc = useTranslations("common");
  const isEmptyLibrary = variant === "empty-library";
  const Icon = isEmptyLibrary ? Library : SearchX;

  return (
    <CommandCenterContainer>
      <div className="relative flex flex-col items-center justify-center px-6 py-14 text-center sm:px-10">
        <div className="mb-5 rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm">
          <Icon className="h-7 w-7 text-muted-foreground" />
        </div>

        <h2 className="text-xl font-semibold tracking-tight">
          {isEmptyLibrary ? t("emptyLibraryTitle") : t("noResultsTitle")}
        </h2>

        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {isEmptyLibrary
            ? t("emptyLibraryDescription")
            : tc("tryAdjustingSearch")}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {isEmptyLibrary ? (
            <Button asChild className="rounded-xl">
              <Link href="/">{t("emptyLibraryCta")}</Link>
            </Button>
          ) : (
            onClearFilters && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClearFilters}
                className="rounded-xl"
              >
                {t("clearFilters")}
              </Button>
            )
          )}
        </div>
      </div>
    </CommandCenterContainer>
  );
}
