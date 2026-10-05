import { EvidenceLibrariesIcon, ExtractionIcon, FileText, Folder, LibraryIcon, ListChecks, MessagesSquare, Search, TopicsIcon, type AppIcon } from "@/components/icons";

/**
 * Each kind of record's icon, the same wherever it shows: the sidebar's where the sidebar
 * has one, then the sources of a screening or an extraction and the assistant. `tint` is
 * the assistant's alone (its step cards, chips and @ picker): a token in app/globals.css,
 * stepped for each theme. A chat is the assistant's own, so it keeps the muted colour and
 * is told apart by its icon.
 */
export const RECORD_KINDS = {
  search: { icon: Search, tint: "var(--kind-search)" },
  collection: { icon: Folder, tint: "var(--kind-collection)" },
  paper: { icon: FileText, tint: "var(--kind-paper)" },
  savedPapers: { icon: LibraryIcon, tint: "var(--kind-paper)" },
  screening: { icon: ListChecks, tint: "var(--kind-screening)" },
  extraction: { icon: ExtractionIcon, tint: "var(--kind-extraction)" },
  library: { icon: EvidenceLibrariesIcon, tint: "var(--kind-library)" },
  topic: { icon: TopicsIcon, tint: "var(--kind-topic)" },
  chat: { icon: MessagesSquare, tint: "var(--muted-foreground)" },
} satisfies Record<string, { icon: AppIcon; tint: string }>;

export type RecordKind = keyof typeof RECORD_KINDS;
