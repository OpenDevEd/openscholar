"use client";

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Languages, Wand2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { languageOptions } from "@/lib/ai/core/languages";
import { useTranslations } from "next-intl";

export { languageOptions } from "@/lib/ai/core/languages";

interface LanguageSelectorProps {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function LanguageSelector({
  value,
  onValueChange,
  disabled = false,
  className,
  placeholder,
}: LanguageSelectorProps) {
  const tf = useTranslations("searchFilters");
  const tl = useTranslations("languages");
  const tc = useTranslations("common");
  const selectedLanguage = languageOptions.find((lang) => lang.code === value);
  const resolvedPlaceholder = placeholder ?? tc("language");
  const selectedLabel = selectedLanguage
    ? tl(selectedLanguage.code as never) || selectedLanguage.name
    : "";

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            size="sm"
            className={cn(
              "w-auto min-w-[120px] max-w-[220px] flex-1",
              "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
              "hover:from-violet-500/20 hover:to-fuchsia-500/20",
              "border-violet-500/30 hover:border-violet-500/50",
              "text-violet-700 dark:text-violet-300",
              "transition-all duration-200",
              className,
            )}
          >
            {selectedLanguage ? (
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={selectedLanguage.flagUrl}
                  alt={`${selectedLanguage.name} flag`}
                  className="w-4 h-3 rounded-sm border border-gray-200"
                />
                <SelectValue>{selectedLabel}</SelectValue>
              </div>
            ) : (
              <SelectValue placeholder={resolvedPlaceholder} />
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 p-3 bg-foreground text-background border border-background/20 shadow-lg">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Languages className="h-4 w-4 text-background" />
              <p className="text-sm font-semibold text-background">{tf("selectSearchLanguage")}</p>
            </div>
            <p className="text-xs text-background/90 leading-relaxed">
              {tf("languageTooltipDescription")}
            </p>
            <div className="space-y-1.5">
              <div className="flex items-start gap-2 text-xs">
                <Wand2 className="h-3.5 w-3.5 mt-0.5 text-background/95" />
                <span className="text-background/85">
                  {tf("languageTooltipPreserveIntent")}
                </span>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <ArrowRight className="h-3.5 w-3.5 mt-0.5 text-background/95" />
                <span className="text-background/85">
                  {tf("languageTooltipAutoApply")}
                </span>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
      <SelectContent
        position="popper"
        align="start"
        className="z-[200] max-h-80 overflow-y-auto"
      >
        {languageOptions.map((language) => (
          <SelectItem key={language.code} value={language.code}>
            <div className="flex items-center gap-2">
              <img
                src={language.flagUrl}
                alt={`${language.name} flag`}
                className="w-4 h-3 rounded-sm border border-gray-200"
              />
              <span>{tl(language.code as never) || language.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
