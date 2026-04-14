# Codebase Concerns

**Analysis Date:** 2026-04-14

## Tech Debt

**Duplicate debug query files:**
- Issue: Two near-identical files expose the same "show recent extractionPapers" debug query under different names. `convex/debug.ts` exports `debugRecentPapers` (10 papers); `convex/debug_papers.ts` exports `recent` (5 papers) with a commented-out `// retryCount: p.retries,` field referencing a removed schema column.
- Files: `convex/debug.ts`, `convex/debug_papers.ts`
- Impact: DRY violation, dead/commented code shipped to production, two surfaces to maintain for the same purpose.
- Fix approach: Delete both files (debug-only internalQueries should not live in production source) or consolidate into a single `convex/internal/debugRecentPapers.ts` and remove the commented field.

**Legacy migration ladder in Zustand persist store:**
- Issue: The search history store carries a 7-step migration chain (`version: 7`) from initial release. The project mandate is "I am NOT interested in legacy behavior." The migration helper `migrateSearchHistoryState` handles every historical shape from version 0 through 6, plus an inline `migrateSearchResult` rewriter.
- Files: `lib/store.ts:184-293`, `lib/store.ts:505-523`, `lib/store.ts:577-578`, `lib/store.ts:768-769`, `lib/store.ts:827-828`
- Impact: Three separate persist stores in one file each carry their own migrate function and version counter; cognitive overhead, dead code paths, and indirect bugs whenever a developer touches the store shape.
- Fix approach: Drop all migrations, bump version to 1, and let stale localStorage payloads be discarded. Pre-launch project — no users to preserve state for.

**Custom UUID polyfill for "older mobile browsers":**
- Issue: `lib/store.ts:21-32` defines a UUID v4 fallback using `'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(...)` because `crypto.randomUUID` is "missing on older mobile browsers."
- Files: `lib/store.ts:21-32`
- Impact: Insecure RNG path (Math.random fallback inside the polyfill), maintenance burden, conflict with the no-legacy mandate. Modern Safari/Chrome on iOS/Android have shipped `crypto.randomUUID` for years.
- Fix approach: Delete the polyfill. Call `crypto.randomUUID()` directly. If a target browser truly lacks it, fail loudly.

**Legacy error-resolver layer:**
- Issue: `lib/toast/error-resolver.ts` exports `LEGACY_CODE_MATCHERS`, `sanitizeLegacyConvexMessage`, and `inferLegacyCode` to translate legacy Convex error messages into modern codes. Project rule says we ship no legacy compatibility.
- Files: `lib/toast/error-resolver.ts:48-50`, `lib/toast/error-resolver.ts:173-205`, `lib/toast/error-resolver.ts:225-226`, `tests/toast-error-resolver.test.ts`
- Impact: Pre-testing project carrying compatibility shims for errors that the same codebase emits — should be unified at the throw site instead.
- Fix approach: Standardize on structured error codes from the throw site (Convex `ConvexError` with shape `{ code, message }`), delete the regex-based matcher, simplify the resolver.

**Legacy pdfjs build import:**
- Issue: `convex/extraction/pdfjs_extract.ts:29` does `await import("pdfjs-dist/legacy/build/pdf.mjs")`. Already flagged in `.planning/milestones/v2.5-phases/52-cleanup-organization/52-01-PLAN.md:78` but not yet acted on.
- Files: `convex/extraction/pdfjs_extract.ts:29`
- Impact: Locks the project to the legacy pdfjs bundle, which has known performance and worker-thread differences from the modern build. Slower extractions, larger bundle.
- Fix approach: Switch to the modern pdfjs build (`pdfjs-dist/build/pdf.mjs`), validate worker compatibility under Convex node actions, run extraction smoke tests.

**Lazy backfill for "legacy completed jobs":**
- Issue: `convex/extraction/mutations.ts:959-961` schedules `backfillJobStats` for "legacy completed jobs without stats." The backfill function itself lives at `convex/extraction/mutations.ts:1230-1234`.
- Files: `convex/extraction/mutations.ts:959-961`, `convex/extraction/mutations.ts:1230-1234`
- Impact: Production read paths still defend against rows missing `stats`, meaning every read carries an extra branch for jobs that should not exist in a pre-launch project.
- Fix approach: Run the backfill once, then delete the lazy-backfill scheduler call and assert non-null `stats` in the read path.

**Cascade-delete uses `pdfProcessingPool.cancelAll(ctx)`:**
- Issue: `convex/extraction/mutations.ts:274-281` cancels every pending workpool item across every job, not only the items belonging to the cancelled job. The inline comment acknowledges this and relies on a downstream "credit-guard" check to refund/skip incorrectly-targeted items.
- Files: `convex/extraction/mutations.ts:274-281`
- Impact: Every call to cancel one extraction job kicks every other in-flight job in the head, increasing latency and risk of misbilling. Fragile — the credit-guard is a workaround, not a fix.
- Fix approach: Track per-job workpool item IDs in the schema; iterate `workpool.cancel(itemId)` on the targeted set only.

**Legacy chunk formatter still exported:**
- Issue: `convex/extraction/chunking.ts:251` still exports a "Format chunk for legacy display" helper.
- Files: `convex/extraction/chunking.ts:251`
- Impact: Dead code path; downstream callers may use the legacy formatter when the modern path exists.
- Fix approach: Remove the legacy formatter and update any callers.

**`renderItem` legacy code path in command center:**
- Issue: `components/command-center/command-center-list.tsx:17` comment: "Use ItemComponent for proper reconciliation; renderItem is legacy." Both code paths remain active.
- Files: `components/command-center/command-center-list.tsx:17`
- Impact: Two rendering APIs maintained side-by-side; reconciliation bugs surface only on the legacy path.
- Fix approach: Migrate every caller to `ItemComponent`, delete `renderItem`.

**Deprecated `label` field in search types:**
- Issue: `lib/types/search.types.ts:78` keeps a `/** @deprecated Use key with translations instead */` field.
- Files: `lib/types/search.types.ts:78`
- Impact: TypeScript still admits the deprecated shape; new code can keep using it.
- Fix approach: Remove the field, fix any callers that still set it.

**Deprecated `stats` prop in `<PageHeader>`:**
- Issue: `components/ui/page-header.tsx:26` declares a `Statistics to display (number and label) - deprecated, will be ignored` prop.
- Files: `components/ui/page-header.tsx:26`
- Impact: Public component API leaks an inert prop that does nothing. Every consumer that still passes it is wrong but receives no warning.
- Fix approach: Remove the prop from the interface and from any caller still passing it.

**`"use no memo"` opt-out from React Compiler in 19 components:**
- Issue: 19 component files (including `components/app-sidebar.tsx`, `app/settings/billing/page.tsx`, `components/Pricing.tsx`, every PDF/extraction-related component, search-command-center variants) opt out of React Compiler with `"use no memo"`.
- Files: `components/app-sidebar.tsx`, `app/settings/ai/page.tsx`, `app/settings/billing/page.tsx`, `components/Pricing.tsx`, `components/search-command-center/search-command-footer.tsx`, `components/ui/calendar.tsx`, `components/search-command-center/search-mode.tsx`, `components/search-command-center/screening-expansion.tsx`, `components/search-command-center/adjust-mode.tsx`, `components/providers/convex-provider.tsx`, `components/history-command-center/index.tsx`, `components/extraction/review-queue.tsx`, `components/extraction/report-builder.tsx`, `components/extraction/question-builder.tsx`, `components/extraction/pdf-viewer.tsx`, `components/extraction/manual-items.tsx`, `components/extraction/job-creator.tsx`, `components/bookmarks-command-center/bookmarks-guide.tsx`, `components/PageContent.tsx`
- Impact: Almost every heavy interactive surface skips compiler optimizations. Defeats the purpose of enabling `babel-plugin-react-compiler`.
- Fix approach: For each file, audit the offending pattern (typically `try/finally` in event handlers, refs touched during render, mutation in render), refactor to compiler-safe shape, remove the directive.

**119 occurrences of `any` in source (excluding generated):**
- Issue: 119 `any` usages across 18 source files. Hot spots: `components/extraction/stacked-answer-bars.tsx` (4), `tests/extraction/workflow-cancel.test.ts` (4), `components/extraction/insights-question-panel.tsx` (2), and many extraction-component files cast `useTranslations` to `any`.
- Files: `components/extraction/insights-question-panel.tsx`, `components/extraction/stacked-answer-bars.tsx`, `components/extraction/disagreement-list.tsx`, `components/extraction/grouped-answer-row.tsx`, `components/extraction/confidence-badge.tsx`, `components/extraction/insights-overview.tsx`, `components/extraction/summary-cards.tsx`, `components/extraction/question-list-item.tsx`, `lib/filters/filter-builder.ts`, `lib/search/initializer.tsx`, `convex/extraction/chunking.ts`, `convex/extraction/workpoolActions.ts`
- Impact: Type safety holes concentrated in the extraction UI — the most data-dense and bug-sensitive feature in the app.
- Fix approach: Use `next-intl`'s typed `t` helper (`useTranslations<NamespaceKey>`) instead of casting; introduce explicit row/answer types instead of `any[]`.

**`eslint-disable` scattered through extraction UI and library:**
- Issue: 13 source files contain `eslint-disable` comments. The extraction UI accounts for 7 of them.
- Files: `components/library/collection-manager.tsx`, `components/extraction/summary-cards.tsx`, `components/extraction/stacked-answer-bars.tsx`, `components/extraction/insights-question-panel.tsx`, `components/extraction/insights-overview.tsx`, `components/extraction/grouped-answer-row.tsx`, `components/extraction/disagreement-list.tsx`, `components/extraction/confidence-badge.tsx`
- Impact: Hidden lint debt; rules silenced rather than fixed.
- Fix approach: For each disable, fix the underlying issue or scope the disable to a single line with a justification comment.

**Stripe migration still ongoing:**
- Issue: `convex/subscriptions/actions.ts:907` notes "Uses Stripe's createPreview API (replacement for deprecated retrieveUpcoming)." Migration recently landed.
- Files: `convex/subscriptions/actions.ts:907`
- Impact: Stripe SDK upgrade churn. Verify there are no remaining callers of `retrieveUpcoming`.
- Fix approach: Grep for `retrieveUpcoming` across the codebase and confirm zero hits, lock Stripe SDK version.

## Known Bugs

**BUG-03: orphaned extractionRunDiffs after baseline-job delete:**
- Symptoms: Diff rows pointed at a deleted baseline job and were never cleaned up.
- Files: `convex/extraction/mutations.ts:1184`, `convex/extraction/cascade-delete.test.ts:274`
- Trigger: Deleting a job that was the baseline for a comparison run.
- Workaround: A historical fix exists in `convex/extraction/mutations.ts` cascade-delete. Verify the test (`convex/extraction/cascade-delete.test.ts:274`) still passes after any cascade-delete refactor.

**Wallet gateway: stream succeeds, deduction can fail:**
- Symptoms: AI Gateway streams output to the client, then asynchronously deducts credits via `void (async () => { ... })()`. If the deduction throws (rate limit, network blip, race), it is logged with `console.error` and silently lost.
- Files: `convex/wallet/gateway/handler.ts:349-359`
- Trigger: Any failure inside the async IIFE — `streamResult.totalUsage` rejection, `deduct` exception, mutation conflict.
- Workaround: None today. The error is logged and discarded.

**Auth sync exhaustion leaves user permanently stuck:**
- Symptoms: When `ensureUser` fails 6 times (`MAX_SYNC_RETRIES`), the provider transitions to `sync_error` state. The user stops syncing and there is no automatic recovery beyond the explicit `retryUserSync` callback.
- Files: `components/providers/convex-provider.tsx:28`, `components/providers/convex-provider.tsx:162-167`, `components/providers/convex-provider.tsx:197-198`
- Trigger: Six consecutive sync failures (Convex backend hiccup, Clerk JWT problem, network).
- Workaround: User must trigger `retryUserSync` manually (often by reloading the page).

## Security Considerations

**CORS wildcard in wallet gateway:**
- Risk: `convex/wallet/gateway/handler.ts:23-44` defines `corsHeaders(origin: string = "*")` and `corsJson(..., origin = "*")`. `handler.ts:86` and `handler.ts:513` initialize `let allowedOrigin = "*"`, with downstream logic narrowing it. The OPTIONS handler at `handler.ts:559-560` also defaults to `"*"` if the request lacks an Origin header.
- Files: `convex/wallet/gateway/handler.ts:23`, `convex/wallet/gateway/handler.ts:31`, `convex/wallet/gateway/handler.ts:42`, `convex/wallet/gateway/handler.ts:86`, `convex/wallet/gateway/handler.ts:513`, `convex/wallet/gateway/handler.ts:559-560`
- Current mitigation: Authentication via API key on every wallet route; the gateway supplies `Authorization: Bearer` on each call. Wildcard is technically safe with bearer tokens (no cookies), but the broad default still hands attackers an easy CSRF/SSRF target if an endpoint ever migrates to cookies.
- Recommendations: Maintain an explicit allowlist of origins, drop the wildcard default, and add CSP/`Vary: Origin` headers. Document why bearer-only auth justifies any remaining `*`.

**Crypto audit trail goes only to `console.log`:**
- Risk: `convex/lib/crypto.ts` (83 lines) implements AES-256-GCM properly, but the only audit signal on decryption is `console.log("[KEY_DECRYPT]", audit.purpose)` (or similar). No structured event, no PostHog capture, no tamper-resistant audit trail.
- Files: `convex/lib/crypto.ts`
- Current mitigation: Console output in Convex logs (ephemeral, retention-bounded).
- Recommendations: Replace `console.log` with `posthogServerCapture` or a dedicated `auditEvents` table; include actor, purpose, key fingerprint, timestamp.

**`envValidation` covers only 6 env vars out of dozens:**
- Risk: `convex/lib/envValidation.ts` (42 lines) validates `STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CLERK_JWT_ISSUER_DOMAIN`. Missing: OpenRouter keys, Posthog tokens, Convex deploy URLs, Zotero OAuth secrets, embedding cost knobs.
- Files: `convex/lib/envValidation.ts`
- Current mitigation: `process.env.X` reads scattered through the codebase, each implementing its own fallback. Some throw, most do not.
- Recommendations: Centralize all env var contracts in a typed schema (Zod), validate at startup, fail fast with a list of missing/invalid vars.

**Public unauthenticated `/api/openalex/search` route:**
- Risk: `app/api/openalex/search/route.ts` (70 lines) proxies OpenAlex without authentication or rate-limiting at the Next.js layer. Errors are logged with `console.error` only.
- Files: `app/api/openalex/search/route.ts`
- Current mitigation: OpenAlex itself has rate limits; bot abuse will hit OpenAlex first.
- Recommendations: Add Vercel Edge rate-limiting (or Convex `rateLimit.consume`) keyed by IP; add explicit error envelopes; add a `Cache-Control` header so identical queries hit the CDN.

**Token-bucket rate limits cover a tiny surface area:**
- Risk: `convex/lib/rateLimit.ts` (77 lines) defines limits only for `start-extraction`, `api-key-save`, `checkout-session`, `wallet-generate`, `wallet-connect`. No protection for: search invocation, library mutations, screening kickoff, Zotero sync trigger, RAG ingest, gateway streaming endpoint per-user.
- Files: `convex/lib/rateLimit.ts`
- Current mitigation: Auth gates and credit deduction implicitly cap usage.
- Recommendations: Add buckets for every billable or expensive action; default-deny pattern.

**322 console statements across 56 files:**
- Risk: 322 `console.log/warn/error/info/debug` calls across 56 files. `convex/zotero/actions.ts` alone has 18; `scripts/wallet-cli.ts` has 133 (CLI is fine); production hot paths (`convex/extraction/mutations.ts:19`, `convex/extraction/workpoolActions.ts:6`, `convex/subscriptions/actions.ts:9`) leak structured details to plaintext logs.
- Files: `convex/zotero/actions.ts`, `convex/extraction/mutations.ts`, `convex/extraction/workpoolActions.ts`, `convex/credits/internal.ts`, `convex/subscriptions/actions.ts`, `convex/wallet/gateway/handler.ts`, `convex/maintenance/internal.ts`, `convex/maintenance/mutations.ts`, `convex/lib/crypto.ts`, `convex/lib/envValidation.ts`
- Current mitigation: Convex log retention is bounded.
- Recommendations: Introduce a thin `log` helper (`info`, `warn`, `error`) that adds context (request id, user id) and routes through PostHog server capture; replace direct `console.*` calls.

## Performance Bottlenecks

**File size: `convex/extraction/mutations.ts` at 2288 lines:**
- Problem: Single file holds extraction kickoff, status transitions, retry orchestration, cascade-delete, baseline-diff machinery, and lazy backfills. Hard to reason about, fragile to refactor.
- Files: `convex/extraction/mutations.ts`
- Cause: Organic growth of the extraction feature without splitting per concern.
- Improvement path: Extract sub-modules: `convex/extraction/mutations/cascadeDelete.ts`, `convex/extraction/mutations/cancel.ts`, `convex/extraction/mutations/backfillStats.ts`, `convex/extraction/mutations/start.ts`. Keep a thin barrel file.

**File size: `convex/extraction/queries.ts` at 1659 lines:**
- Problem: Includes both production read APIs and a `getPapersDebug` debug query. Inline comments warn about N+1 hazards (`loadReviewsByJob` "fixes N+1") and a hard `MAX_PAPERS_PER_JOB = 500` safety cap.
- Files: `convex/extraction/queries.ts:53`, `convex/extraction/queries.ts:230`, `convex/extraction/queries.ts:369`
- Cause: Dense feature surface; debug query mixed with production queries.
- Improvement path: Move debug query to `convex/internal/`, split read paths by concern (job summary, paper list, insights), document indexes assumed by each query.

**File size: `convex/credits/internal.ts` at 1597 lines:**
- Problem: Stripe webhook reconciliation with retry policies, dedup contracts, race-condition mitigations, and credit deduction all live in one file. Comment block explicitly documents the concurrency model: "Convex mutations are serializable (OCC)."
- Files: `convex/credits/internal.ts:478` (DEDUP CONTRACT CRED-01), `convex/credits/internal.ts:1397` (race condition analysis)
- Cause: Billing logic concentration.
- Improvement path: Split into `convex/credits/grant.ts`, `convex/credits/deduct.ts`, `convex/credits/reconciliation.ts`, `convex/credits/dedup.ts`. Co-locate tests with each.

**File size: `lib/store.ts` at 1260 lines:**
- Problem: Three persist stores (search history, sidebars, more) plus migration ladders, polyfills, and helpers in one file.
- Files: `lib/store.ts`
- Cause: Pile-on into one Zustand file.
- Improvement path: Split into `lib/stores/searchHistory.ts`, `lib/stores/sidebar.ts`, `lib/stores/uiPrefs.ts`. Drop legacy migrations as noted under Tech Debt.

**File size: `convex/extraction/workpoolActions.ts` at 1191 lines:**
- Problem: Hardcoded magic numbers (`DENSE_LIMIT=120`, `RRF_CONSTANT=30`, `FUSED_TOP_N=48`) and a hardcoded `ARRAY_GENERIC_TERMS` Set with 17 LLM-related terms. Long extraction loop with many `console.info` statements.
- Files: `convex/extraction/workpoolActions.ts`
- Cause: Iterative tuning without a config surface.
- Improvement path: Move tuning constants to `convex/extraction/config.ts` (or env vars with safe defaults). Remove `console.info` chatter.

**File size: `components/app-sidebar.tsx` at 988 lines:**
- Problem: Single largest component file. Opts out of React Compiler with `"use no memo"`. Holds the entire navigation tree, locale switching, and chromeless route handling.
- Files: `components/app-sidebar.tsx`
- Cause: Sidebar grew with each feature; never split.
- Improvement path: Split into `components/sidebar/SidebarNav.tsx`, `components/sidebar/SidebarFooter.tsx`, `components/sidebar/SidebarRouteFilter.tsx`. Audit the `try/finally` handler patterns that force the no-memo directive and refactor to compiler-safe shapes.

**Wallet gateway handler at 561 lines:**
- Problem: Single file handles streaming + non-streaming, two billing paths, CORS, rate limiting, authentication, model lookups, and request parsing. The fire-and-forget deduction lives here too (see Known Bugs).
- Files: `convex/wallet/gateway/handler.ts`
- Cause: Convex HTTP actions encourage colocated logic.
- Improvement path: Extract `wallet/gateway/streaming.ts`, `wallet/gateway/nonStreaming.ts`, `wallet/gateway/cors.ts`, leave `handler.ts` as a thin router.

**Hardcoded `MAX_PAPERS_PER_JOB = 500`:**
- Problem: Hard cap on jobs at 500 papers. Defined twice (`convex/extraction/mutations.ts:35` and `convex/extraction/queries.ts:53`) — DRY violation.
- Files: `convex/extraction/mutations.ts:35`, `convex/extraction/queries.ts:53`
- Cause: Quick safety bound.
- Improvement path: Move to a shared `convex/extraction/limits.ts`, expose as a plan-tier limit (Free=50, Pro=500, Enterprise=unlimited), let billing decide the ceiling.

## Fragile Areas

**Wallet gateway fire-and-forget credit deduction:**
- Files: `convex/wallet/gateway/handler.ts:349-359`
- Why fragile: Stream may return successful 200 to the client while the deduction silently fails. Repeated failures = uncharged usage.
- Safe modification: Convert to a transactional pattern — credits debited at stream start (estimated), reconciled at stream end with a delta mutation. Or store a pending-charge row and reconcile via a workpool.
- Test coverage: `convex/wallet/gateway/gateway.test.ts` (2486 lines) tests many gateway paths but the failure-after-stream branch is hard to exercise without injecting faults.

**Cascade-delete cancels every workpool item:**
- Files: `convex/extraction/mutations.ts:274-281`
- Why fragile: One job's cancellation cancels everyone's pending items. Concurrent cancellations interact unpredictably.
- Safe modification: Track per-job item IDs; cancel surgically. Add an integration test that exercises two concurrent jobs with overlapping items.
- Test coverage: `convex/extraction/cascade-delete.test.ts` exists; `tests/extraction/workflow-cancel.test.ts` exists. Verify they cover concurrent multi-job cancellation.

**Auth sync state machine with hard 6-retry budget:**
- Files: `components/providers/convex-provider.tsx:28`, `components/providers/convex-provider.tsx:158-181`, `components/providers/convex-provider.tsx:197-198`
- Why fragile: Six exponential-backoff retries, then permanent `sync_error`. User has no automatic recovery; only manual `retryUserSync()`.
- Safe modification: Replace fixed budget with a periodic background retry on visibility/online events; show a non-blocking inline banner offering manual retry.
- Test coverage: Auth provider state transitions are not covered by unit tests in the test suite.

**`migrateSearchHistoryState` switch ladder:**
- Files: `lib/store.ts:184-293`
- Why fragile: Each version branch must be kept in sync with the schema; one wrong cast inside a branch corrupts the entire persist store and breaks every user's search history on next load.
- Safe modification: Drop the entire ladder (no users), re-version to 1, validate persist payloads with a Zod schema and discard mismatches.
- Test coverage: No tests cover the migration ladder.

**119 explicit `any` types in extraction UI:**
- Files: `components/extraction/insights-question-panel.tsx`, `components/extraction/stacked-answer-bars.tsx`, `components/extraction/disagreement-list.tsx`, `components/extraction/grouped-answer-row.tsx`, `components/extraction/confidence-badge.tsx`, `components/extraction/insights-overview.tsx`, `components/extraction/summary-cards.tsx`, `components/extraction/question-list-item.tsx`
- Why fragile: Every `any` cast is a runtime crash waiting for a refactor on the upstream Convex query shape.
- Safe modification: Strongly type `useTranslations` via next-intl's typed namespace export; introduce shared row/column types for extraction tables.
- Test coverage: Tests exist (`tests/extraction-insights-question-panel.test.tsx`, `tests/stacked-answer-bars.test.tsx`) but use `as any` to bypass types — same anti-pattern in tests.

## Scaling Limits

**`MAX_PAPERS_PER_JOB = 500` (hardcoded, duplicated):**
- Current capacity: 500 papers per extraction job.
- Limit: At 501+ papers, jobs silently truncate to the first 500 across at least 8 query/mutation call sites.
- Scaling path: Introduce per-plan ceilings and stream large jobs with cursor-based pagination instead of `take(500)`.

**Rate-limit capacities:**
- Current capacity: `start-extraction` 5/hour (capacity 3), `api-key-save` 5/min, `checkout-session` 3/min, `wallet-generate` 60/min (capacity 10), `wallet-connect` 5/min.
- Limit: A scientist running 6 systematic reviews in an hour hits the start-extraction wall after the third.
- Scaling path: Tier rate limits by plan; expose remaining quota in the UI; convert to leaky-bucket at the proxy layer.

**Auth sync 6-retry budget:**
- Current capacity: 6 retries with exponential backoff before permanent failure.
- Limit: Any 6-consecutive failure window strands the user.
- Scaling path: Background retry on tab focus / network online events; non-blocking inline banner.

**Stripe webhook dedup by `stripeInvoiceId`:**
- Current capacity: Idempotent on `stripeInvoiceId` per `convex/credits/internal.ts:478` "DEDUP CONTRACT (CRED-01)" and `convex/http.ts:111`.
- Limit: Edge cases where Stripe replays a webhook with a different `idempotency_key` but the same `stripeInvoiceId` are handled. Edge cases where two different invoices share an event window may not be.
- Scaling path: Add concurrency tests; verify that the OCC mutation pattern actually serializes overlapping grants.

## Dependencies at Risk

**`pdfjs-dist` legacy build:**
- Risk: Imports `pdfjs-dist/legacy/build/pdf.mjs` instead of the modern build.
- Files: `convex/extraction/pdfjs_extract.ts:29`
- Impact: Larger bundle, slower extraction, may break with future pdfjs releases that deprecate the legacy entry.
- Migration plan: Switch to `pdfjs-dist/build/pdf.mjs`; verify worker compatibility under Convex node actions.

**Stripe SDK `retrieveUpcoming` -> `createPreview` migration:**
- Risk: Recent migration in `convex/subscriptions/actions.ts:907`. Transitive callers may still rely on old behavior.
- Files: `convex/subscriptions/actions.ts:907`
- Impact: Subscription preview rendering and upcoming-invoice math depend on the new API.
- Migration plan: Grep for any remaining `retrieveUpcoming` references; ensure billing UI tests cover both upgrade and downgrade preview paths.

**`@convex-dev/stripe` 0.1.4:**
- Risk: Pre-1.0 component; minor releases may break wire format.
- Files: `package.json:34`
- Impact: Stripe integration depends on the component's webhook handling.
- Migration plan: Pin exact version; review changelog before bumping.

**`@convex-dev/rag` 0.7.2:**
- Risk: Pre-1.0 component; embedding contract may evolve.
- Files: `package.json:33`
- Impact: PDF chunking + retrieval pipeline depends on this contract.
- Migration plan: Pin exact version; integration tests around chunk → retrieve → answer flow.

**`@openrouter/ai-sdk-provider` ^6.0.0-alpha.1:**
- Risk: Alpha release in production.
- Files: `package.json:39`
- Impact: AI gateway model invocations.
- Migration plan: Track upstream stable release; pin until then.

## Missing Critical Features

**Structured audit log:**
- Problem: API-key decryption logs to `console.log`; no tamper-resistant audit trail for sensitive operations (key reads, plan changes, credit grants, webhook outcomes).
- Blocks: Compliance posture (SOC 2, GDPR DPA), forensic investigation, abuse triage.

**Centralized environment validation:**
- Problem: `convex/lib/envValidation.ts` only validates 6 of dozens of env vars.
- Blocks: Confidence at deploy time; missing env vars surface as runtime errors deep inside business logic.

**Per-plan workspace limits enforced at the schema:**
- Problem: `MAX_PAPERS_PER_JOB` is a hardcoded 500; no plan-tier ceiling.
- Blocks: Differentiated pricing tiers; clear upgrade signals.

**Search-history backup beyond localStorage:**
- Problem: All search history persisted only via Zustand persist (localStorage). No server-side mirror.
- Blocks: Cross-device continuity, recovery after browser data clear, search-history-as-feature-marketing.

**Background recovery for auth sync failures:**
- Problem: `convex-provider` requires a manual `retryUserSync` call after the 6-attempt budget exhausts.
- Blocks: Self-healing UX during transient backend issues.

## Test Coverage Gaps

**117 test files exist — strong overall coverage** but the following hot spots are under-tested:

**Wallet gateway fire-and-forget deduction failure path:**
- What's not tested: The branch in `convex/wallet/gateway/handler.ts:349-359` where the deduction throws after the stream has already returned 200 to the client.
- Files: `convex/wallet/gateway/handler.ts:349-359`
- Risk: Silent revenue loss.
- Priority: High.

**Auth provider state machine:**
- What's not tested: `components/providers/convex-provider.tsx` state transitions (`anonymous` → `initializing` → `authenticated` → `sync_error` → `synced`) and the 6-retry budget exhaustion.
- Files: `components/providers/convex-provider.tsx`
- Risk: Auth UX regressions slip through.
- Priority: High.

**Cascade-delete concurrent multi-job interaction:**
- What's not tested: Two jobs cancelling at the same time when `cancelAll()` cancels every pending item.
- Files: `convex/extraction/mutations.ts:274-281`, `convex/extraction/cascade-delete.test.ts`, `tests/extraction/workflow-cancel.test.ts`
- Risk: Data corruption or misbilling under load.
- Priority: High.

**Zustand store migration ladder:**
- What's not tested: Each of the 7 versions of `migrateSearchHistoryState`.
- Files: `lib/store.ts:184-293`
- Risk: Migration bug corrupts every user's search history.
- Priority: Medium (mitigated by the recommendation to delete the ladder entirely).

**Crypto helpers under audit pressure:**
- What's not tested: `decryptApiKey` audit branches; what happens when the audit hook itself throws.
- Files: `convex/lib/crypto.ts`
- Risk: Silent failure to log a decryption.
- Priority: Medium.

**`/api/openalex/search` rate-limiting and error envelope:**
- What's not tested: No tests on the public API route at all.
- Files: `app/api/openalex/search/route.ts`
- Risk: Public abuse vector with no observability.
- Priority: Medium.

**Stripe webhook concurrency dedup:**
- What's not tested: Two simultaneous webhook deliveries for the same `stripeInvoiceId`.
- Files: `convex/credits/internal.ts:478`, `convex/credits/internal.ts:1397`
- Risk: Duplicate credit grants.
- Priority: High (billing).

---

*Concerns audit: 2026-04-14*
