"use client";

import type { UIMessagePart, UIDataTypes, UITools, SourceUrlUIPart } from "ai";
import { WebSourceChip } from "./web-source-chip";

export interface WebSourceChipsProps<
  DATA extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
> {
  parts: ReadonlyArray<UIMessagePart<DATA, TOOLS>>;
}

function isSourceUrlPart<
  DATA extends UIDataTypes,
  TOOLS extends UITools,
>(part: UIMessagePart<DATA, TOOLS>): part is SourceUrlUIPart {
  return part.type === "source-url";
}

export function WebSourceChips<
  DATA extends UIDataTypes = UIDataTypes,
  TOOLS extends UITools = UITools,
>({ parts }: WebSourceChipsProps<DATA, TOOLS>) {
  // Two searches in one reply can return the same page.
  const sources = [
    ...new Map(parts.filter(isSourceUrlPart).map((s) => [s.url, s])).values(),
  ];
  if (sources.length === 0) return null;
  return (
    <div
      className="mt-2 flex flex-wrap gap-1.5"
      data-web-sources-count={sources.length}
    >
      {sources.map((s, i) => (
        <WebSourceChip
          key={`${s.sourceId}-${i}`}
          url={s.url}
          title={s.title}
          idx={i}
        />
      ))}
    </div>
  );
}
