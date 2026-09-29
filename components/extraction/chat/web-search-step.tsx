"use client";

import type { ToolUIPart } from "ai";
import { Source } from "@/components/ai-elements/sources";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { formatSearchCostLabel } from "@/lib/chat/format-search-cost";
import {
  pickWebSearchPricing,
  type WebSearchPath,
  type WebSearchPricing,
} from "@/lib/pricing";

interface WebSearchStepProps {
  part: ToolUIPart;
  /** A stopped message leaves its in-flight search stopped, not running. */
  aborted?: boolean;
  /** The thread's web-search path, for the credit estimate while the call runs. */
  webSearchSource?: WebSearchPricing["source"];
  /** Native web-search USD price, set only on the openrouter-native path. */
  modelWebSearchPriceUsd?: number | null;
}

type WebSource = { url: string; title?: string };

function readOutput(part: ToolUIPart): {
  sources: WebSource[];
  creditsUsed?: number;
} {
  if (part.state !== "output-available") return { sources: [] };
  const output = part.output as
    | { sources?: unknown; creditsUsed?: unknown }
    | undefined;
  return {
    sources: Array.isArray(output?.sources)
      ? (output.sources as WebSource[])
      : [],
    creditsUsed:
      typeof output?.creditsUsed === "number" ? output.creditsUsed : undefined,
  };
}

function sourceToPath(
  source: WebSearchPricing["source"] | undefined,
): WebSearchPath {
  if (source === "tavily-basic") return "tavily";
  if (source === "openrouter-native" || source === "openrouter-server-tool") {
    return "openrouter";
  }
  return null;
}

function title(part: ToolUIPart, query: string, stopped: boolean): string {
  if (stopped) return "Search stopped";
  if (part.state === "output-error") return "Web search failed";
  if (part.state === "input-streaming" || !query) return "Searching the web";
  return `Web search: ${query}`;
}

export function WebSearchStep({
  part,
  aborted,
  webSearchSource,
  modelWebSearchPriceUsd,
}: WebSearchStepProps) {
  const inFlight =
    part.state === "input-streaming" || part.state === "input-available";
  const stopped = Boolean(aborted) && inFlight;
  const input = part.input as { query?: unknown } | undefined;
  const query = typeof input?.query === "string" ? input.query : "";
  const { sources, creditsUsed } = readOutput(part);
  const pricing = pickWebSearchPricing({
    path: sourceToPath(webSearchSource),
    modelWebSearchPriceUsd: modelWebSearchPriceUsd ?? null,
  });
  const costLabel = formatSearchCostLabel({
    creditsUsed,
    estimate: {
      source: pricing.source,
      creditsPerCall: pricing.creditsPerCall,
    },
  });

  return (
    <Tool
      data-tool-name={part.type.slice("tool-".length)}
      data-tool-state={stopped ? "aborted" : part.state}
    >
      <ToolHeader
        type={part.type}
        state={stopped ? "output-denied" : part.state}
        title={title(part, query, stopped)}
      />
      <ToolContent className="space-y-3 pt-0 text-sm">
        {sources.length > 0 ? (
          <ul className="flex flex-col gap-2 text-primary">
            {sources.map((source) => (
              <li key={source.url}>
                <Source href={source.url} title={source.title || source.url} />
              </li>
            ))}
          </ul>
        ) : null}
        {part.state === "output-error" && part.errorText ? (
          <p className="text-destructive" role="alert">
            {part.errorText}
          </p>
        ) : null}
        {costLabel ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            {costLabel}
          </p>
        ) : null}
      </ToolContent>
    </Tool>
  );
}
