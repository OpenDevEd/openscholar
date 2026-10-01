# Convex Bandwidth Remediation — Plan Set

Five-plan remediation of the remaining high-signal Convex bandwidth and subscription-cost issues surfaced by the codebase-wide audit on 2026-04-22.

This plan set is intentionally pragmatic:

- keep the repo on existing Convex primitives and currently-installed packages,
- fix the largest read-amplification and duplicate-subscription paths first,
- remove broad mounted queries where the UI does not need them,
- avoid new compatibility layers and dead paths.

No new npm package is justified by the current evidence. The repo already has the needed primitives in `convex`, `convex-helpers`, `@convex-dev/aggregate`, `@convex-dev/agent`, and the existing provider/query wrappers.

---

## Motivation / gap audit

Empirical state of the codebase as of 2026-04-22, verified against source, Convex docs, skill references, and runtime signals:

1. **The library page still subscribes to the full filtered library instead of a page.** [`components/library/library-page-client.tsx`](../../components/library/library-page-client.tsx) reads `api.library.queries.listLibrary` for the entire filtered corpus and then paginates locally. The query loads and sorts the full result set in memory in [`convex/library/queries.ts`](../../convex/library/queries.ts). This makes payload size scale with total library size rather than visible rows.
2. **The library count query still has a scan fallback.** [`getLibraryCount`](../../convex/library/queries.ts) is O(1) only when `users.libraryItemCount` exists; otherwise it scans `libraryItems`. That fallback should not remain on a mounted live query.
3. **Chat-mode extraction pages still pay for extraction-detail reads they do not render.** [`app/extraction/[jobId]/page.tsx`](../../app/extraction/[jobId]/page.tsx) always mounts `getJobDetails`, and [`convex/extraction/queries/jobs.ts`](../../convex/extraction/queries/jobs.ts) reads questions plus the processable paper set even when the page is in chat mode.
4. **The same chat source/inclusion corpus is read twice per turn.** The UI subscribes to the joined source set via [`convex/chat/chatPapers.ts`](../../convex/chat/chatPapers.ts), while prompt assembly independently re-reads `extractionJobSources` and included `chatPapers` in [`convex/chat/context.ts`](../../convex/chat/context.ts).
5. **Suggestion chips still read the full source payload for a count they already have.** [`components/extraction/chat/suggestion-chips.tsx`](../../components/extraction/chat/suggestion-chips.tsx) calls `getJobSources` just to compute `sources.length`, while [`components/extraction/chat/papers-context.tsx`](../../components/extraction/chat/papers-context.tsx) already exposes `totalCount`.
6. **`listThreadMessages` still performs multiple message-list reads per reactive tick.** [`convex/chat/messages.ts`](../../convex/chat/messages.ts) reads UI messages, raw messages, and synced streams together. That duplicates thread-corpus work on active chats.
7. **Billing still mounts a dead diagnostics subscription.** [`app/settings/billing/page.tsx`](../../app/settings/billing/page.tsx) subscribes to `getLatestGrantStatus` even though its only render block is commented out. The query fans out across several tables and Stripe mirror data in [`convex/credits/queries.ts`](../../convex/credits/queries.ts).
8. **The app shell still uses a rich screening-history query for a shell badge.** [`components/app-sidebar.tsx`](../../components/app-sidebar.tsx) reads `listUserScreeningJobs({ limit: 1 })`, while [`convex/screening/queries.ts`](../../convex/screening/queries.ts) resolves aggregate progress plus collection metadata and question lists. That shape is heavier than the shell needs.
9. **Repeated small subscriptions still exist across shared UI surfaces.** `useSubscriptionState`, `getMyBalance`, `getMyPaperLimit`, `listChatModels`, and `getCollectionsWithCounts` are mounted in several sibling consumers instead of being shared through a provider or parent-owned query.
10. **The AI settings model selector still mounts a live whole-catalog query.** [`app/settings/ai/page.tsx`](../../app/settings/ai/page.tsx) calls [`api.models.queries.list`](../../convex/models/queries.ts), which returns the full provider slice or full catalog and leaves filtering to the client.
11. **Runtime evidence says the next wins are query-shape and subscription-shape fixes, not more aggregate work.** `npx convex insights --details` on 2026-04-22 showed the largest pressure in workpool/workflow internals and smaller contention on `screeningJobs`/`credits`, not in missing count aggregations.

---

## Locked design decisions

Locked on 2026-04-22 from code audit, `convex-performance-audit` skill references, `npx skills find "convex performance"`, official Convex docs, Next.js local docs, and runtime signals.

| # | Decision | Why |
|---|---|---|
| **D1** | **Do not add a new npm package for this plan set.** | Existing primitives already cover the fixes. |
| **D2** | **Keep using Convex reactivity for hot collaborative/chat surfaces, but reduce query scope.** | Query splitting is the right fix for chat, not point-in-time reads. |
| **D3** | **Use cursor pagination for the mounted library surface.** | The mounted library page should no longer read the full filtered corpus. |
| **D4** | **Keep `users.libraryItemCount` as the count source of truth.** | A guaranteed denormalized counter is sufficient; a new aggregate is unnecessary. |
| **D5** | **Chat-mode extraction pages get a dedicated lightweight shell query.** | Chat pages should not pay for extraction-only questions/papers reads. |
| **D6** | **Dedupe chat source reads with a shared pure helper, not a snapshot table.** | Avoid duplicated mutable state and write amplification. |
| **D7** | **`listThreadMessages` collapses to one authoritative message-doc read plus stream sync.** | The current triple-read shape is broader than needed. |
| **D8** | **Remove mounted dead queries instead of downgrading them to “just in case” live reads.** | Dead mounted subscriptions are pure waste. |
| **D9** | **Use provider-style sharing for repeated small live state only where the subtree actually shares it.** | Avoid both duplicate subscriptions and over-globalizing app state. |
| **D10** | **Use explicit point-in-time reads for low-freshness admin/settings fetches when live updates add no value.** | This applies to export-style reads and the AI model catalog more cleanly than to chat. |
| **D11** | **Keep existing aggregate-backed counters as-is.** | Billing facet counts, screening progress, and extraction cost already use the right pattern. |
| **D12** | **No compatibility shims or legacy dual paths after cutover.** | Once a broad live query is replaced, the mounted path should be deleted. |

---

## Plan-file inventory

```text
plans/convex-bandwidth-remediation/
├── 00-README.md
├── 01-library-paginated-surface.md
├── 02-chat-shell-and-source-read-paths.md
├── 03-chat-message-read-model.md
├── 04-billing-and-screening-query-thinning.md
├── 05-shared-live-state-and-model-catalog.md
└── PROMPTS.md
```

Summary:

- **01** moves the mounted library surface onto paginated reads and removes the live count-scan fallback.
- **02** splits chat-mode page loading from extraction-detail reads and dedupes chat source/inclusion reads.
- **03** slims the thread message read model so active chats stop paying for duplicated message-list reads.
- **04** removes the dead billing diagnostics subscription and splits screening shell reads from screening history/detail reads.
- **05** consolidates repeated small subscriptions and downgrades the AI model catalog to a low-freshness point-in-time flow.

---

## Dependency graph

```text
01 library-paginated-surface ───────┐
                                    ├──► 05 shared-live-state-and-model-catalog
04 billing-and-screening-thinning ──┘

02 chat-shell-and-source-paths ───► 03 chat-message-read-model
```

Ship order recommendation: **01 → 02 → 03 → 04 → 05**.

- `01` is the largest mounted-payload fix.
- `02` removes the biggest chat/extraction read duplication before touching message streaming.
- `03` then slims the remaining chat message read shape.
- `04` is a contained settings/shell cleanup.
- `05` reuses the new provider/query-thinning patterns after the domain-specific cuts land.

---

## Reuse / DRY notes

Primary donors and existing patterns this plan set must reuse:

- **`lib/auth/use-auth-query.ts`** — already provides protected paginated queries; library should reuse it instead of inventing a new mounted data path.
- **`convex/extraction/sources/library.ts`** — existing routed paginated read over library-related data; donor for library search/browse query routing.
- **`lib/feature-flags/provider.tsx`** — donor for subtree-scoped live-state sharing via a provider backed by one query.
- **`components/extraction/chat/papers-context.tsx`** — donor for shared subtree data ownership and context shape in chat.
- **`convex/credits/aggregates.ts`, `convex/screening/aggregates.ts`, `convex/extraction/aggregates.ts`** — proof that aggregate-backed count work is already in the right place; do not replicate it where a single denormalized counter is enough.
- **`components/billing/transactions/transactions-panel-client.tsx`** — donor for explicit point-in-time export reads via `useConvex().query(...)`.
- **`app/layout.tsx` + `convex/nextjs preloadQuery`** — donor for server-preloaded state where a route truly wants server bootstrap, while remembering that preloaded queries still resume live subscriptions.
- **`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md`** — local Next.js guidance for cached/low-freshness server data. Use only where request/runtime constraints fit; do not apply it blindly to live user-specific Convex state.

Do not introduce:

- a new caching/state library,
- a new aggregate component for library counts,
- snapshot tables for chat source inclusion,
- root-global providers for data that only one subtree needs,
- “temporary” broad mounted queries kept around after cutover.

---

## Testing doctrine

Inherited from project doctrine:

- Assert on behavior, text, ARIA, and `data-*` contracts.
- Never assert on CSS classes or inline styles.
- Prefer Convex query/mutation tests and React behavior tests over implementation-shape assertions.
- Mounted surfaces that change query ownership must prove the number and shape of subscriptions indirectly through behavior and targeted mocks, not by testing class strings.

### TDD expectations by plan

- **Plan 01** — start with Convex query tests for the paginated library path and count behavior.
- **Plan 02** — start with a pure shared source-read helper test and shell-query routing tests.
- **Plan 03** — start with message-read parity tests covering failed/aborted/streaming shapes.
- **Plan 04** — start with query tests for the new screening shell shape, then page/component tests for billing cleanup.
- **Plan 05** — start with provider selector tests and low-freshness model-catalog query tests.

### Passing-test doctrine

- A plan is not complete until the named tests are green.
- If a test cannot run, say exactly why in the execution log.
- When a mounted live query is removed, add or update a test that proves the replacement path is actually the mounted one.

---

## Migration stance

Mostly additive / cleanup only.

- No schema-destructive migration is expected for this plan set.
- If `users.libraryItemCount` is missing on existing dev rows, backfill it once and then remove the live scan fallback.
- Query/API surface may be split or narrowed, but no legacy dual-read path should remain after the consuming UI is cut over.
- If dev data becomes awkward during count backfill or query-path cleanup, prefer a clean bounded helper or dev-table reset over preserving incorrect broad paths.

---

## Delegation policy

Use subagents aggressively for bounded research tasks, per repo doctrine.

Good delegation targets during execution:

- map every current consumer of a query before replacing it,
- verify the exact `@convex-dev/agent` helper available for message-doc → UI-message conversion,
- trace whether a proposed provider has a real common subtree owner,
- validate the latest official Convex docs when a plan depends on pagination/search/point-in-time semantics,
- inspect pm2 logs and `npx convex insights --details` before and after major query-shape changes.

Keep in the main session:

- TDD red → green loops,
- plan-file edits,
- commits,
- final acceptance verification.

If the session grows stale, commit progress, append a short resume note to the active plan file, and restart from the matching prompt in `PROMPTS.md`.

---

## Grounding sources

Repo sources:

- [components/library/library-page-client.tsx](../../components/library/library-page-client.tsx)
- [convex/library/queries.ts](../../convex/library/queries.ts)
- [convex/library/mutations.ts](../../convex/library/mutations.ts)
- [app/extraction/[jobId]/page.tsx](../../app/extraction/%5BjobId%5D/page.tsx)
- [convex/extraction/queries/jobs.ts](../../convex/extraction/queries/jobs.ts)
- [convex/chat/chatPapers.ts](../../convex/chat/chatPapers.ts)
- [convex/chat/context.ts](../../convex/chat/context.ts)
- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- [components/extraction/chat/papers-context.tsx](../../components/extraction/chat/papers-context.tsx)
- [components/extraction/chat/suggestion-chips.tsx](../../components/extraction/chat/suggestion-chips.tsx)
- [app/settings/billing/page.tsx](../../app/settings/billing/page.tsx)
- [lib/feature-flags/provider.tsx](../../lib/feature-flags/provider.tsx)
- [lib/auth/use-subscription-state.ts](../../lib/auth/use-subscription-state.ts)
- [components/app-sidebar.tsx](../../components/app-sidebar.tsx)
- [convex/screening/queries.ts](../../convex/screening/queries.ts)
- [app/settings/ai/page.tsx](../../app/settings/ai/page.tsx)
- [convex/models/queries.ts](../../convex/models/queries.ts)
- [app/layout.tsx](../../app/layout.tsx)
- [convex/convex.config.ts](../../convex/convex.config.ts)
- [convex/_generated/ai/guidelines.md](../../convex/_generated/ai/guidelines.md)

Skills and local guidance:

- [convex-performance-audit skill](https://github.com/get-convex/agent-skills/blob/7a6fcc6882f344577a34365fdadbd0f8f8c467d7/skills/convex-performance-audit/SKILL.md)
- [hot-path-rules reference](https://github.com/get-convex/agent-skills/blob/7a6fcc6882f344577a34365fdadbd0f8f8c467d7/skills/convex-performance-audit/references/hot-path-rules.md)
- [subscription-cost reference](https://github.com/get-convex/agent-skills/blob/7a6fcc6882f344577a34365fdadbd0f8f8c467d7/skills/convex-performance-audit/references/subscription-cost.md)
- [function-budget reference](https://github.com/get-convex/agent-skills/blob/7a6fcc6882f344577a34365fdadbd0f8f8c467d7/skills/convex-performance-audit/references/function-budget.md)
- `npx skills find "convex performance"` on 2026-04-22, which returned the already-installed `get-convex/agent-skills@convex-performance-audit` as the top match.

Current external docs consulted on 2026-04-22:

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices)
- [Convex Filters](https://docs.convex.dev/database/reading-data/filters)
- [Convex Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf)
- [Convex Pagination](https://docs.convex.dev/database/pagination)
- [Convex Realtime](https://docs.convex.dev/realtime)
- [Convex React](https://docs.convex.dev/client/react/)
- [Convex Full Text Search](https://docs.convex.dev/search/text-search)
- [Convex Agents: Messages](https://docs.convex.dev/agents/messages)
- [Convex Agents: Streaming](https://docs.convex.dev/agents/streaming)
- [Convex Next.js App Router Server Rendering](https://docs.convex.dev/client/nextjs/app-router/server-rendering)
- [Next.js `use cache` local docs](../../node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md)

Runtime sources:

- `pm2 logs convex --lines 120 --nostream` on 2026-04-22
- `npx convex insights --details` on 2026-04-22

