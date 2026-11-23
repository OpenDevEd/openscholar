"use client";

// A report's DOCiD where its DOI is shown (plans/identifier-services): under the DOI on its page and on a withdrawn
// report's page, drawn as the DOI is. A DOCiD is a Handle, opened on hdl.handle.net. A withdrawn report keeps it, as
// it keeps its DOI: DOCiD shows a retired page there.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { Check, Copy } from "@/components/icons";
import { copyText } from "@/components/copy-text";
import { cn } from "@/lib/utils";

export const handleUrl = (handle: string) => `https://hdl.handle.net/${handle}`;

export function DocidLine({ handle, retired = false, className }: { handle: string; /** The report was withdrawn: its DOCiD shows a retired page. */ retired?: boolean; className?: string }) {
  const t = useTranslations("paperPage");
  const tToast = useTranslations("toast");
  const [copied, setCopied] = useState(false);
  return (
    <p className={cn("mt-1 flex items-center gap-2 text-sm", className)}>
      <span className="inline-flex h-5 items-center rounded bg-inset px-1.5 text-[11px] font-semibold text-muted-foreground">DOCiD</span>
      <a href={handleUrl(handle)} target="_blank" rel="noopener noreferrer" dir="ltr" className={cn("min-w-0 truncate font-mono text-[13px] hover:text-primary hover:underline", retired && "text-muted-foreground")}>
        {handle}
      </a>
      <TooltipHint label={copied ? t("docidCopied") : t("copyDocid")}>
        {/* Each press decides the tick: a refused copy after one that worked takes it away. */}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          aria-label={t("copyDocid")}
          onClick={async () => setCopied(await copyText(handleUrl(handle), { copied: t("docidCopied"), failed: tToast("couldntCopy"), select: tToast("copyFailedDescription") }))}
        >
          {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
        </Button>
      </TooltipHint>
    </p>
  );
}
