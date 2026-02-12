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
import { Languages } from "lucide-react";
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Select value={value} onValueChange={onValueChange} disabled={disabled}>
          <SelectTrigger
          size="sm"
            className={cn(
              "w-auto min-w-[120px] flex-1",
              "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
              "hover:from-violet-500/20 hover:to-fuchsia-500/20",
              "border-violet-500/30 hover:border-violet-500/50",
              "text-violet-700 dark:text-violet-300",
              "transition-all duration-200",
              className,
            )}
          >
            <div className="flex items-center gap-2">
              {selectedLanguage ? (
                <>
                  <img
                    src={selectedLanguage.flagUrl}
                    alt={`${selectedLanguage.name} flag`}
                    className="w-4 h-3 rounded-sm border border-gray-200"
                  />
                  <span className="text-sm">{tl(selectedLanguage.code as never) || selectedLanguage.name}</span>
                </>
              ) : (
                <>
                  <Languages className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder={resolvedPlaceholder} />
                </>
              )}
            </div>
          </SelectTrigger>
          <SelectContent>
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
      </TooltipTrigger>
      <TooltipContent>
        <p>{tf("selectSearchLanguage")}</p>
      </TooltipContent>
    </Tooltip>
  );
}
