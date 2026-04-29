"use client";

import type { UIDataTypes, UIMessagePart, UITools } from "ai";

export interface StepBoundaryProps<
  DATA extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
> {
  prevPart: UIMessagePart<DATA, TOOLS> | undefined;
  nextPart: UIMessagePart<DATA, TOOLS> | undefined;
}

function isCompletedToolPart<
  DATA extends UIDataTypes,
  TOOLS extends UITools,
>(part: UIMessagePart<DATA, TOOLS> | undefined): boolean {
  if (!part) return false;
  if (!part.type.startsWith("tool-")) return false;
  return (part as { state?: string }).state === "output-available";
}

export function StepBoundary<
  DATA extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
>({ prevPart, nextPart }: StepBoundaryProps<DATA, TOOLS>) {
  const visible =
    isCompletedToolPart(prevPart) && nextPart?.type === "text";
  if (!visible) return null;
  return (
    <hr
      data-step-boundary="true"
      className="my-3 border-border/60"
      aria-hidden="true"
    />
  );
}
