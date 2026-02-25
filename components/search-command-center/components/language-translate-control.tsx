"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { RefreshCw, Loader2, X, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/language-selector";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";

interface LanguageTranslateControlProps {
  value?: string;
  onValueChange?: (value: string) => void;
  onTranslate?: (e?: React.MouseEvent) => void;
  disabled?: boolean;
  /** When true, the translate button is disabled (e.g. no query to translate) */
  translateDisabled?: boolean;
  isTranslating?: boolean;
  /** When false, translation feature is locked behind a plan upgrade */
  isPlanEntitled?: boolean;
}

const ACTIONS_WIDTH = 56 + 8;

export function LanguageTranslateControl({
  value,
  onValueChange,
  onTranslate,
  disabled = false,
  translateDisabled = false,
  isTranslating = false,
  isPlanEntitled = true,
}: LanguageTranslateControlProps) {
  const t = useTranslations("searchCommand");
  const shouldReduceMotion = useReducedMotion();
  const hasValue = Boolean(value);

  const handleClear = () => {
    onValueChange?.("");
  };

  return (
    <div
      className={cn(
        "flex items-center rounded-md overflow-hidden",
        "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
        "border border-violet-500/30 hover:border-violet-500/50",
        "text-violet-700 dark:text-violet-300",
        "transition-colors duration-200"
      )}
    >
      <motion.div
        className="overflow-hidden shrink-0"
        animate={{ width: hasValue ? ACTIONS_WIDTH : 0 }}
        transition={shouldReduceMotion ? { duration: 0 } : subtleSpring}
        aria-hidden={!hasValue}
      >
        <div
          className="flex items-center border-r border-violet-500/30"
          style={{ width: ACTIONS_WIDTH }}
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || translateDisabled || !hasValue || !isPlanEntitled}
            onClick={onTranslate}
            title={t("translate")}
            aria-label={t("translate")}
            className="size-8 p-0 rounded-none hover:from-violet-500/20 hover:to-fuchsia-500/20 hover:bg-violet-500/10"
          >
            {isTranslating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || !hasValue}
            onClick={handleClear}
            title={t("clearLanguage")}
            aria-label={t("clearLanguage")}
            className="size-8 p-0 rounded-none hover:from-violet-500/20 hover:to-fuchsia-500/20 hover:bg-violet-500/10"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </motion.div>
      <LanguageSelector
        value={value}
        onValueChange={isPlanEntitled ? onValueChange : undefined}
        disabled={disabled || !isPlanEntitled}
        isPlanEntitled={isPlanEntitled}
        flagOnly
        className="border-0 rounded-none min-w-[2.5rem] shrink-0"
      />
      {!isPlanEntitled && (
        <div className="flex items-center px-1.5 border-l border-violet-500/30">
          <Lock className="h-3 w-3 text-violet-500/70" />
        </div>
      )}
    </div>
  );
}
