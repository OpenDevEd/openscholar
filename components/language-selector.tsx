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
  placeholder = "Language",
}: LanguageSelectorProps) {
  const selectedLanguage = languageOptions.find((lang) => lang.code === value);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Select value={value} onValueChange={onValueChange} disabled={disabled}>
          <SelectTrigger
          size="sm"
            className={cn("w-auto min-w-[120px] flex-1", className)}
          >
            <div className="flex items-center gap-2">
              {selectedLanguage ? (
                <>
                  <img
                    src={selectedLanguage.flagUrl}
                    alt={`${selectedLanguage.name} flag`}
                    className="w-4 h-3 rounded-sm border border-gray-200"
                  />
                  <span className="text-sm">{selectedLanguage.name}</span>
                </>
              ) : (
                <>
                  <Languages className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder={placeholder} />
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
                  <span>{language.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TooltipTrigger>
      <TooltipContent>
        <p>Select search language</p>
      </TooltipContent>
    </Tooltip>
  );
}
