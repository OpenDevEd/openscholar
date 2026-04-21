import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { extractOpenalexId } from "../../lib/billing/transactions/openalex-id";

/**
 * Idempotent backfill: promote every usage row to a typed billingType column.
 *
 * Legacy shapes this sweeps up:
 *   - metadata.billingType ∈ {batch_screening, batch_translation,
 *     extraction_llm, embedding, chat, screening} → typed column.
 *   - metadata.paperId carrying a full OpenAlex URL → metadata.openalexId
 *     with the bare W-id. Old rows also embed the URL in the description.
 *   - description === "Wallet API: …" or metadata.source === "wallet_api"
 *     → typed billingType "wallet_api" + drop metadata.source.
 *   - Description-only rows for AI writers that didn't thread a typed
 *     billingType yet (enhance search, translate query, etc).
 *
 * Re-running once every row is typed is a no-op.
 *
 * Run once via:
 *   npx convex run migrations/backfillBillingTypes:run
 */
const BILLING_TYPES = [
  "extraction_llm",
  "embedding",
  "screening",
  "chat",
  "search",
  "translation",
  "wallet_api",
] as const;

type BillingType = (typeof BILLING_TYPES)[number];

function isBillingType(value: unknown): value is BillingType {
  return typeof value === "string" && (BILLING_TYPES as readonly string[]).includes(value);
}

export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ patched: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("creditTransactions")
      .paginate({ numItems: 500, cursor: cursor ?? null });

    let patched = 0;
    for (const row of page.page) {
      const patch = buildPatch(row);
      if (!patch) continue;
      await ctx.db.patch(row._id, patch);
      patched += 1;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillBillingTypes.run,
        { cursor: page.continueCursor },
      );
    }

    return { patched, isDone: page.isDone };
  },
});

type Row = {
  type: string;
  description?: string;
  metadata?: Record<string, string>;
  billingType?: BillingType | null;
};

type Patch = {
  billingType?: BillingType;
  metadata?: Record<string, string>;
  description?: string | undefined;
};

/**
 * Writer descriptions that uniquely identify a billingType. Only entries
 * here remap typed-null rows; unknown descriptions stay untouched.
 */
const DESCRIPTION_TO_BILLING_TYPE: Readonly<Record<string, BillingType>> = {
  "AI: Generate screening questions": "screening",
  "AI: Generate screening responses": "screening",
  "AI: Generate extraction questions": "extraction_llm",
  "AI: Enhance search query": "search",
  "Enhance search query": "search",
  "AI: Translate query": "translation",
  "Translate query": "translation",
  "AI: Translate paper content": "translation",
  "Translate paper content": "translation",
};

const METADATA_BILLING_TYPE_REMAP: Readonly<Record<string, BillingType>> = {
  batch_screening: "screening",
  batch_translation: "translation",
  extraction_llm: "extraction_llm",
  embedding: "embedding",
  chat: "chat",
  screening: "screening",
  search: "search",
  translation: "translation",
  wallet_api: "wallet_api",
};

function buildPatch(row: Row): Patch | null {
  if (row.type !== "usage") return null;
  const metadata = row.metadata ?? {};
  const patch: Patch = {};
  let metadataChanged = false;
  const nextMetadata: Record<string, string> = { ...metadata };

  const metaBillingRaw = metadata.billingType;
  const metaBillingRemap = metaBillingRaw
    ? METADATA_BILLING_TYPE_REMAP[metaBillingRaw]
    : undefined;
  if (metaBillingRaw) {
    delete nextMetadata.billingType;
    metadataChanged = true;
  }

  const rawPaperRef = metadata.paperId ?? metadata.openalexId;
  if (rawPaperRef) {
    const short = extractOpenalexId(rawPaperRef) ?? rawPaperRef;
    if (metadata.paperId !== undefined) {
      delete nextMetadata.paperId;
      metadataChanged = true;
    }
    if (nextMetadata.openalexId !== short) {
      nextMetadata.openalexId = short;
      metadataChanged = true;
    }
  }

  const isWalletBySource = metadata.source === "wallet_api";
  const isWalletByDesc = !!row.description?.startsWith("Wallet API:");
  if (isWalletBySource) {
    delete nextMetadata.source;
    metadataChanged = true;
  }

  let target: BillingType | undefined;
  if (isBillingType(row.billingType ?? undefined)) {
    target = row.billingType as BillingType;
  } else if (metaBillingRemap) {
    target = metaBillingRemap;
  } else if (isWalletBySource || isWalletByDesc) {
    target = "wallet_api";
  } else if (row.description) {
    const mapped = DESCRIPTION_TO_BILLING_TYPE[row.description];
    if (mapped) target = mapped;
    else if (row.description.startsWith("Batch translation")) target = "translation";
    else if (row.description.startsWith("Batch screening")) target = "screening";
    else if (row.description.startsWith("Bulk screening")) target = "screening";
  }

  if (target && row.billingType !== target) {
    patch.billingType = target;
  }

  if (row.description && /openalex\.org/i.test(row.description)) {
    patch.description = undefined;
  }

  if (metadataChanged) {
    patch.metadata = nextMetadata;
  }

  if (
    patch.billingType === undefined &&
    patch.metadata === undefined &&
    patch.description === undefined
  ) {
    return null;
  }
  return patch;
}
