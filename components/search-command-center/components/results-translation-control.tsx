"use client";

import React, { useCallback, useContext, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Globe2, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { localeToLanguageCode } from "@/lib/i18n/locale-map";
import { useAppToast } from "@/lib/toast";
import { useResultsTranslationSettingsStore } from "@/lib/store";
import { TranslationContext } from "@/components/results-contexts";
import { languageOptions } from "@/lib/ai/core/languages";
import { cn } from "@/lib/utils";

interface ResultsTranslationControlProps {
  disabled?: boolean;
  triggerClassName?: string;
  triggerVariant?: "outline" | "ghost";
  compactTrigger?: boolean;
}

export function ResultsTranslationControl({
  disabled = false,
  triggerClassName,
  triggerVariant = "outline",
  compactTrigger = false,
}: ResultsTranslationControlProps) {
  const toast = useAppToast();
  const t = useTranslations("searchCommand");
  const tc = useTranslations("common");
  const tl = useTranslations("languages");
  const locale = useLocale();
  const targetModeId = useId();
  const [isOpen, setIsOpen] = useState(false);

  const localeTargetId = `${targetModeId}-target-locale`;
  const manualTargetId = `${targetModeId}-target-manual`;
  const localeTargetLanguage = localeToLanguageCode(locale);

  const autoTranslateResults = useResultsTranslationSettingsStore(
    (state) => state.autoTranslateResults
  );
  const targetLanguageOverride = useResultsTranslationSettingsStore(
    (state) => state.targetLanguageOverride
  );
  const setAutoTranslateResults = useResultsTranslationSettingsStore(
    (state) => state.setAutoTranslateResults
  );
  const setTargetLanguageOverride = useResultsTranslationSettingsStore(
    (state) => state.setTargetLanguageOverride
  );
  const clearTargetLanguageOverride = useResultsTranslationSettingsStore(
    (state) => state.clearTargetLanguageOverride
  );
  const requestManualRun = useResultsTranslationSettingsStore(
    (state) => state.requestManualRun
  );

  const { loadingPaperIds, isConfigured = false } =
    useContext(TranslationContext);

  const isTranslating = (loadingPaperIds?.size ?? 0) > 0;
  const isUsingLocaleTarget = targetLanguageOverride === null;
  const targetMode = isUsingLocaleTarget ? "locale" : "manual";
  const effectiveTargetLanguage = targetLanguageOverride ?? localeTargetLanguage;
  const effectiveTargetLabel =
    tl(effectiveTargetLanguage as never) || effectiveTargetLanguage;
  const targetBadgeLabel = effectiveTargetLanguage.toUpperCase();
  const isTriggerDisabled = disabled;
  const isRunDisabled = disabled || isTranslating;
  const showActiveTranslationState = autoTranslateResults;
  const triggerAriaLabel = `${t("translate")} - ${t("targetLanguageValue", { language: effectiveTargetLabel })}`;

  const handleTargetModeChange = useCallback(
    (value: string) => {
      if (value === "locale") {
        clearTargetLanguageOverride();
        return;
      }
      if (targetLanguageOverride === null) {
        setTargetLanguageOverride(localeTargetLanguage);
      }
    },
    [
      clearTargetLanguageOverride,
      localeTargetLanguage,
      setTargetLanguageOverride,
      targetLanguageOverride,
    ]
  );

  const handleRunTranslation = useCallback(() => {
    if (isRunDisabled) return;
    if (!isConfigured) {
      toast.ai.configRequired(t("configureAISettings"));
      return;
    }
    requestManualRun();
  }, [isConfigured, isRunDisabled, requestManualRun, t, toast]);

  const trigger = (
    <Button
      variant={triggerVariant}
      size="sm"
      disabled={isTriggerDisabled}
      aria-label={triggerAriaLabel}
      className={cn(
        compactTrigger
          ? "h-8 gap-1.5 px-2.5"
          : "h-8 rounded-full gap-1.5 pl-2.5 pr-2 border-border/70 bg-background/90 hover:bg-accent/50",
        compactTrigger
          ? showActiveTranslationState && "bg-background text-foreground shadow-xs"
          : showActiveTranslationState && "border-primary/40 text-primary",
        compactTrigger
          ? isOpen && "bg-background text-foreground shadow-xs"
          : isOpen && "border-primary/50 shadow-[0_0_0_3px] shadow-primary/10",
        triggerClassName
      )}
    >
      {isTranslating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Globe2 className="h-4 w-4" />
      )}
      <span>{t("translate")}</span>
      {compactTrigger ? (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {targetBadgeLabel}
        </span>
      ) : (
        <Badge
          variant="outline"
          className="h-5 rounded-full px-1.5 text-[10px] font-semibold tracking-wide"
        >
          {targetBadgeLabel}
        </Badge>
      )}
      {showActiveTranslationState && !isTranslating && !compactTrigger && (
        <Sparkles className="h-3.5 w-3.5 text-primary/80" />
      )}
    </Button>
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] overflow-hidden p-0">
        <PopoverHeader className="gap-1 border-b bg-muted/25 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <PopoverTitle className="text-sm">{t("translationSettings")}</PopoverTitle>
              <PopoverDescription className="text-xs">
                {t("targetLanguageValue", { language: effectiveTargetLabel })}
              </PopoverDescription>
            </div>
            <Badge
              variant="outline"
              className="h-5 shrink-0 rounded-full px-1.5 text-[10px] font-semibold tracking-wide"
            >
              {targetBadgeLabel}
            </Badge>
          </div>
        </PopoverHeader>

        <div className="space-y-4 px-4 py-3">
          <div className="rounded-lg border border-border/60 bg-background/80 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{t("autoTranslateResults")}</p>
                <p className="text-xs text-muted-foreground">{t("listedItemsOnly")}</p>
              </div>
              <Switch
                size="sm"
                checked={autoTranslateResults}
                onCheckedChange={setAutoTranslateResults}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="space-y-2">
            <RadioGroup
              value={targetMode}
              onValueChange={handleTargetModeChange}
              className="gap-2"
            >
              <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="locale" id={localeTargetId} />
                  <Label htmlFor={localeTargetId} className="cursor-pointer text-sm font-medium">
                    {t("useCurrentLocaleTarget")}
                  </Label>
                </div>
                {isUsingLocaleTarget && <Check className="h-4 w-4 text-primary" />}
              </div>

              <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="manual" id={manualTargetId} />
                  <Label htmlFor={manualTargetId} className="cursor-pointer text-sm font-medium">
                    {tc("manual")}
                  </Label>
                </div>
                {!isUsingLocaleTarget && <Check className="h-4 w-4 text-primary" />}
              </div>
            </RadioGroup>

            {!isUsingLocaleTarget && (
              <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2.5">
                <Label className="text-xs text-muted-foreground">{tc("language")}</Label>
                <Select
                  value={targetLanguageOverride ?? localeTargetLanguage}
                  onValueChange={setTargetLanguageOverride}
                  disabled={disabled}
                >
                  <SelectTrigger size="sm" className="w-full bg-background shadow-none">
                    <SelectValue placeholder={tc("language")} />
                  </SelectTrigger>
                  <SelectContent className="z-[220] max-h-72">
                    {languageOptions.map((language) => (
                      <SelectItem key={language.code} value={language.code}>
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className="flex items-center gap-2">
                            <img
                              src={language.flagUrl}
                              alt={`${language.name} flag`}
                              className="h-3 w-4 shrink-0 rounded-sm border border-gray-200 object-cover"
                            />
                            <span>{tl(language.code as never) || language.name}</span>
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {language.code}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <Separator />
        <div className="px-4 py-3">
          <Button
            type="button"
            size="sm"
            className="w-full"
            variant={autoTranslateResults ? "outline" : "default"}
            onClick={handleRunTranslation}
            disabled={isRunDisabled}
          >
            {isTranslating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("translatingResults")}
              </>
            ) : (
              t("runResultsTranslation")
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
