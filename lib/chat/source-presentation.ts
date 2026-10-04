import type { ComponentType, CSSProperties } from "react";
import { CircleHelp, Layers } from "@/components/icons";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
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
  zotero: ZoteroIcon,
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
