"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useKeywordExpansionStore } from "@/lib/store";
import { appToast } from "@/lib/toast";
import { subtleSpring } from "@/lib/animation-config";
import posthog from "posthog-js";

export function BookmarksAddForm() {
  const tb = useTranslations("bookmarksPage");
  const tv = useTranslations("validation");
  const [name, setName] = useState("");
  const [expansion, setExpansion] = useState("");
  const { keywords, addKeyword } = useKeywordExpansionStore();

  const validateKeyword = (keyword: string): string | null => {
    if (!keyword.trim()) return tb("nameCannotBeEmpty");
    if (!/^[a-zA-Z0-9-]+$/.test(keyword)) return tb("nameOnlyLettersNumbersDashes");
    if (keyword.includes(' ')) return tb("nameNoSpaces");
    return null;
  };

  const handleAdd = () => {
    const trimmedName = name.trim();
    const trimmedExpansion = expansion.trim();

    const validationError = validateKeyword(trimmedName);
    if (validationError) {
      appToast.validation.failed(validationError);
      return;
    }

    if (!trimmedExpansion) {
      appToast.validation.failed(tv("expansionTextEmpty"));
      return;
    }

    if (keywords[trimmedName]) {
      appToast.validation.failed(tv("bookmarkNameExists", { name: trimmedName }));
      return;
    }

    addKeyword(trimmedName, trimmedExpansion);

    // Track bookmark creation event
    posthog.capture("bookmark_created", {
      bookmark_name: trimmedName,
      expansion_length: trimmedExpansion.length,
      has_boolean_operators: /\b(AND|OR|NOT)\b/.test(trimmedExpansion),
      total_bookmarks: Object.keys(keywords).length + 1,
    });

    setName("");
    setExpansion("");
    appToast.entity.created("bookmark", trimmedName);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...subtleSpring, delay: 0.1 }}
      className={cn(
        "px-4 md:px-6 py-4",
        "border-b border-border/40",
        "bg-muted/20"
      )}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Name input */}
        <div className="space-y-1.5">
          <Label htmlFor="bookmark-name" className="text-xs text-muted-foreground">
            {tb("bookmarkName")}
          </Label>
          <Input
            id="bookmark-name"
            placeholder={tb("bookmarkNamePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              "h-10",
              "bg-background/60",
              "border-border/50",
              "placeholder:text-muted-foreground/60"
            )}
          />
          <p className="text-xs text-muted-foreground">
            {tb("lettersNumbersDashes")}
          </p>
        </div>

        {/* Expansion input */}
        <div className="space-y-1.5">
          <Label htmlFor="bookmark-expansion" className="text-xs text-muted-foreground">
            {tb("expandsTo")}
          </Label>
          <Input
            id="bookmark-expansion"
            placeholder={tb("expandsToPlaceholder")}
            value={expansion}
            onChange={(e) => setExpansion(e.target.value)}
            className={cn(
              "h-10",
              "bg-background/60",
              "border-border/50",
              "placeholder:text-muted-foreground/60"
            )}
          />
          <p className="text-xs text-muted-foreground">
            {tb("useInSearch")}
          </p>
        </div>
      </div>

      {/* Add button - full width below on mobile, right-aligned on desktop */}
      <div className="mt-4 flex justify-end">
        <Button
          onClick={handleAdd}
          disabled={!name.trim() || !expansion.trim()}
          className="w-full md:w-auto gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {tb("addBookmark")}
        </Button>
      </div>
    </motion.div>
  );
}
