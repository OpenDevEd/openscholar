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

/** Live and still-applying versions cannot be restored. */
export function canRestore(status: VersionStatus): boolean {
  return status === "previous" || status === "failed";
}
