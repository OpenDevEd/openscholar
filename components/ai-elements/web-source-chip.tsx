"use client";

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
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      data-source-type="web"
      data-source-host={host}
      className={cn(
        "inline-flex max-w-[20ch] items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-1 text-xs text-foreground/80",
        "transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      <img
        src={faviconUrl(host)}
        alt=""
        loading="lazy"
        className="size-3.5 rounded-sm"
      />
      <span className="truncate">{display}</span>
      <span className="text-muted-foreground/70 tabular-nums">
        [{idx + 1}]
      </span>
    </a>
  );
}
