"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useKeywordExpansionStore, useKeywordExpansionDialogStore } from "@/lib/store";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { useAppToast } from "@/lib/toast";
import { subtleSpring } from "@/lib/animation-config";

export function BookmarksSaveBanner() {
  const toast = useAppToast();
  const tb = useTranslations("bookmarksPage");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const tToast = useTranslations("toast");
  const [name, setName] = useState("");
  const [isDismissed, setIsDismissed] = useState(false);
  const { keywords, addKeyword } = useKeywordExpansionStore();
  const { suggestedQuery, setSuggestedQuery } = useKeywordExpansionDialogStore();

  if (isDismissed || !suggestedQuery) {
    return null;
  }

  const validateKeyword = (keyword: string): string | null => {
    if (!keyword.trim()) return tv("bookmarkNameEmpty");
    if (!/^[a-zA-Z0-9-]+$/.test(keyword)) return tv("bookmarkNameFormat");
    if (keyword.includes(' ')) return tv("bookmarkNameNoSpaces");
    return null;
  };

  const handleSave = () => {
    const trimmedName = name.trim();

    if (!suggestedQuery.trim()) {
      toast.validation.failed(tv("noQueryToSave"));
      return;
    }

    const validationError = validateKeyword(trimmedName);
    if (validationError) {
      toast.validation.failed(validationError);
      return;
    }

    if (keywords[trimmedName]) {
      toast.validation.failed(tv("bookmarkNameExists", { name: trimmedName }));
      return;
    }

    // Expand the query before saving it as a bookmark
    const { expandedQuery } = validateAndExpandKeywordsSilently(suggestedQuery);

    addKeyword(trimmedName, expandedQuery);
    setName("");
    setSuggestedQuery("");
    toast.entity.created(tToast("entityBookmark"), trimmedName);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={subtleSpring}
      className={cn(
        "mx-4 md:mx-6 mt-4",
        "p-4 rounded-xl",
        "bg-emerald-50 dark:bg-emerald-950/30",
        "border border-emerald-200 dark:border-emerald-800"
      )}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
            <Save className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              {tb("saveCurrentSearch")}
            </h3>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {tb("saveSearchDescription")}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsDismissed(true)}
          className="h-8 w-8 p-0 text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {/* Query textarea */}
        <Textarea
          value={suggestedQuery}
          onChange={(e) => setSuggestedQuery(e.target.value)}
          className={cn(
            "min-h-[80px] text-sm font-mono",
            "bg-white dark:bg-emerald-950/50",
            "border-emerald-200 dark:border-emerald-800",
            "text-emerald-700 dark:text-emerald-300",
            "focus:border-emerald-400 dark:focus:border-emerald-600"
          )}
          placeholder={tb("editQueryPlaceholder")}
        />

        {/* Name input and save button */}
        <div className="flex gap-3">
          <Input
            placeholder={tb("enterBookmarkName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              "flex-1",
              "bg-white dark:bg-emerald-950/50",
              "border-emerald-200 dark:border-emerald-800"
            )}
          />
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !suggestedQuery.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 gap-1.5"
          >
            <Save className="h-4 w-4" />
            {tc("save")}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
