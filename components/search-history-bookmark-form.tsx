"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { BookmarkPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { useKeywordExpansionStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface SearchHistoryBookmarkFormProps {
  query: string;
  onSubmit: (bookmarkName: string) => void;
  onCancel: () => void;
  variant?: "full" | "compact";
}

/**
 * Bookmark form for saving search history queries as bookmarks.
 * Extracted from SearchHistory to avoid component-in-component pattern.
 */
export function SearchHistoryBookmarkForm({
  query,
  onSubmit,
  onCancel,
  variant = "full",
}: SearchHistoryBookmarkFormProps) {
  const [localBookmarkName, setLocalBookmarkName] = useState("");
  const { addKeyword, keywords } = useKeywordExpansionStore();
  const toast = useAppToast();
  const t = useTranslations();
  const tToast = useTranslations("toast");

  const validateKeyword = (keyword: string): string | null => {
    if (!keyword.trim()) return t("validation.bookmarkNameRequired");
    if (!/^[a-zA-Z0-9-]+$/.test(keyword.trim()))
      return t("validation.bookmarkNameFormat");
    if (keyword.includes(" ")) return t("validation.bookmarkNameNoSpaces");
    if (keywords[keyword]) return t("validation.bookmarkNameExists", { name: keyword });
    return null;
  };

  const handleSubmit = () => {
    const validationError = validateKeyword(localBookmarkName);
    if (validationError) {
      toast.validation.failed(validationError);
      return;
    }

    const { expandedQuery } = validateAndExpandKeywordsSilently(query);
    addKeyword(localBookmarkName.trim(), expandedQuery);
    onSubmit(localBookmarkName);
    setLocalBookmarkName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div
      className={cn(
        "space-y-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded",
        variant === "full" ? "space-y-3 p-3 rounded-lg" : "p-2"
      )}
    >
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
        <BookmarkPlus className={cn(variant === "full" ? "h-4 w-4" : "h-3 w-3")} />
        <span
          className={cn(
            "font-medium",
            variant === "full" ? "text-sm" : "text-xs"
          )}
        >
          {variant === "full"
            ? t("common.saveAsBookmark")
            : t("bookmarksPage.saveQueryAsBookmark")}
        </span>
      </div>

      {variant === "full" && (
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          {t("bookmarksPage.useBookmarkFormat")}
        </p>
      )}

      <div
        className={cn(
          "text-amber-700 dark:text-amber-300 font-mono break-all border border-amber-200 dark:border-amber-700 rounded",
          variant === "full"
            ? "text-xs bg-amber-100 dark:bg-amber-900/50 p-2"
            : "text-xs p-1.5 bg-background"
        )}
      >
        &quot;{validateAndExpandKeywordsSilently(query).expandedQuery}&quot;
      </div>

      <div className={cn(variant === "full" ? "space-y-2" : "space-y-1")}>
        <Input
          placeholder={t("bookmarksPage.enterBookmarkName")}
          value={localBookmarkName}
          onChange={(e) => setLocalBookmarkName(e.target.value)}
          className={cn(
            "bg-background border-amber-200 dark:border-amber-800 focus:border-amber-400 dark:focus:border-amber-600",
            variant === "full" ? "text-sm" : "text-xs h-7"
          )}
          onKeyDown={handleKeyDown}
          aria-label={t("bookmarksPage.enterBookmarkName")}
        />
        <p
          className={cn(
            "text-amber-600 dark:text-amber-400",
            variant === "full" ? "text-xs" : "text-xs"
          )}
        >
          {t("bookmarksPage.lettersNumbersDashes")}
        </p>
        <div className={cn(variant === "full" ? "flex gap-2" : "flex gap-1")}>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!localBookmarkName.trim()}
            className={cn(
              "bg-amber-600 hover:bg-amber-700 text-white",
              variant === "compact" && "h-6 text-xs px-2"
            )}
          >
            <Check
              className={cn(
                "mr-1",
                variant === "full" ? "h-3 w-3" : "h-2 w-2"
              )}
            />
            {t("common.save")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className={cn(
              "text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50",
              variant === "compact" && "h-6 text-xs px-2"
            )}
          >
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
