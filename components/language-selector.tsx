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

interface LanguageOption {
  code: string;
  name: string;
  flagUrl: string;
}

export const languageOptions: LanguageOption[] = [
  { code: "en", name: "English", flagUrl: "https://flagcdn.com/w20/gb.png" },
  { code: "es", name: "Spanish", flagUrl: "https://flagcdn.com/w20/es.png" },
  { code: "fr", name: "French", flagUrl: "https://flagcdn.com/w20/fr.png" },
  { code: "de", name: "German", flagUrl: "https://flagcdn.com/w20/de.png" },
  { code: "it", name: "Italian", flagUrl: "https://flagcdn.com/w20/it.png" },
  { code: "pt", name: "Portuguese", flagUrl: "https://flagcdn.com/w20/pt.png" },
  { code: "zh", name: "Chinese", flagUrl: "https://flagcdn.com/w20/cn.png" },
  { code: "ja", name: "Japanese", flagUrl: "https://flagcdn.com/w20/jp.png" },
  { code: "ko", name: "Korean", flagUrl: "https://flagcdn.com/w20/kr.png" },
  { code: "ru", name: "Russian", flagUrl: "https://flagcdn.com/w20/ru.png" },
];

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
            className={cn("ml-2 flex-shrink-0 w-auto min-w-[120px] h-9", className)}
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
