/**
 * Plain rules for the Versions section: the software update panel and the
 * version history table. Kept out of the component so they can be tested.
 */
import { cardForRow, PAGE_SECTION_KEYS, type PageSectionKey } from "./rules";

export type VersionStatus = "live" | "previous" | "failed" | "deploying";

/** The seven characters people use to name a commit. */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}

export function runtimeUpdateState({
  running,
  latest,
}: {
  running: string;
  latest: string;
}): "up-to-date" | "update-available" {
  return running === latest ? "up-to-date" : "update-available";
}

/** The page cards that show the changed rows, each once, in page order. */
export function changedCards(rows: readonly string[]): PageSectionKey[] {
  const cards = new Set<PageSectionKey>();
  for (const row of rows) {
    const card = cardForRow(row);
    if (card) cards.add(card);
  }
  return PAGE_SECTION_KEYS.filter((card) => cards.has(card));
}

/** The areas new-el files each release note under, in the order shown. */
export const RELEASE_NOTE_AREAS = [
  "search",
  "records",
  "collections",
  "sources",
  "exports",
  "appearance",
  "administration",
  "speed",
  "reliability",
] as const;
export type ReleaseNoteArea = (typeof RELEASE_NOTE_AREAS)[number];

/**
 * A note as new-el writes it, "Sources: Zotero imports keep going.", split
 * into its area and text. A note without a known area prefix keeps its text.
 */
export function splitNoteArea(note: string): {
  area: ReleaseNoteArea | null;
  text: string;
} {
  const separator = note.indexOf(":");
  if (separator > 0) {
    const prefix = note.slice(0, separator).trim().toLowerCase();
    const area = RELEASE_NOTE_AREAS.find((known) => known === prefix);
    if (area) return { area, text: note.slice(separator + 1).trim() };
  }
  return { area: null, text: note.trim() };
}

/** Live and still-applying versions cannot be restored. */
export function canRestore(status: VersionStatus): boolean {
  return status === "previous" || status === "failed";
}
