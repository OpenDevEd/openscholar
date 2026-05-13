# Plan 06 — Backfill missing mirror validators

## Goal

Two tables actively touched by user-facing flows currently have **no** mirror validator, so any future `returns:` on a query that surfaces their raw rows has no canonical shape to point at. Backfill them under the SSOT pattern established by plans 02–05:

1. `chatPapers` — live inclusion bridge for chat-mode jobs. Toggled by the Sources panel, read at every chat stream start.
2. `chatGenerationUsages` — append-only chat-billing audit row. Read by `convex/chat/billing.ts` admin queries.

Both rows are returned (directly or indirectly) by current queries; backfilling now means every chat surface gains the same drift guarantee as the rest of the SSOT'd tables. Out-of-scope tables (see § Scope) stay orphaned — adding mirrors for tables nothing returns is YAGNI.

## Scope

- One file changed: `convex/lib/validators.ts` (the chat-related mirrors live next to the other generic mirrors; do NOT create a third validators file in `convex/chat/`).
- New exports: `chatPaperFields`, `chatPaperValidator`, `chatGenerationUsageFields`, `chatGenerationUsageValidator`, two `_check_` guards. Plus two scalar unions lifted to named exports: `chatGenerationUsageSourceValidator` and `chatGenerationUsageStatusValidator`.
- `convex/schema.ts` — replace `chatPapers: defineTable({...})` and `chatGenerationUsages: defineTable({...})` with `defineTable(xFields)` calls and import the field-objects.
- No call sites change. The new validators are not yet wired into any `returns:` — they are scaffolding. Future plans (or anyone touching the chat queries) can pin a `returns: chatPaperValidator` cheaply.

### Out of scope

Existing orphaned mirror-less tables that **no query returns the raw row of** stay orphaned:

- `models`, `featureFlags`, `billingCustomers`, `stripeEventLogs`, `auditLogs`
- `walletAllowedOrigins`, `walletKeys`, `apiKeys`
- `zoteroConnections`, `zoteroOAuthTokens`
- `extractionJobSources`
- `screeningJobs`, `screeningResults`
- `libraryItems`, `collections`, `libraryItemCollections`
- `userResourceLocks`

Adding mirrors for these is a no-value refactor until a query needs to surface them. The SSOT pattern is opt-in per-table at the moment a query starts returning the row — when that happens, the migration is mechanical (lift the schema's `defineTable({...})` argument into a `xFields` constant, add the `v.object({_id, _creationTime, ...xFields})` mirror, add the `_check_` guard, swap the schema). The pattern is the contract; the rollout is bounded by actual use.

## Design

### Commit 1: `chatPapers`

Trivial three-field row. Lives at `convex/lib/validators.ts` next to `userFields` / `creditsFields`.

```ts
export const chatPaperFields = {
  jobId: v.id("extractionJobs"),
  sourceId: v.id("extractionJobSources"),
  included: v.boolean(),
};

export const chatPaperValidator = v.object({
  _id: v.id("chatPapers"),
  _creationTime: v.number(),
  ...chatPaperFields,
});

const _check_chatPaperValidator: AssertExactDoc<
  "chatPapers",
  typeof chatPaperValidator
> = true;
```

Schema swap (schema.ts:584-592 → field-object + indexes):

```ts
// convex/schema.ts
import { chatPaperFields } from "./lib/validators";

chatPapers: defineTable(chatPaperFields)
  .index("by_job", ["jobId"])
  .index("by_job_included", ["jobId", "included"])
  .index("by_job_source", ["jobId", "sourceId"])
  .index("by_source", ["sourceId"]),
```

The existing `chatSourcesSnapshotValidator` (convex/chat/sourceReadModel.ts:62) is a JOIN shape — it carries `chatPaperId`, `sourceId`, denormalized title/authors/etc from `extractionJobSources`. It is NOT a mirror of `chatPapers` and stays unchanged. The new `chatPaperValidator` is the row-mirror; the snapshot is the read-model projection. Two different validators, two different surfaces.

### Commit 2: `chatGenerationUsages`

Larger row (~25 fields) with two literal unions and ten optional metric fields. Lives at `convex/lib/validators.ts` after `chatPaperFields`.

```ts
export const chatGenerationUsageSourceValidator = v.union(
  v.literal("openrouter_response_id"),
  v.literal("sdk_usage"),
  v.literal("openrouter_generation_api"),
);

export const chatGenerationUsageStatusValidator = v.union(
  v.literal("captured"),
  v.literal("retrying"),
  v.literal("billed"),
  v.literal("failed"),
);

export const chatGenerationUsageFields = {
  generationId: v.string(),
  jobId: v.id("extractionJobs"),
  threadId: v.string(),
  userId: v.id("users"),
  requestedModel: v.optional(v.string()),
  authoritativeModel: v.optional(v.string()),
  providerName: v.optional(v.string()),
  source: chatGenerationUsageSourceValidator,
  status: chatGenerationUsageStatusValidator,
  cancelled: v.optional(v.boolean()),
  finishReason: v.optional(v.string()),
  nativeFinishReason: v.optional(v.string()),
  promptTokens: v.optional(v.number()),
  completionTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedPromptTokens: v.optional(v.number()),
  totalCostUsd: v.optional(v.number()),
  billedCredits: v.optional(v.number()),
  attemptCount: v.number(),
  lastAttemptAt: v.optional(v.number()),
  nextRetryAt: v.optional(v.number()),
  authoritativeAt: v.optional(v.number()),
  billedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const chatGenerationUsageValidator = v.object({
  _id: v.id("chatGenerationUsages"),
  _creationTime: v.number(),
  ...chatGenerationUsageFields,
});

const _check_chatGenerationUsageValidator: AssertExactDoc<
  "chatGenerationUsages",
  typeof chatGenerationUsageValidator
> = true;
```

Schema swap (schema.ts:489-530 → field-object + indexes):

```ts
// convex/schema.ts
import {
  chatPaperFields,
  chatGenerationUsageFields,
} from "./lib/validators";

chatGenerationUsages: defineTable(chatGenerationUsageFields)
  .index("by_generation_id", ["generationId"])
  .index("by_job", ["jobId"])
  .index("by_thread", ["threadId"])
  .index("by_status_and_next_retry", ["status", "nextRetryAt"])
  .index("by_user_and_createdAt", ["userId", "createdAt"]),
```

The two literal unions become named exports because (a) they're conceptually closed, (b) they're the kind of union that grows over time and a future addition needs to land in one place, and (c) `convex/chat/billing.ts` already conditionally checks `usage.status === "billed"` — a named export gives that check a typed import handle if it ever needs to compare against the full set.

## TDD sequence

1. **Commit 1 (chatPapers)**:
   - R: omit `included` from `chatPaperFields`. `npx tsc --noEmit` errors on `_check_chatPaperValidator` with the validator-narrower message. Restore.
   - G: clean.
   - Test: `convex/chat/chatPapers.test.ts`, `convex/chat/chatPapersLifecycle.test.ts`, `convex/chat/chatPapersSeed.test.ts`, `convex/chat/chatPapersDuplicate.test.ts` — all green. None of them is touched directly; the field-object refactor must not break runtime shape.

2. **Commit 2 (chatGenerationUsages)**:
   - R: omit `attemptCount`. `tsc` errors. Restore.
   - G: clean.
   - Test: `convex/chat/billing.integration.test.ts` — green. (No other test directly targets `chatGenerationUsages`; the integration test exercises the row writer.)

## Files touched

- `convex/lib/validators.ts:1-137` — add `chatPaperFields`, `chatGenerationUsageSourceValidator`, `chatGenerationUsageStatusValidator`, `chatGenerationUsageFields`, two row mirrors, two `_check_` guards.
- `convex/schema.ts:489-592` — two schema swaps. Indexes preserved verbatim.

## Migration stance

Pure refactor. Both row shapes are byte-identical before and after. The two new literal unions match the inline unions verbatim — the only structural change is the indirection.

- No dev DB action.
- No call-site changes.
- No `returns:` widening or narrowing (the validators are not yet wired into any function).

## Test plan

- `npx tsc --noEmit` clean after each commit.
- `npx vitest run convex/chat` green after each commit.
- Full `npx vitest run` green after the final commit.
- Manual drift test (R-step) performed once per commit and reverted before each green commit.

## Deployability gate

After EACH of the two commits:

- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`.
- No `✖ Error`. No `Schema validator complaint`.
- Spot check after commit 2: in the convex dashboard, open `chatGenerationUsages` and confirm at least one row still has the same key set (no schema-validator complaint means it passed, but eyeballing one row confirms the shape lift was byte-identical).

## Acceptance criteria

- `chatPaperFields`, `chatPaperValidator`, `chatGenerationUsageFields`, `chatGenerationUsageValidator` exported from `convex/lib/validators.ts`.
- `chatGenerationUsageSourceValidator`, `chatGenerationUsageStatusValidator` exported.
- Two `_check_xValidator: AssertExactDoc<...> = true;` guards present.
- `convex/schema.ts` imports the two field-objects and uses `defineTable(xFields)` for both tables.
- `npx tsc --noEmit` clean.
- pm2 deployability gate green after each commit.
- All `convex/chat` tests green.

## Known pitfalls

- **`chatSourcesSnapshotValidator` is NOT a mirror of `chatPapers`** — it's the shape returned by `listChatSourcesWithInclusion` after the JOIN with `extractionJobSources`. Do not delete it, do not rewrite it to spread `chatPaperFields` — those are different shapes serving different consumers. The two coexist.
- **Two literal unions are intentionally separate**: `chatGenerationUsageSourceValidator` (where the usage data came from) and `chatGenerationUsageStatusValidator` (lifecycle state). Do not merge them.
- **`attemptCount: v.number()` is NOT optional** — both in the schema and the field-object. Match it. If you write `v.optional(v.number())` to be "safe", the validator widens past the schema and `AssertExactDoc` collapses to the validator-wider literal.
- **`lastError: v.optional(v.string())`** — the chat-usage row stores `lastError` as a string, not as a `structuredErrorValidator`. The chat-usage path predates the structured-error taxonomy and stays as a raw string. If a future plan unifies them, the field-object is the place to do it once.
- **Schema imports**: after this plan, `convex/schema.ts` imports `chatPaperFields` and `chatGenerationUsageFields` from `./lib/validators` alongside the plan-03 imports (`userFields`, `creditsFields`, `subscriptionFields`, `creditTransactionFields`, `billingTypeValidator`). One import block at the top of `schema.ts`.
- **Do NOT pre-emptively wire `returns: chatPaperValidator`** anywhere as part of this plan. The validators are scaffolding. Wiring them into a `returns:` is a separate commit (and arguably a separate plan) because it changes the wire contract.
