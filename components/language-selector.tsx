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
import { Languages, Wand2, ArrowRight, Lock } from "lucide-react";
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
  const tf = useTranslations("searchFilters");
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

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            size="sm"
            className={cn(
              "w-auto flex-1",
              flagOnly ? "min-w-[2.5rem] px-2" : "min-w-[120px] max-w-[220px]",
              "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
              "hover:from-violet-500/20 hover:to-fuchsia-500/20",
              "border-violet-500/30 hover:border-violet-500/50",
              "text-violet-700 dark:text-violet-300",
              "transition-all duration-200",
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
                      <Languages className="h-3 w-3 text-muted-foreground" />
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
        </TooltipTrigger>
        <TooltipContent className="max-w-72 p-0 bg-foreground text-background border border-background/10 shadow-xl overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center size-7 rounded-md bg-background/10 shrink-0">
                <Languages className="h-3.5 w-3.5 text-background" />
              </div>
              <p className="text-sm font-semibold text-background leading-tight">{tf("selectSearchLanguage")}</p>
            </div>
            <p className="text-xs text-background/70 leading-relaxed">
              {tf("languageTooltipDescription")}
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <div className="flex items-center justify-center size-4 rounded bg-background/10 shrink-0 mt-0.5">
                  <Wand2 className="h-2.5 w-2.5 text-background/90" />
                </div>
                <span className="text-xs text-background/65 leading-relaxed">
                  {tf("languageTooltipPreserveIntent")}
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <div className="flex items-center justify-center size-4 rounded bg-background/10 shrink-0 mt-0.5">
                  <ArrowRight className="h-2.5 w-2.5 text-background/90" />
                </div>
                <span className="text-xs text-background/65 leading-relaxed">
                  {tf("languageTooltipAutoApply")}
                </span>
              </div>
            </div>
            {!isPlanEntitled && (
              <div className="flex flex-col gap-2 pt-3 border-t border-background/15">
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center size-4 rounded bg-background/10 shrink-0 mt-0.5">
                    <Lock className="h-2.5 w-2.5 text-background/90" />
                  </div>
                  <p className="text-xs text-background/70 leading-relaxed">
                    {ts("translationPlanRequired")}
                  </p>
                </div>
                <Link
                  href="/pricing"
                  className="text-xs font-semibold text-background underline-offset-2 hover:underline ml-6.5"
                >
                  {tc("upgradeTo", { plan: "Go" })} →
                </Link>
              </div>
            )}
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
