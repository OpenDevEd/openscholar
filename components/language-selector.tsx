"use client";

import React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { languageOptions } from "@/lib/ai/core/languages";
import { useTranslations } from "next-intl";
import { submitButtonMorphTransition } from "@/lib/animation-config";

// Subtle rotate + blur for code/icon transitions (softer than submit button)
const iconVariants = {
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
  /** When true, trigger shows only the language code (no name). Useful with a separate translate button. */
  compact?: boolean;
}

export function LanguageSelector({
  value,
  onValueChange,
  disabled = false,
  className,
  placeholder,
  compact = false,
}: LanguageSelectorProps) {
  const tl = useTranslations("languages");
  const tc = useTranslations("common");
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
          compact ? "min-w-[2.5rem] px-2" : "min-w-[120px] max-w-[220px]",
          "bg-ai-bg border-ai-border text-ai shadow-xs",
          "hover:bg-ai-bg-hover hover:border-ai-border-hover hover:shadow-[var(--ai-glow)]",
          "dark:bg-ai-bg dark:border-ai-border dark:text-ai",
          "dark:hover:bg-ai-bg-hover dark:hover:border-ai-border-hover",
          "transition-all duration-200",
          "[&_svg:not([class*='text-'])]:text-ai",
          className,
        )}
        aria-label={compact ? selectedLabel || resolvedPlaceholder : undefined}
      >
        {compact ? (
          <span className="relative flex h-4 w-5 shrink-0 items-center justify-center">
            <AnimatePresence mode="popLayout">
              {selectedLanguage ? (
                <motion.span
                  key={`code-${selectedLanguage.code}`}
                  variants={iconVariants}
                  initial="enter"
                  animate="animate"
                  exit="exit"
                  transition={transition}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <SelectValue>
                    <span className="text-2xs font-medium uppercase leading-none">
                      {selectedLanguage.code}
                    </span>
                  </SelectValue>
                </motion.span>
              ) : (
                <motion.span
                  key="icon"
                  variants={iconVariants}
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
          <SelectValue>{selectedLabel}</SelectValue>
        ) : (
          <SelectValue placeholder={resolvedPlaceholder} />
        )}
      </SelectTrigger>
    </div>
  );

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      {trigger}
      <SelectContent
        position="popper"
        align="start"
        className="z-[200] max-h-80 overflow-y-auto"
      >
        {languageOptions.map((language) => (
          <SelectItem key={language.code} value={language.code}>
            {tl(language.code as never) || language.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
