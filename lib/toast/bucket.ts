"use client";

import { toast } from "sonner";
import type { AddManyResult, AllClearSnapshot } from "@/lib/store/bucket";

/**
 * Single source of truth for the "N added · M already in bucket · K
 * dropped" sentence. Every `bucket.addMany` call site funnels through
 * here so the wording stays consistent; the `truncated` flag surfaces
 * when a server-side select-all-across was clipped to the per-user
 * paper limit before it even reached the client.
 */
/**
 * @param opts.silent — when true, suppress the toast on the pure happy
 *   path (`added > 0`, no dedup/cap/truncation). Use on single-row
 *   toggles and per-file bulk upload, where the checkbox state + row UI
 *   already communicate the add — but do surface dedup/cap/truncation,
 *   which are the user-invisible outcomes that made silence a bug.
 */
export function bucketAdded(
  result: AddManyResult & { truncated?: boolean },
  opts?: { silent?: boolean },
): void {
  const { added, deduped, capped, truncated = false } = result;
  const notable = deduped > 0 || capped > 0 || truncated;
  if (opts?.silent && !notable) return;
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (deduped > 0) parts.push(`${deduped} already in bucket`);
  if (capped > 0) parts.push(`${capped} dropped — bucket is full`);
  if (truncated) parts.push("capped at your plan limit");
  const message = parts.join(" · ") || "Nothing new to stage";
  if (capped > 0 && added === 0) {
    toast.error(message);
    return;
  }
  toast.success(message);
}

/**
 * Clear-all undo toast. The snapshot lives in the callback closure,
 * not the store, so rows staged during the 5s undo window get dropped
 * on Undo click — restore means "bring back what was cleared", not
 * "merge".
 */
export function bucketCleared(
  clearedCount: number,
  snapshot: AllClearSnapshot,
  restore: (snap: AllClearSnapshot) => void,
): void {
  const noun = clearedCount === 1 ? "paper" : "papers";
  toast(`Cleared ${clearedCount} ${noun} from the bucket`, {
    duration: 5000,
    action: {
      label: "Undo",
      onClick: () => restore(snapshot),
    },
  });
}
