"use client";

import { Coins, Globe, Zap } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { modelSupportsWebSearch } from "@/lib/chat/web-search-capability";
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
  const pricing = useQuery(api.chat.messages.getChatWebSearchPricing, {
    threadId,
  });
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

  // Friendly provider name for the meta row. Returning `null` hides the
  // row entirely — we never want to show the raw "tavily-basic" slug.
  const providerLabel = (() => {
    switch (pricing?.source) {
      case "tavily-basic":
        return t("webSearch.providerTavilyBasic");
      case "openrouter-server-tool":
        return t("webSearch.providerOpenRouter");
      default:
        return null;
    }
  })();

  const showMeta = state !== "unsupported";
  const pricingResolved = pricing !== undefined;

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
          data-web-search-source={pricing?.source ?? "unsupported"}
          data-web-search-credits-estimate={String(
            pricing?.creditsPerCall ?? 0,
          )}
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
              "bg-gradient-to-r from-primary via-primary/70 to-[oklch(0.55_0.15_293)]",
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
              className="text-[12.5px] font-semibold leading-snug text-popover-foreground"
              data-web-search-tooltip-title={state}
            >
              {title}
            </p>
            {state !== "unsupported" ? (
              <span
                data-web-search-status-pill={state}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium",
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
            className="text-[11.5px] leading-relaxed text-muted-foreground"
            data-web-search-tooltip-body={state}
          >
            {body}
          </p>

          {/* Meta section — cost + provider. Shown in both on/off states
              once pricing resolves so the user always knows what each
              search costs and which provider runs it. The unsupported
              state suppresses meta entirely (nothing to bill). */}
          {showMeta ? (
            <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2">
              {pricingResolved ? (
                <>
                  <div
                    className="flex items-center gap-2 text-[11px]"
                    data-tooltip-cost-line=""
                  >
                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                      <Coins className="size-2.5" aria-hidden="true" />
                    </span>
                    <span className="text-muted-foreground">
                      {t("webSearch.metaCost", {
                        credits: pricing.creditsPerCall ?? 0,
                      })}
                    </span>
                  </div>
                  <p
                    className="pl-6 text-[10px] leading-tight text-muted-foreground/70"
                    data-tooltip-cost-note=""
                  >
                    {t("webSearch.metaCostNote")}
                  </p>
                  {providerLabel ? (
                    <div
                      className="flex items-center gap-2 text-[11px]"
                      data-tooltip-provider-line=""
                    >
                      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-[oklch(0.55_0.15_293/0.12)] text-[oklch(0.45_0.16_293)] dark:text-[oklch(0.78_0.12_293)]">
                        <Zap className="size-2.5" aria-hidden="true" />
                      </span>
                      <span className="text-muted-foreground">
                        {t("webSearch.metaProvider", {
                          provider: providerLabel,
                        })}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : (
                <div
                  className="flex items-center gap-2 text-[11px]"
                  data-tooltip-cost-loading=""
                >
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground/60">
                    <Coins className="size-2.5" aria-hidden="true" />
                  </span>
                  <span className="italic text-muted-foreground/70">
                    {t("webSearch.metaCostLoading")}
                  </span>
                </div>
              )}
            </div>
          ) : null}

        </div>
      </TooltipContent>
    </Tooltip>
  );
}
