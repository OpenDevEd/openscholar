"use client";

import { ButtonCredits } from "@/components/ui/button-credits";
import { useBatchTranslations } from "@/lib/ai/client/router";
import React, { useCallback, useContext, useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, TranslateIcon, Undo2 } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
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
import { LanguageSelectItems } from "@/components/language-selector";
import { cn } from "@/lib/utils";

interface ResultsTranslationControlProps {
  disabled?: boolean;
  triggerClassName?: string;
  triggerVariant?: "outline" | "ghost";
  compactTrigger?: boolean;
}

/** The language translations go to: the one picked, else the page's. */
function useTranslationTarget() {
  const tl = useTranslations("languages");
  const localeTargetLanguage = localeToLanguageCode(useLocale());
  const targetLanguageOverride = useResultsTranslationSettingsStore(
    (state) => state.targetLanguageOverride
  );
  const effectiveTargetLanguage = targetLanguageOverride ?? localeTargetLanguage;
  return {
    localeTargetLanguage,
    targetLanguageOverride,
    effectiveTargetLanguage,
    effectiveTargetLabel: tl(effectiveTargetLanguage as never) || effectiveTargetLanguage,
  };
}

export function ResultsTranslationControl({
  disabled = false,
  triggerClassName,
  triggerVariant = "outline",
  compactTrigger = false,
}: ResultsTranslationControlProps) {
  const t = useTranslations("searchCommand");
  const [isOpen, setIsOpen] = useState(false);
  const { effectiveTargetLanguage, effectiveTargetLabel } = useTranslationTarget();

  const autoTranslateResults = useResultsTranslationSettingsStore(
    (state) => state.autoTranslateResults
  );
  const requestManualRun = useResultsTranslationSettingsStore(
    (state) => state.requestManualRun
  );

  const {
    loadingPaperIds,
    isConfigured = false,
    translatedPaperCount = 0,
    totalPaperCount = 0,
  } = useContext(TranslationContext);

  const isTranslating = (loadingPaperIds?.size ?? 0) > 0;
  const allTranslated =
    !isTranslating && totalPaperCount > 0 && translatedPaperCount === totalPaperCount;
  const targetBadgeLabel = effectiveTargetLanguage.toUpperCase();
  const isTriggerDisabled = disabled;
  const showActiveTranslationState = autoTranslateResults || allTranslated;
  const triggerAriaLabel = `${t("translate")} - ${t("targetLanguageValue", { language: effectiveTargetLabel })}`;

  const trigger = (
    <Button
      variant={triggerVariant}
      size="sm"
      disabled={isTriggerDisabled}
      aria-label={triggerAriaLabel}
      className={cn(
        compactTrigger
          ? "h-8 gap-1.5 px-2.5"
          : "h-8 rounded-full gap-1.5 ps-2.5 pe-2 border-border bg-field hover:bg-accent",
        compactTrigger
          ? allTranslated
            ? "bg-background ink-success shadow-xs"
            : showActiveTranslationState && "bg-background text-foreground shadow-xs"
          : allTranslated
            ? "border-success/40 ink-success"
            : showActiveTranslationState && "border-primary/40 text-primary",
        compactTrigger
          ? isOpen && "bg-background text-foreground shadow-xs"
          : isOpen && "border-primary/50 shadow-[0_0_0_3px] shadow-primary/10",
        triggerClassName
      )}
    >
      {allTranslated ? (
        <Check className="h-4 w-4 text-success" />
      ) : (
        <TranslateIcon working={isTranslating} className="h-4 w-4" />
      )}
      {/* In the footer's strip its name hides on a phone, as its neighbours' do; the language stays. */}
      <span className={cn(compactTrigger && "hidden @3xl:inline")}>{allTranslated ? t("translated") : t("translate")}</span>
      {compactTrigger ? (
        <span className="text-3xs font-semibold tracking-wide text-muted-foreground">
          {targetBadgeLabel}
        </span>
      ) : (
        <Badge
          variant="outline"
          className={cn(
            "h-5 rounded-full px-1.5 text-3xs font-semibold tracking-wide",
            allTranslated && "border-success/40 ink-success"
          )}
        >
          {targetBadgeLabel}
        </Badge>
      )}
    </Button>
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <TranslationSettingsMenu
        disabled={disabled}
        isConfigured={isConfigured}
        isTranslating={isTranslating}
        allTranslated={allTranslated}
        onRun={requestManualRun}
      />
    </Popover>
  );
}

interface TranslationSettingsMenuProps {
  disabled?: boolean;
  isConfigured: boolean;
  isTranslating: boolean;
  allTranslated: boolean;
  onRun: () => void;
  onInteractOutside?: React.ComponentProps<typeof PopoverContent>["onInteractOutside"];
}

/** The language, auto-translate and run menu, for whichever button opens it. */
export function TranslationSettingsMenu({
  disabled = false,
  isConfigured,
  isTranslating,
  allTranslated,
  onRun,
  onInteractOutside,
}: TranslationSettingsMenuProps) {
  const toast = useAppToast();
  const t = useTranslations("searchCommand");
  const tc = useTranslations("common");
  const targetModeId = useId();
  const localeTargetId = `${targetModeId}-target-locale`;
  const manualTargetId = `${targetModeId}-target-manual`;
  const { localeTargetLanguage, targetLanguageOverride, effectiveTargetLanguage, effectiveTargetLabel } = useTranslationTarget();
  // Each paper's title and abstract is one call: what the run costs is that times the papers on the page not translated yet.
  const { credits: paperCredits } = useBatchTranslations();

  const autoTranslateResults = useResultsTranslationSettingsStore(
    (state) => state.autoTranslateResults
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

  const setTranslationsUndone = useResultsTranslationSettingsStore(
    (state) => state.setTranslationsUndone
  );

  const isUsingLocaleTarget = targetLanguageOverride === null;
  const targetMode = isUsingLocaleTarget ? "locale" : "manual";
  const targetBadgeLabel = effectiveTargetLanguage.toUpperCase();
  const isRunDisabled = disabled || isTranslating || allTranslated;

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
    setTranslationsUndone(false);
    onRun();
  }, [isConfigured, isRunDisabled, onRun, setTranslationsUndone, t, toast]);

  // Off as well, or the next page of results would translate itself straight away.
  const handleUndoTranslation = useCallback(() => {
    setAutoTranslateResults(false);
    setTranslationsUndone(true);
  }, [setAutoTranslateResults, setTranslationsUndone]);

  const handleAutoTranslateChange = useCallback(
    (enabled: boolean) => {
      setAutoTranslateResults(enabled);
      if (enabled) setTranslationsUndone(false);
    },
    [setAutoTranslateResults, setTranslationsUndone]
  );

  return (
    <PopoverContent
      align="end"
      className="w-[340px] p-0"
      onInteractOutside={onInteractOutside}
    >
      <PopoverHeader className="gap-1 border-b bg-inset px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <PopoverTitle className="text-sm">{t("translationSettings")}</PopoverTitle>
            <PopoverDescription className="text-xs">
              {t("targetLanguageValue", { language: effectiveTargetLabel })}
            </PopoverDescription>
          </div>
          <Badge
            variant="outline"
            className="h-5 shrink-0 rounded-full px-1.5 text-3xs font-semibold tracking-wide"
          >
            {targetBadgeLabel}
          </Badge>
        </div>
      </PopoverHeader>

      <div className="space-y-4 px-4 py-3">
        <div className="rounded-lg border border-border-subtle bg-inset p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("autoTranslateResults")}</p>
              <p className="text-xs text-muted-foreground">{t("listedItemsOnly")}</p>
            </div>
            <Switch
              size="sm"
              checked={autoTranslateResults}
              onCheckedChange={handleAutoTranslateChange}
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
            <div className="flex items-center justify-between rounded-md border border-border-subtle px-2.5 py-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="locale" id={localeTargetId} />
                <Label htmlFor={localeTargetId} className="cursor-pointer text-sm font-medium">
                  {t("useCurrentLocaleTarget")}
                </Label>
              </div>
              {isUsingLocaleTarget && <Check className="h-4 w-4 text-primary" />}
            </div>

            <div className="flex items-center justify-between rounded-md border border-border-subtle px-2.5 py-2">
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
            <div className="space-y-1.5 rounded-md border border-border-subtle bg-inset p-2.5">
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
                  <LanguageSelectItems />
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
          className={cn(
            "w-full",
            allTranslated && "group/undo hover:bg-primary hover:text-primary-foreground hover:border-primary"
          )}
          variant={allTranslated ? "ai" : autoTranslateResults ? "outline" : "default"}
          // The press swaps Undo and Run under the pointer, so the second click of a double click would take it back.
          onClick={(event) => {
            if (event.detail > 1) return;
            if (allTranslated) handleUndoTranslation();
            else handleRunTranslation();
          }}
          disabled={allTranslated ? disabled : isRunDisabled}
        >
          {isTranslating ? (
            <>
              <TranslateIcon working size={14} className="h-3.5 w-3.5" />
              {t("translatingResults")}
            </>
          ) : allTranslated ? (
            <span key="undo" className="inline-flex items-center gap-2 font-semibold animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors group-hover/undo:bg-primary-foreground group-hover/undo:text-primary">
                {/* The arrow swings back the way the text will go, further under the press. */}
                <Undo2 className="size-3.5 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] rtl:-scale-x-100 group-hover/undo:-rotate-45 rtl:group-hover/undo:rotate-45 group-active/undo:-rotate-90 rtl:group-active/undo:rotate-90 motion-reduce:transition-none" />
              </span>
              {t("undoTranslation")}
            </span>
          ) : (
            <span key="run" className="inline-flex items-center gap-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">{t("runResultsTranslation")}<ButtonCredits credits={paperCredits} each className="text-current opacity-80" /></span>
          )}
        </Button>
      </div>
    </PopoverContent>
  );
}
