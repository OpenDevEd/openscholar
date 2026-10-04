"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { RefreshCw, Loader2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/language-selector";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import { TooltipHint } from "@/components/ui/tooltip";

interface LanguageTranslateControlProps {
  value?: string;
  onValueChange?: (value: string) => void;
  onTranslate?: (e?: React.MouseEvent) => void;
  disabled?: boolean;
  /** When true, the translate button is disabled (e.g. no query to translate) */
  translateDisabled?: boolean;
  isTranslating?: boolean;
}

const ACTIONS_WIDTH = 56 + 8;

export function LanguageTranslateControl({
  value,
  onValueChange,
  onTranslate,
  disabled = false,
  translateDisabled = false,
  isTranslating = false,
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
        "ai-surface border",
      )}
    >
      <motion.div
        className="overflow-hidden shrink-0"
        animate={{ width: hasValue ? ACTIONS_WIDTH : 0 }}
        transition={shouldReduceMotion ? { duration: 0 } : subtleSpring}
        aria-hidden={!hasValue}
      >
        <div
          className="flex items-center border-r border-current/20"
          style={{ width: ACTIONS_WIDTH }}
        >
          <TooltipHint label={t("translate")}>
            <span className="inline-flex">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || translateDisabled || !hasValue}
                onClick={onTranslate}
                aria-label={t("translate")}
                className="size-8 p-0 rounded-none text-ai hover:bg-ai-bg-hover"
              >
                {isTranslating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            </span>
          </TooltipHint>
          <TooltipHint label={t("clearLanguage")}>
            <span className="inline-flex">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || !hasValue}
                onClick={handleClear}
                aria-label={t("clearLanguage")}
                className="size-8 p-0 rounded-none text-ai hover:bg-ai-bg-hover"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </span>
          </TooltipHint>
        </div>
      </motion.div>
      <LanguageSelector
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        compact
        className="border-0 rounded-none min-w-[2.5rem] shrink-0"
      />
    </div>
  );
}
