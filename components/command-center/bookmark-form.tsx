"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { BookmarkPlus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";

interface BookmarkFormProps {
  variant: "inline" | "overlay";
  bookmarkName: string;
  onNameChange: (name: string) => void;
  query: string;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * Shared bookmark form component for saving queries as bookmarks.
 * Supports inline and overlay variants.
 */
export function BookmarkForm({
  variant,
  bookmarkName,
  onNameChange,
  query,
  onSubmit,
  onCancel,
}: BookmarkFormProps) {
  const tb = useTranslations("bookmarksPage");
  const tc = useTranslations("common");
  const { expandedQuery } = validateAndExpandKeywordsSilently(query);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onSubmit();
    if (e.key === "Escape") onCancel();
  };

  if (variant === "overlay") {
    return (
      <div className="absolute inset-0 bg-background/95 backdrop-blur-sm flex flex-col p-3 z-10 overflow-y-auto">
        <div className="flex-1 flex flex-col space-y-2.5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-600">
              <BookmarkPlus className="h-4 w-4" />
              <span className="text-sm font-medium">{tc("saveAsBookmark")}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={onCancel}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Explanation */}
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
            {tb("useBookmarkFormat")}
          </p>

          {/* Expanded query preview */}
          <div className="text-xs text-amber-700 dark:text-amber-300 font-mono break-all p-2 rounded border border-amber-200 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/50 max-h-20 overflow-y-auto">
            &quot;{expandedQuery}&quot;
          </div>

          {/* Input */}
          <Input
            placeholder={tb("enterBookmarkName")}
            value={bookmarkName}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="text-sm h-8 bg-background border-amber-200 dark:border-amber-800 focus:border-amber-400"
          />

          {/* Validation hint */}
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {tb("lettersNumbersDashes")}
          </p>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!bookmarkName.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Check className="h-3 w-3 mr-1" />
              {tc("save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              className="text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
            >
              {tc("cancel")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Inline variant
  return (
    <div className="space-y-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
        <BookmarkPlus className="h-4 w-4" />
        <span className="text-sm font-medium">{tc("saveAsBookmark")}</span>
      </div>

      <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
        {tb("useBookmarkFormat")}
      </p>

      <div className="text-xs text-amber-700 dark:text-amber-300 font-mono break-all p-2 rounded border border-amber-200 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/50">
        &quot;{expandedQuery}&quot;
      </div>

      <Input
        placeholder={tb("enterBookmarkName")}
        value={bookmarkName}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        className="text-sm bg-background border-amber-200 dark:border-amber-800 focus:border-amber-400"
      />

      <p className="text-xs text-amber-600 dark:text-amber-400">
        {tb("lettersNumbersDashes")}
      </p>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={!bookmarkName.trim()}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Check className="h-3 w-3 mr-1" />
          {tc("save")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
        >
          {tc("cancel")}
        </Button>
      </div>
    </div>
  );
}
