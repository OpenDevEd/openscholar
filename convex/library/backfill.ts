"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { openAlexUrl } from "../../lib/openalex/request-url";

const BATCH_SIZE = 25;
const DELAY_BETWEEN_REQUESTS_MS = 100; // Respect OpenAlex rate limits

/**
 * Fetch a batch of library items missing paperData and backfill them
 * by fetching full Work data from the OpenAlex API.
 */
export const backfillPaperData = internalAction({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Get a batch of items missing paperData
    const batch = await ctx.runMutation(
      internal.library.backfillMutations.getItemsMissingPaperData,
      { limit: BATCH_SIZE, cursor: args.cursor },
    );

    if (batch.items.length === 0) {
      console.log("[Backfill] No more items to backfill. Done!");
      return;
    }

    console.log(
      `[Backfill] Processing ${batch.items.length} items...`,
    );

    let successCount = 0;
    let failCount = 0;

    for (const item of batch.items) {
      try {
        // Extract the Work ID from the full OpenAlex URL
        // e.g., "https://openalex.org/W1234567890" -> "W1234567890"
        const workId = item.openalexId.includes("/")
          ? item.openalexId.split("/").pop()!
          : item.openalexId;

        const response = await fetch(openAlexUrl(`works/${workId}`));

        if (!response.ok) {
          console.warn(
            `[Backfill] Failed to fetch ${item.openalexId}: ${response.status}`,
          );
          failCount++;
          continue;
        }

        const work = await response.json();

        // Patch the document with the full paperData
        await ctx.runMutation(
          internal.library.backfillMutations.patchPaperData,
          {
            itemId: item._id,
            paperData: JSON.stringify(work),
          },
        );

        successCount++;

        // Respect rate limits
        await new Promise((resolve) =>
          setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS),
        );
      } catch (error) {
        console.error(
          `[Backfill] Error processing ${item.openalexId}:`,
          error,
        );
        failCount++;
      }
    }

    console.log(
      `[Backfill] Batch complete: ${successCount} success, ${failCount} failed`,
    );

    // Schedule next batch if there are more items
    if (batch.hasMore) {
      await ctx.scheduler.runAfter(
        1000, // 1 second delay between batches
        internal.library.backfill.backfillPaperData,
        { cursor: batch.nextCursor },
      );
    } else {
      console.log("[Backfill] All items processed!");
    }
  },
});
