"use client";

import { Globe } from "lucide-react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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

  const tooltipText = !supported
    ? t("webSearch.tooltipUnsupported")
    : enabled
      ? t("webSearch.tooltipOn")
      : t("webSearch.tooltipOff");

  const ariaLabel = enabled
    ? t("webSearch.ariaDisable")
    : t("webSearch.ariaEnable");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={enabled}
          aria-label={ariaLabel}
          disabled={disabled}
          data-action="toggle-web-search"
          data-web-search-enabled={String(enabled)}
          data-web-search-supported={String(supported)}
          className={cn(
            "h-7 gap-1.5 rounded-full px-2 text-xs font-medium",
            enabled
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          onClick={() => {
            void setWebSearch({ threadId, enabled: !enabled });
          }}
        >
          <Globe className="size-3.5" />
          <span className="hidden sm:inline">{t("webSearch.label")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
