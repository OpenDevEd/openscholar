"use client";

import { Coins, Globe, Zap } from "@/components/icons";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { modelSupportsWebSearch } from "@/lib/chat/web-search-capability";
import { CHAT_WEB_SEARCHES_PER_REPLY, WEB_SEARCH_CREDITS } from "@/lib/pricing";
import { api } from "@/convex/_generated/api";

interface WebSearchToggleProps {
  threadId: string;
  enabled: boolean;
  modelSupportedParameters: string[] | null | undefined;
  isGenerating: boolean;
}

type ToggleState = "on" | "off" | "unsupported";

export function WebSearchToggle({
  threadId,
  enabled,
  modelSupportedParameters,
  isGenerating,
}: WebSearchToggleProps) {
  const t = useTranslations("composer");
  const setWebSearch = useMutation(api.chat.messages.setChatWebSearchEnabled);
  const supported = modelSupportsWebSearch({
    supportedParameters: modelSupportedParameters ?? undefined,
  });
  const disabled = !supported || isGenerating;
  const state: ToggleState = !supported
    ? "unsupported"
    : enabled
      ? "on"
      : "off";

  const ariaLabel =
    state === "unsupported"
      ? t("webSearch.titleUnsupported")
      : enabled
        ? t("webSearch.ariaDisable")
        : t("webSearch.ariaEnable");

  const title =
    state === "on"
      ? t("webSearch.titleOn")
      : state === "off"
        ? t("webSearch.titleOff")
        : t("webSearch.titleUnsupported");

  const body =
    state === "on"
      ? t("webSearch.bodyOn")
      : state === "off"
        ? t("webSearch.bodyOff")
        : t("webSearch.bodyUnsupported");

  const showMeta = state !== "unsupported";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton
          aria-pressed={enabled}
          aria-disabled={disabled}
          aria-label={ariaLabel}
          data-action="toggle-web-search"
          data-web-search-state={state}
          data-web-search-enabled={String(enabled)}
          data-web-search-supported={String(supported)}
          onClick={() => {
            if (disabled) return;
            void setWebSearch({ threadId, enabled: !enabled });
          }}
          className={cn(
            "h-7 gap-1.5 rounded-full px-2 text-xs font-medium",
            disabled && "cursor-not-allowed opacity-50",
            state === "on"
              ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Globe className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{t("webSearch.label")}</span>
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="w-[min(260px,calc(100vw-24px))] max-w-[260px] overflow-hidden border border-border bg-popover p-0 text-popover-foreground shadow-xl"
        arrowClassName="bg-popover fill-popover"
      >
        {/* State-tinted gradient bar — instant visual signal of the state
            even before reading the title. Two-stop gradient on the
            on-state mirrors the pill's warm-orange → AI-violet feel. */}
        <div
          aria-hidden="true"
          data-web-search-tooltip-bar={state}
          className={cn(
            "h-[3px] w-full",
            state === "on" &&
              "bg-gradient-to-r from-primary via-primary/70 to-ai",
            state === "off" &&
              "bg-gradient-to-r from-muted-foreground/35 via-muted-foreground/20 to-muted-foreground/10",
            state === "unsupported" &&
              "bg-gradient-to-r from-destructive/70 to-destructive/30",
          )}
        />

        <div className="px-3 pt-2.5 pb-3">
          {/* Title row — title text + status pill (or no pill in the
              unsupported state, where the title alone carries it). */}
          <div className="mb-1 flex items-center justify-between gap-2">
            <p
              className="text-xs font-semibold leading-snug text-popover-foreground"
              data-web-search-tooltip-title={state}
            >
              {title}
            </p>
            {state !== "unsupported" ? (
              <span
                data-web-search-status-pill={state}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-2xs font-medium",
                  state === "on" && "bg-primary/15 text-primary",
                  state === "off" &&
                    "bg-muted text-muted-foreground/80",
                )}
              >
                {state === "on"
                  ? t("webSearch.statusOn")
                  : t("webSearch.statusOff")}
              </span>
            ) : null}
          </div>

          {/* Body — full sentence describing the state. */}
          <p
            className="text-2xs leading-relaxed text-muted-foreground"
            data-web-search-tooltip-body={state}
          >
            {body}
          </p>

          {/* Meta section — cost + provider, in both on and off states so
              the user always knows what a search costs. The unsupported
              state has nothing to bill. */}
          {showMeta ? (
            <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2">
              <div
                className="flex items-center gap-2 text-2xs"
                data-tooltip-cost-line=""
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                  <Coins className="size-2.5" aria-hidden="true" />
                </span>
                <span className="text-muted-foreground">
                  {t("webSearch.metaCost", { credits: WEB_SEARCH_CREDITS })}
                </span>
              </div>
              <p
                className="pl-6 text-3xs leading-tight text-muted-foreground/70"
                data-tooltip-cost-note=""
              >
                {t("webSearch.metaCostNote", {
                  searches: CHAT_WEB_SEARCHES_PER_REPLY,
                })}
              </p>
              <div
                className="flex items-center gap-2 text-2xs"
                data-tooltip-provider-line=""
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-ai/12 text-ai">
                  <Zap className="size-2.5" aria-hidden="true" />
                </span>
                <span className="text-muted-foreground">
                  {t("webSearch.metaProvider", { provider: "Exa" })}
                </span>
              </div>
            </div>
          ) : null}

        </div>
      </TooltipContent>
    </Tooltip>
  );
}
