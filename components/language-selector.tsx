"use client";

import React from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
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
import { Languages, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { languageOptions } from "@/lib/ai/core/languages";
import { useTranslations } from "next-intl";
import { submitButtonMorphTransition } from "@/lib/animation-config";

// Subtle rotate + blur for flag/icon transitions (softer than submit button)
const flagIconVariants = {
  enter: { rotate: -8, filter: "blur(2px)", opacity: 0 },
  animate: { rotate: 0, filter: "blur(0px)", opacity: 1 },
  exit: { rotate: 8, filter: "blur(2px)", opacity: 0 },
};

export { languageOptions } from "@/lib/ai/core/languages";

interface LanguageSelectorProps {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** When true, trigger shows only the flag (no text). Useful with a separate translate button. */
  flagOnly?: boolean;
  /** When false, tooltip shows an upgrade prompt instead of the usual description. */
  isPlanEntitled?: boolean;
}

export function LanguageSelector({
  value,
  onValueChange,
  disabled = false,
  className,
  placeholder,
  flagOnly = false,
  isPlanEntitled = true,
}: LanguageSelectorProps) {
  const tl = useTranslations("languages");
  const tc = useTranslations("common");
  const ts = useTranslations("searchCommand");
  const selectedLanguage = languageOptions.find((lang) => lang.code === value);
  const resolvedPlaceholder = placeholder ?? tc("language");
  const selectedLabel = selectedLanguage
    ? tl(selectedLanguage.code as never) || selectedLanguage.name
    : "";
  const shouldReduceMotion = useReducedMotion();
  const transition = shouldReduceMotion ? { duration: 0 } : submitButtonMorphTransition;

  const trigger = (
    <div className="flex items-stretch">
      <SelectTrigger
        size="sm"
        className={cn(
          "w-auto flex-1",
          flagOnly ? "min-w-[2.5rem] px-2" : "min-w-[120px] max-w-[220px]",
          "bg-ai-bg border-ai-border text-ai shadow-xs",
          "hover:bg-ai-bg-hover hover:border-ai-border-hover hover:shadow-[var(--ai-glow)]",
          "dark:bg-ai-bg dark:border-ai-border dark:text-ai",
          "dark:hover:bg-ai-bg-hover dark:hover:border-ai-border-hover",
          "transition-all duration-200",
          "[&_svg:not([class*='text-'])]:text-ai",
          !isPlanEntitled && "rounded-r-none border-r-0",
          className,
        )}
      >
        {flagOnly ? (
          <span className="relative flex h-3 w-4 shrink-0 items-center justify-center">
            <AnimatePresence mode="popLayout">
              {selectedLanguage ? (
                <motion.span
                  key={`flag-${selectedLanguage.code}`}
                  variants={flagIconVariants}
                  initial="enter"
                  animate="animate"
                  exit="exit"
                  transition={transition}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <SelectValue>
                    <img
                      src={selectedLanguage.flagUrl}
                      alt={`${selectedLanguage.name} flag`}
                      className="h-3 w-4 rounded-sm border border-gray-200 object-cover"
                    />
                  </SelectValue>
                </motion.span>
              ) : (
                <motion.span
                  key="icon"
                  variants={flagIconVariants}
                  initial="enter"
                  animate="animate"
                  exit="exit"
                  transition={transition}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <Languages className="h-3 w-3" />
                  <SelectValue placeholder="" />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        ) : selectedLanguage ? (
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
      {!isPlanEntitled && (
        <div className="flex items-center px-1.5 border-l border-current/20 bg-ai-bg text-ai">
          <Lock className="h-3 w-3 opacity-70" />
        </div>
      )}
    </div>
  );

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      {isPlanEntitled ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent sideOffset={6} className="max-w-52 px-2.5 py-2 text-xs leading-relaxed">
            <p className="text-background/80">{ts("translationPlanRequired")}</p>
            <Link
              href="/pricing"
              className="mt-1 inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
            >
              {tc("upgradeTo", { plan: "Go" })} →
            </Link>
          </TooltipContent>
        </Tooltip>
      )}
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
