"use client";

import { useState } from "react";
import { domainInitial } from "@/lib/chat/domain-initial";
import { faviconUrl } from "@/lib/chat/favicon-url";
import { cn } from "@/lib/utils";

export interface WebSourceChipProps {
  url: string;
  title?: string;
  idx: number;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function WebSourceChip({ url, title, idx }: WebSourceChipProps) {
  const host = safeHost(url);
  const trimmed = title?.trim();
  const display = trimmed && trimmed.length > 0 ? trimmed : host;
  const [iconFailed, setIconFailed] = useState(false);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      data-source-type="web"
      data-source-host={host}
      data-icon-state={iconFailed ? "fallback" : "favicon"}
      className={cn(
        "inline-flex max-w-[20ch] items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-1 text-xs text-foreground/80",
        "transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      {iconFailed ? (
        <span
          aria-hidden="true"
          data-icon-fallback="letter"
          className="inline-flex size-3.5 items-center justify-center rounded-sm bg-foreground/10 text-[8px] font-semibold uppercase text-foreground/70"
        >
          {domainInitial(host)}
        </span>
      ) : (
        <img
          src={faviconUrl(host)}
          alt=""
          loading="lazy"
          onError={() => setIconFailed(true)}
          className="size-3.5 rounded-sm"
        />
      )}
      <span className="truncate">{display}</span>
      <span className="text-muted-foreground/70 tabular-nums">
        [{idx + 1}]
      </span>
    </a>
  );
}
