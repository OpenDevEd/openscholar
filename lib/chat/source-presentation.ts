import {
  CircleHelp,
  FlaskConical,
  Layers,
  Library,
  type LucideIcon,
} from "lucide-react";
import type { ChatSourceType } from "@/lib/chat/source-type";
import type { SourceChip } from "@/lib/chat/source-chips";

export type ChatSourcePresentationKey = SourceChip | "unknown";

export const CHAT_SOURCE_ICON: Record<ChatSourcePresentationKey, LucideIcon> = {
  all: Layers,
  openalex: FlaskConical,
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

export function iconForSource(sourceType: ChatSourceType): LucideIcon {
  return CHAT_SOURCE_ICON[sourceType];
}

export function colorVarForSource(sourceType: ChatSourceType): string {
  return CHAT_SOURCE_COLOR_VAR[sourceType];
}
