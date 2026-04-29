"use client";

import type { ToolUIPart } from "ai";
import { AlertCircle, Check, CircleSlash, Globe } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { formatSearchCostLabel } from "@/lib/chat/format-search-cost";
import { cn } from "@/lib/utils";

const SEARCH_COST_DEFAULTS = {
  creditsPerSearchEstimate: 3,
  costUsdEstimate: 0.02,
} as const;

export interface ToolStepProps {
  part: ToolUIPart;
  /** Outer message status. When the message aborted/failed and the tool is
   * still in flight, the chip flips to a muted "aborted" variant. */
  messageStatus?: "pending" | "streaming" | "success" | "failed";
  aborted?: boolean;
}

type DisplayState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "output-denied"
  | "aborted";

function getToolName(part: ToolUIPart): string {
  return part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : part.type;
}

function isInFlight(state: ToolUIPart["state"]): boolean {
  return state === "input-streaming" || state === "input-available";
}

function getDisplayState(
  part: ToolUIPart,
  aborted?: boolean,
): DisplayState {
  if (aborted && isInFlight(part.state)) return "aborted";
  if (
    part.state === "approval-requested" ||
    part.state === "approval-responded"
  ) {
    return "input-available";
  }
  return part.state as DisplayState;
}

function readQuery(part: ToolUIPart): string {
  const input = (part as { input?: unknown }).input;
  if (input && typeof input === "object" && "query" in input) {
    const q = (input as { query?: unknown }).query;
    if (typeof q === "string") return q;
  }
  return "";
}

function readResultsCount(part: ToolUIPart): number {
  if (part.state !== "output-available") return 0;
  const output = (part as { output?: unknown }).output;
  if (output && typeof output === "object" && "sources" in output) {
    const s = (output as { sources?: unknown }).sources;
    if (Array.isArray(s)) return s.length;
  }
  return 0;
}

function readCreditsUsed(part: ToolUIPart): number | undefined {
  if (part.state !== "output-available") return undefined;
  const output = (part as { output?: unknown }).output;
  if (output && typeof output === "object" && "creditsUsed" in output) {
    const c = (output as { creditsUsed?: unknown }).creditsUsed;
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return undefined;
}

function readErrorText(part: ToolUIPart): string | null {
  if (part.state !== "output-error") return null;
  const e = (part as { errorText?: unknown }).errorText;
  return typeof e === "string" ? e : null;
}

function StateIcon({
  display,
  className,
}: {
  display: DisplayState;
  className?: string;
}) {
  switch (display) {
    case "output-available":
      return (
        <Check
          aria-hidden="true"
          className={cn("size-3.5 text-emerald-600", className)}
        />
      );
    case "output-error":
      return (
        <AlertCircle
          aria-hidden="true"
          className={cn("size-3.5 text-destructive", className)}
        />
      );
    case "output-denied":
    case "aborted":
      return (
        <CircleSlash
          aria-hidden="true"
          className={cn("size-3.5 text-muted-foreground", className)}
        />
      );
    case "input-available":
      return (
        <Globe
          aria-hidden="true"
          className={cn(
            "size-3.5 animate-pulse text-muted-foreground",
            className,
          )}
        />
      );
    case "input-streaming":
    default:
      return (
        <Globe
          aria-hidden="true"
          className={cn("size-3.5 text-muted-foreground", className)}
        />
      );
  }
}

function StateLabel({
  display,
  query,
  resultsCount,
}: {
  display: DisplayState;
  query: string;
  resultsCount: number;
}) {
  switch (display) {
    case "input-streaming":
      return <Shimmer as="span">Searching the web…</Shimmer>;
    case "input-available":
      return (
        <span>
          Searching: <em className="not-italic font-normal">{query}</em>
        </span>
      );
    case "output-available":
      return (
        <span>
          Found {resultsCount} result{resultsCount === 1 ? "" : "s"} for:{" "}
          <em className="not-italic font-normal">{query}</em>
        </span>
      );
    case "output-error":
      return <span>Web search failed</span>;
    case "output-denied":
      return <span>Web search denied</span>;
    case "aborted":
      return <span>Search stopped</span>;
    default:
      return null;
  }
}

export function ToolStep({ part, aborted }: ToolStepProps) {
  const display = getDisplayState(part, aborted);
  const toolName = getToolName(part);
  const query = readQuery(part);
  const resultsCount = readResultsCount(part);
  const creditsUsed = readCreditsUsed(part);
  const errorText = readErrorText(part);
  const inFlight =
    display === "input-streaming" || display === "input-available";

  return (
    <div
      data-testid="tool-step"
      data-tool-name={toolName}
      data-tool-state={display}
      role={inFlight ? "status" : undefined}
      aria-live={display === "input-streaming" ? "polite" : undefined}
      aria-atomic="true"
      className={cn(
        "my-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm",
        display === "output-error" && "border-destructive/30 bg-destructive/5",
        (display === "output-denied" || display === "aborted") &&
          "border-border/50 bg-muted/20 text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-2">
        <StateIcon display={display} />
        <span className="min-w-0 truncate font-medium">
          <StateLabel
            display={display}
            query={query}
            resultsCount={resultsCount}
          />
        </span>
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {formatSearchCostLabel({
            creditsUsed,
            ...SEARCH_COST_DEFAULTS,
          })}
        </span>
      </div>
      {display === "output-error" && errorText ? (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
