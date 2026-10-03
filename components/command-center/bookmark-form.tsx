"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { BookmarkPlus, Check, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation-browser";

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
      <div className="absolute inset-0 z-10 flex flex-col overflow-y-auto bg-background/98 p-3">
        <div className="flex-1 flex flex-col gap-2.5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 ink-warning">
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
          <p className="text-xs ink-warning leading-relaxed">
            {tb("useBookmarkFormat")}
          </p>

          {/* Expanded query preview */}
          <div className="text-xs ink-warning font-mono break-all p-2 rounded border border-warning/30 bg-warning/15 max-h-20 overflow-y-auto">
            &quot;{expandedQuery}&quot;
          </div>

          {/* Input */}
          <Input
            placeholder={tb("enterBookmarkName")}
            value={bookmarkName}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="text-sm h-8 bg-background border-warning/30 focus:border-warning"
          />

          {/* Validation hint */}
          <p className="text-xs ink-warning">
            {tb("lettersNumbersDashes")}
          </p>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!bookmarkName.trim()}
              className="bg-warning hover:bg-warning/90 text-warning-foreground"
            >
              <Check className="h-3 w-3 mr-1" />
              {tc("save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              className="ink-warning hover:bg-warning/15"
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
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30">
      <div className="flex items-center gap-2 ink-warning">
        <BookmarkPlus className="h-4 w-4" />
        <span className="text-sm font-medium">{tc("saveAsBookmark")}</span>
      </div>

      <p className="text-xs ink-warning leading-relaxed">
        {tb("useBookmarkFormat")}
      </p>

      <div className="text-xs ink-warning font-mono break-all p-2 rounded border border-warning/30 bg-warning/15">
        &quot;{expandedQuery}&quot;
      </div>

      <Input
        placeholder={tb("enterBookmarkName")}
        value={bookmarkName}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        className="text-sm bg-background border-warning/30 focus:border-warning"
      />

      <p className="text-xs ink-warning">
        {tb("lettersNumbersDashes")}
      </p>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={!bookmarkName.trim()}
          className="bg-warning hover:bg-warning/90 text-warning-foreground"
        >
          <Check className="h-3 w-3 mr-1" />
          {tc("save")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="ink-warning hover:bg-warning/15"
        >
          {tc("cancel")}
        </Button>
      </div>
    </div>
  );
}
