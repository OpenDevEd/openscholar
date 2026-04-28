import type { ComponentType, CSSProperties } from "react";
import { CircleHelp, Layers, Library } from "lucide-react";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import type { ChatSourceType } from "@/lib/chat/source-type";
import type { SourceChip } from "@/lib/chat/source-chips";

export type ChatSourcePresentationKey = SourceChip | "unknown";

export type ChatSourceIconComponent = ComponentType<{
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export const CHAT_SOURCE_ICON: Record<
  ChatSourcePresentationKey,
  ChatSourceIconComponent
> = {
  all: Layers,
  openalex: OpenAlexIcon,
  zotero: Library,
  unknown: CircleHelp,
};

export const CHAT_SOURCE_COLOR_VAR: Record<
  ChatSourcePresentationKey,
  string
> = {
  all: "--muted-foreground",
  openalex: "--chart-2",
  zotero: "--chart-4",
  unknown: "--chart-3",
};

export function iconForSource(
  sourceType: ChatSourceType,
): ChatSourceIconComponent {
  return CHAT_SOURCE_ICON[sourceType];
}

export function colorVarForSource(sourceType: ChatSourceType): string {
  return CHAT_SOURCE_COLOR_VAR[sourceType];
}

export type RowMetaInput = {
  venueName?: string | null;
  workType?: string | null;
  citedByCount?: number | null;
};

/**
 * Pure builder for the secondary metadata strip rendered under the
 * author/year line in each chat source row. Returns the segments in
 * stable order — venue, work type, citation count — dropping any
 * field that is null / undefined / empty. The caller joins them with
 * the visual separator (currently " · "). 0 is preserved for
 * citedByCount as real signal (never-cited paper, distinct from
 * "unknown").
 */
export function buildRowMetaSegments(
  input: RowMetaInput,
  citesLabel: (count: number) => string,
): string[] {
  const segments: string[] = [];
  if (input.venueName && input.venueName.trim().length > 0) {
    segments.push(input.venueName.trim());
  }
  if (input.workType && input.workType.trim().length > 0) {
    segments.push(input.workType.trim());
  }
  if (typeof input.citedByCount === "number") {
    segments.push(citesLabel(input.citedByCount));
  }
  return segments;
}
