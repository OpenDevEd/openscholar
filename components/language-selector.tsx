"use client";

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TranslateIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { languageOptions } from "@/lib/ai/core/languages";
import { useTranslations } from "next-intl";

export { languageOptions } from "@/lib/ai/core/languages";

interface LanguageSelectorProps {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  /** The query is being translated: the globe loops. */
  working?: boolean;
  className?: string;
}

/**
 * Picks the language to search in. Choosing one rewrites the keywords into it, so the search finds papers
 * written in that language. It says so in words, since the results' Translate button does the reverse.
 */
export function LanguageSelector({ value, onValueChange, disabled = false, working = false, className }: LanguageSelectorProps) {
  const tl = useTranslations("languages");
  const t = useTranslations("searchCommand");
  const selectedLanguage = languageOptions.find((lang) => lang.code === value);
  const selectedLabel = selectedLanguage ? tl(selectedLanguage.code as never) || selectedLanguage.name : "";
  const label = selectedLanguage ? t("searchInLanguage", { language: selectedLabel }) : t("anyLanguage");

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn("w-auto gap-1.5 px-2.5 ai-surface shadow-xs [&_svg:not([class*='text-'])]:text-primary", className)}
      >
        <TranslateIcon working={working} size={12} className="h-3 w-3" />
        <span className="hidden whitespace-nowrap text-xs font-medium sm:inline">{label}</span>
        {selectedLanguage ? (
          <span className="text-2xs font-medium uppercase leading-none sm:hidden">{selectedLanguage.code}</span>
        ) : null}
        {/* Radix still needs its value slot; the label above says what it holds. */}
        <span hidden>
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="z-[200] max-h-80 overflow-y-auto">
        {languageOptions.map((language) => (
          <SelectItem key={language.code} value={language.code}>
            {tl(language.code as never) || language.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
