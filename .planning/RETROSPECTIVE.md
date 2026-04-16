# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Stripe Integration Audit

**Shipped:** 2026-02-27
**Phases:** 3 | **Plans:** 7 | **Commits:** 29

### What Was Built
- Webhook handlers re-fetch from Stripe API on every event (eliminates out-of-order state corruption)
- Immediate proration charging on upgrade with card decline blocking
- Payment failure grace period (7 days) with auto-downgrade and billing UI banner
- Paginated reconciliation cron with 500-invoice safety cap and dedup contracts
- Credit cap banner, checkout return processing with reactive toast, Buy Credits links
- Corrective subscription sync cron and failed event monitoring
- Idempotency and TOCTOU contracts documented on all financial webhook handlers

### What Worked
- Three-phase structure (SUB -> CRED -> INFRA) following dependency graph kept work focused
- Consistent 3min average per plan — all 7 plans completed in ~21 minutes total
- Audit-first approach: understanding existing code before changing it prevented regressions
- Documentation-only plans (03-02 idempotency contracts) were fast and high-value

### What Was Inefficient
- Phase 2/3 plans not marked `[x]` in ROADMAP.md during execution (only Phase 1 was)
- Milestone audit had to be run twice (first after Phase 1, then after all phases)
- `getUpgradePreview` action was built in Phase 1 but has no UI consumer yet (Phase 4)

### Patterns Established
- `IDEMPOTENCY CONTRACT` and `TOCTOU CONTRACT` JSDoc patterns for financial handler audit trails
- Webhook re-fetch pattern: always `stripe.subscriptions.retrieve()` before syncing
- In-place update pattern for cancellation (no orphan records)
- Reactive checkout return pattern: capture balance on return, watch Convex subscription, fire toast on delta

### Key Lessons
1. Stripe webhook event payloads can arrive out of order — always re-fetch from API before syncing local state
2. `always_invoice` + `error_if_incomplete` together give immediate proration with card decline safety
3. Documentation-as-code (JSDoc contracts) is a high-value, low-risk deliverable for audit milestones
4. Convex JS runtime cannot use the Stripe npm package directly — must use internalActions in Node runtime

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 1 session for full milestone
- Notable: 7 plans in ~21 minutes — consistent velocity with no blockers

---

## Milestone: v1.1 — Upgrade Flow

**Shipped:** 2026-02-27
**Phases:** 3 | **Plans:** 6 | **Commits:** 25

### What Was Built
- Proration date pinning between preview and execution (exact charge match)
- Tri-state toast feedback: actual credits on success, processing on grant failure, error on card decline
- Webhook-driven backup path for pro-rata credit grants via invoice.paid handler
- Upgrade metadata atomically written to Stripe subscriptions for webhook classification
- subscription_update firewall preventing double-grants (with regression test)
- Payment method display (card brand + last4) in upgrade confirmation dialog
- Proration line item breakdown (credit for unused + charge for new plan)
- Dismiss guard preventing dialog close during upgrade processing
- Full i18n translations for upgrade dialog across 6 locales

### What Worked
- Phase dependency chain (Correctness -> Resilience -> UX) meant each phase built cleanly on the last
- Average 2min per plan — all 6 plans completed in ~13 minutes total (faster than v1.0)
- Research phase before planning caught important details (Stripe billing_reason values, Radix dialog events)
- Atomic metadata write pattern eliminated a class of stale-data races in webhook handling

### What Was Inefficient
- ROADMAP.md plan checkboxes not updated during execution (same issue as v1.0)
- totalCharge i18n key had to be added as a deviation in Plan 01 to prevent runtime error — should have been in Plan 02's scope from the start
- paymentMethod i18n key added to all 6 locales but not consumed in JSX (caught by audit, one-line fix)

### Patterns Established
- Proration date pinning: capture timestamp at preview, thread through to execution call
- Dual-path convergence: action grants credits immediately, webhook grants as backup, dedup prevents doubles
- Radix dismiss prevention: onEscapeKeyDown + onPointerDownOutside + onInteractOutside for processing states
- Fresh Stripe API read for period boundaries (avoids stale local DB when webhook fires before sync)

### Key Lessons
1. Always thread server-reported values to UI — never fall back to preview estimates for financial amounts
2. Webhook backup paths need metadata written atomically in the same API call as the primary action
3. i18n keys should be planned alongside the component code that consumes them, not in a separate plan
4. Radix Dialog requires three separate event handlers for complete dismiss prevention (Escape, pointer, interact)

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 1 session for full milestone
- Notable: 6 plans in ~13 minutes — 38% faster per-plan than v1.0

---

## Milestone: v1.2 — E2E Billing Tests

**Shipped:** 2026-02-28
**Phases:** 7 | **Plans:** 11 | **Deliverables:** 1,248 LOC TypeScript, 351 LOC YAML

### What Was Built
- Complete Playwright billing test infrastructure: fixtures with fresh Clerk user isolation, Stripe checkout-bypass helpers, Convex webhook waiter, BillingPage + PricingPage POMs
- 18 data-testid attributes across billing UI components for stable test targeting
- 6 spec files covering all billing flows: subscribe (Go/Pro), upgrade (Go-to-Pro), downgrade (Pro-to-Go), cancellation, credits (signup, pro-rata, topup, cap), and dedicated CRED-02 regression
- CI pipeline integration: test:billing:e2e npm script, 7 env vars, Playwright browser install, test execution, and artifact upload in all 3 billing CI jobs
- Gap closures: credits spec auth wiring (Phase 10), tech debt cleanup (Phase 11), CI env hardening + CRED-02 regression (Phase 13)

### What Worked
- Checkout-bypass pattern eliminated Stripe hosted checkout automation entirely — fast, deterministic, reliable
- WebhookWaiter polling pattern removed timing flakes between Stripe webhook delivery and UI assertion
- Auto-advance pipeline (research -> plan -> verify -> execute) ran 5 of 7 phases without manual intervention
- 3-source cross-reference audit (VERIFICATION + SUMMARY + REQUIREMENTS) caught real gaps: missing clerkUser fixture, implicit CRED-02 coverage, CLERK_PUBLISHABLE_KEY alias fragility
- Integration checker spawn validated all 18 requirements were properly wired across phase boundaries

### What Was Inefficient
- Phase 7 had no CONTEXT.md (discuss-phase skipped) — planner had to infer all infrastructure design decisions from research alone
- Gap closure phases (10, 11, 12, 13) were created reactively after audit findings — could have been caught during initial planning if discuss-phase had been run for Phases 7-9
- ROADMAP.md plan checkboxes still not updated during execution (same recurring issue from v1.0 + v1.1)
- Milestone audit had to run 3 times total (first found gaps → Phase 10-11 closures, second found more → Phase 12-13 closures, third passed)

### Patterns Established
- Checkout-bypass pattern for E2E subscription tests (createSubscriptionBypass + cleanupStripeCustomer)
- WebhookWaiter convergence polling (waitForSubscriptionPlan + waitForCreditBalance) before UI assertions
- Page Object Model pattern with data-testid selectors (no raw CSS classes in test code)
- Fresh Clerk user per test for full isolation (create + sign-in + teardown)
- CI env guard pattern: `if [ "$VAR" = "false" ]; then exit 1; fi` for feature flags

### Key Lessons
1. Stripe blocks all automation of hosted checkout pages — checkout-bypass via API is the only viable E2E approach
2. Clerk concurrent auth bug (#7891) requires `workers: 1` — parallel billing tests are not possible
3. Exact toBe() assertions in regression tests catch drift; >= assertions in feature tests absorb timing variation — use the right match for the purpose
4. CI env preflight validation should cover ALL secrets used by E2E tests, not just a subset — missing guards cause confusing runtime failures
5. Running discuss-phase before planning catches design decisions early; skipping it leads to reactive gap closure phases

### Cost Observations
- Model mix: quality profile (opus-dominant for planning/execution, sonnet for verification)
- Sessions: 3 sessions (main build, gap closures, final hardening)
- Notable: 11 plans across 7 phases — more phases than v1.0/v1.1 combined due to iterative gap closures

---

## Milestone: v2.0 — TDD & Test Coverage

**Shipped:** 2026-02-28
**Phases:** 8 | **Plans:** 17 | **Commits:** 63

### What Was Built
- Multi-environment Vitest config (node, edge-runtime, jsdom) with zero-regression on existing 43 tests
- AI prompt builder structural tests, Zod schema contract tests, question key codec round-trip tests
- Fail-soft batch processing tests covering all-success, all-fail, and partial-failure with mock isolation
- Cost calculation tests with IEEE 754 precision handling and model registry tests across 4 providers
- Search parameter construction, region codec bijectivity, filter builder, and URL serialization round-trip tests
- CSV/JSON export, answer formatting, citation helper, download output tests with PDF feature flag gating
- Auth state machine access control, user creation atomicity, ensureUser first-login/return-visit, profile sync
- Plan config shape contracts, tier enforcement via mocked Convex query chain, feature flag env var isolation, subscription selection priority

### What Worked
- Test-first approach: every phase had clear success criteria with specific function-level assertions
- Pure function extraction pattern: testing extracted pure logic avoided convex-test issue #50 (getUserIdentity bug)
- vi.mock at module boundary pattern: batch processing tests ran independently of AI SDK
- vi.resetModules() pattern: reliable env var isolation for feature flag and config tests
- Parametric it.each tests: compact coverage across many input variations (plan types, providers, codecs)
- Auto-advance pipeline executed all 8 phases in a single day

### What Was Inefficient
- REQUIREMENTS.md checkboxes for SRCH-* and EXPRT-* not updated when phases 18/19 completed — same recurring issue
- Some SUMMARY.md files lacked one_liner fields, requiring manual accomplishment extraction at milestone completion
- STATE.md execution metrics only captured 9 of 17 plans (phases 18/19/20 metrics missing)

### Patterns Established
- vi.resetModules() + dynamic import for testing module-load-time env var behavior
- toBeCloseTo(x, 6) for IEEE 754 floating-point cost assertions
- makeSub() factory pattern for DRY test data construction
- Mock 4-step Convex query chain (query -> withIndex -> order -> collect) for server-side testing
- Structural prompt testing: assert fields/markers, never AI output quality
- Representative model sampling instead of full model snapshot for maintainability

### Key Lessons
1. Pure function extraction is the best mitigation when framework test tooling has bugs (convex-test #50)
2. Module-load-time env vars require vi.resetModules() + dynamic import — vi.stubEnv alone is insufficient
3. toBeCloseTo is essential for any floating-point arithmetic tests — exact equality causes false failures
4. Testing representative samples per category is more maintainable than exhaustive snapshots of all values
5. REQUIREMENTS.md checkbox updates during execution remain an unsolved process gap (4th milestone in a row)

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 1 session for full milestone
- Notable: 17 plans in ~30 minutes — consistent ~2min/plan velocity, 8 phases in one day

---

## Milestone: v2.1 — Library & Collections

**Shipped:** 2026-03-01
**Phases:** 8 | **Plans:** 15 | **Commits:** ~181

### What Was Built
- Persistent server-side library with auto-save on rating (Convex upsert, trimmed 10-field metadata)
- Dedicated /library page with search, filter by rating/date/year/collection, sort, pagination, auth gate
- Collection CRUD with junction table many-to-many, cascade delete, item count badges
- Advanced filtering with URL state persistence via nuqs (bookmarkable/shareable views)
- Shared FilterSection component extracted for DRY cross-page filtering
- CSV/JSON export with filter-aware subset export reusing existing utilities
- Mobile responsive layout with 44px touch targets, 6-locale i18n, toast feedback on all destructive actions

### What Worked
- Phase 26 superseded cleanly: audit identified unexecuted phase, gap closure phases 29-30 delivered its requirements more efficiently
- Dual-path query strategy (search index vs regular indexes) handled all filtering/sorting combinations correctly
- Junction table pattern for collections enabled clean cascade deletes and count queries
- Shared component extraction (Phase 27) eliminated duplicate FilterSection code between search and library pages
- Fire-and-forget mutation pattern kept rating UX instant while Convex synced in background
- nuqs URL state replaced all local useState for filters — zero additional state management needed
- French diacritics audit (Phase 30) caught 15+ keys beyond the 8 planned

### What Was Inefficient
- Phase 26 planned but never executed — should have been removed from roadmap earlier instead of being superseded by gap closure phases
- Some SUMMARY.md files lacked one_liner fields (same issue as v2.0)
- STATE.md accumulated verbose per-plan execution metrics that should have been consolidated per-phase

### Patterns Established
- Async toast pattern (.then/.catch) for destructive mutations — replaces fire-and-forget for user feedback
- Debounce bridge pattern: rawSearch (local useState) syncs to URL param via useEffect after 300ms debounce
- null vs undefined convention: nuqs uses null to clear params, Convex uses undefined for optional args
- CollectionPicker as Dialog (not Popover) to avoid DropdownMenu-to-Popover positioning issues
- Set-based pre-fetch + convex-helpers filter() for collection filtering on both browse and search paths
- 44px mobile touch targets with sm: reset to preserve compact desktop layout

### Key Lessons
1. Junction tables are the correct pattern for many-to-many in Convex — array fields on documents create cascade delete complexity
2. Superseded phases should be removed from the roadmap immediately, not left as strikethrough entries
3. Shared component extraction is best done early (after patterns stabilize) — Phase 27 was a clean refactor because the search page patterns were well-established
4. nuqs URL state management eliminates entire categories of state sync bugs — prefer URL state over local state for filterable views
5. Export queries should use non-paginated .collect() when item limits are known and acceptable (1024 cap)

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: ~3 sessions across 2 days
- Notable: 15 plans in 2 days — largest feature milestone (258 files changed, +37K LOC)

---

## Milestone: v2.2 — Library UI Overhaul

**Shipped:** 2026-03-02
**Phases:** 4 | **Plans:** 7 | **Commits:** 34

### What Was Built
- SidebarLayout responsive component (desktop two-column + mobile tabs) with Zustand store factory
- FilterSidebar generic chrome shell (collapse animation, badge, clear button, content slot via children)
- Search page refactored to SidebarLayout + SearchFilterSidebar composition (proving the shared infrastructure)
- Library page overhauled with full filter sidebar (rating, date saved, year range, collection, text search)
- Sort controls (date saved, year, rating, title) with search-aware disabling
- Pagination bar with "X-Y of Z papers" counts and prev/next navigation
- List/grid view toggle and rating stars on library items

### What Worked
- Infrastructure-first strategy: Phase 31 built reusable primitives, Phase 32 proved them on the search page, Phase 33 applied them to the library page — zero rework needed
- Factory pattern for Zustand stores: createSidebarStore + createSidebarDimensions enabled independent sidebar stores per page with distinct localStorage keys
- Chrome shell + content slot pattern: FilterSidebar accepted arbitrary filter content via children, eliminating all sidebar duplication
- Pagination data layer (Phase 34-01) cleanly separated from UI layer (Phase 34-02) — each was a focused, quick plan
- exportItems.length as pagination total was a clean architectural decision — avoided a separate count query

### What Was Inefficient
- ROADMAP.md Phase Details section retained expanded plan checkboxes as `[ ]` even after plans were complete (should have been `[x]`)
- Progress table for phases 31-34 had broken column alignment (missing v2.2 milestone column)
- SUMMARY.md files had no one_liner fields — recurring issue from v2.0 and v2.1

### Patterns Established
- createSidebarStore factory: Zustand store factory with configurable localStorage persist key
- FilterSidebar chrome shell: generic frame accepting Zustand store + dimension calculator + children
- SidebarLayout responsive branching: useIsMobile hook drives desktop two-column vs mobile tabs rendering
- Page-specific filter sidebar composition: PageFilterSidebar wraps FilterSidebar + PageFilterContent
- Client-side page windowing with URL-driven page state via nuqs parseAsInteger

### Key Lessons
1. Shared component infrastructure should be built and proven on an existing page before applying to the target page — reduces risk of design mistakes in the reusable layer
2. Zustand store factories with configurable persist keys enable true independence between page-specific stores
3. Chrome shell + content slot is the right composition pattern for shared sidebar UI — avoids prop drilling and keeps page-specific logic encapsulated
4. Pagination data layer (Convex index + query params) should be decoupled from pagination UI (bar, counts, controls) for clean separation of concerns
5. exportItems.length is a valid pagination total source when non-paginated queries have known item limits

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 1 session for full milestone
- Notable: 7 plans in 4 phases — compact milestone, clean execution with no gap closure phases needed

---

## Milestone: v2.3 — Codebase Hardening

**Shipped:** 2026-03-02
**Phases:** 8 | **Plans:** 14 | **Commits:** 57

### What Was Built
- Removed all debug artifacts (console.log, @ts-ignore) and gated debug/test functions behind requirePublicDebugEnabled()
- Replaced all ctx: any, internal as any, components as any casts with proper Convex-generated types (11 files)
- Added rateLimitTables and Zotero encryption fields to Convex schema as optional fields
- Built full cascade deletion for extraction jobs covering 8 child tables with scheduler-based batching and PDF storage cleanup
- Encrypted Zotero API keys at rest with AES-256-GCM via shared crypto.ts module with idempotent migration
- Parallelized N+1 extraction queries with Promise.all and bounded all unbounded .collect() calls
- Enforced token-bucket rate limits on all 6 exposed endpoints via convex-helpers defineRateLimits
- Integration tests for cascade delete, Zustand 5-version migration chain, and extraction insight edge cases

### What Worked
- Strict phase ordering (35 -> 42) respected file contention on extraction/mutations.ts (touched by phases 36, 38, 40)
- Schema-first approach (Phase 37) enabled both encryption (Phase 39) and rate limiting (Phase 41) to proceed cleanly
- Shared crypto module extraction (Phase 39) was a clean DRY win — both apiKeys and Zotero use identical encrypt/decrypt
- Dual-read fallback for Zotero migration enabled zero-downtime transition from plaintext to encrypted keys
- resolveZoteroApiKey pattern keeps migration transparent to all 5 action handlers and workpoolActions
- Auth-first rate limit ordering pattern established consistent enforcement across all endpoints
- 14 plans executed in ~36 minutes total — consistent ~2.5min/plan velocity

### What Was Inefficient
- SUMMARY.md one_liner fields still not populated (same issue from v2.0, v2.1, v2.2)
- New `as any` cast introduced in rateLimit.ts:52 while removing `as any` casts everywhere else (ironic)
- Live deployment verification for schema additions (Phase 37) remains manual — CI doesn't run `npx convex dev`

### Patterns Established
- requirePublicDebugEnabled() as first line in all debug/test handlers for consistent security gating
- Lazy getStripe() singleton with throw-on-call-not-import for safe module-level Stripe initialization
- requireAppUrl() with dev/CI fallback for environment variable validation at function entry
- scheduler.runAfter(0, ...) for self-scheduling batch deletes (avoids recursive runMutation stack overflow)
- resolveZoteroApiKey dual-read fallback for transparent encryption migration
- defineRateLimits centralized config with consume internal mutation for action endpoints
- vi.useFakeTimers() before scheduler-triggering mutations (not after) for reliable test timing
- Extract-and-export pattern for testing Zustand persist migrate functions

### Key Lessons
1. Schema-first phases enable clean parallelism in later phases — always add optional fields before writing logic that depends on them
2. Shared utility extraction (crypto.ts, env.ts, rateLimit.ts) during a hardening milestone is the ideal time — patterns are understood, not speculative
3. `ctx.scheduler.runAfter(0, ...)` is the correct Convex pattern for large batch operations — recursive ctx.runMutation can stack overflow
4. Dual-read fallback is the right migration pattern for encrypted field transitions — decrypt new field first, fall back to plaintext
5. vi.useFakeTimers() timing is critical — must be enabled before the mutation that triggers ctx.scheduler, not after
6. Token-bucket rate limiting with convex-helpers requires a consume internal mutation bridge for action endpoints that lack ctx.db

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 1 session for full milestone
- Notable: 14 plans in ~36 minutes — entire hardening milestone completed in a single session

---

## Milestone: v2.4 — Concerns Sweep

**Shipped:** 2026-03-03
**Phases:** 4 | **Plans:** 7 | **Commits:** 30

### What Was Built
- Migrated plaintext Zotero API keys to encrypted storage and removed deprecated apiKey field from schema and all code paths
- Fixed extraction cancellation with workflow.cancel(), workpool.cancelAll(), and credit-guard protection in action handlers
- Fixed orphan diffs on baseline job deletion, added diff truncation metadata with i18n UI banner, extended GDPR cascade delete to extraction data
- Created 18 shared extraction validators and replaced v.any() in all 11 query return validators with typed alternatives
- Typed migrateSearchHistoryState and attachReviewMetadata with proper interfaces; removed getJobDetails 100-paper cap
- Added hourly cron for expired Zotero OAuth token cleanup with concurrent-safe per-delete handling
- Documented debug endpoint production policy with JSDoc @production annotations across 17 functions

### What Worked
- Codebase mapping (from v2.3) provided a complete concerns inventory — zero discovery overhead during v2.4 planning
- Dependency ordering (43 schema -> 44 workflow -> 45 types -> 46 cron) kept each phase cleanly isolated
- Two-deploy migration pattern (migrate data, then remove field) from v2.3 was reused seamlessly for apiKey removal
- Credit-guard pattern is simple and correct — fresh DB read before deduction handles all cancellation race conditions
- statusResultValidator adoption across all 11 queries eliminated repetitive v.union boilerplate
- All 7 plans averaged ~3min each — entire milestone completed in ~21 minutes across 2 sessions
- Milestone audit passed on first attempt (15/15 requirements) — no gap closure phases needed

### What Was Inefficient
- CLI milestone complete tool only detected 2 of 4 phases (phases 43-44 lacked detailed sections in ROADMAP.md) — required manual MILESTONES.md correction
- Progress table in ROADMAP.md had broken column alignment for phases 43-46 (missing v2.4 milestone column)
- Production deployment of Phase 46 cron blocked by pre-existing missing CLERK_JWT_ISSUER_DOMAIN env var — not introduced by this milestone but surfaced during it

### Patterns Established
- Credit-guard pattern: fresh DB read of job status immediately before credit deduction in workpool actions
- Two-deploy migration completion: after v2.3 encrypted data, v2.4 cleaned up schema and fallback code
- JSDoc @production STAGING ONLY annotation pattern for all debug/test gated functions
- statusResultValidator helper for all auth-gated Convex query return validators
- Concurrent-safe cron cleanup: try-catch per delete when multiple code paths can delete the same record
- Conditional schema fields: v.optional() + spread for fields only relevant in specific cases (truncation metadata)
- Deferred user hard-delete: skip hard-delete when child records exceed batch limit, continue on next cron run

### Key Lessons
1. Concerns sweep milestones are high-value and low-risk — fixing known issues with a complete inventory requires minimal design decisions
2. Credit-guard pattern (fresh read before deduction) is simpler and more correct than version-field TOCTOU mitigation
3. Two-deploy migration pattern works cleanly for field removal: data migration deploy + schema cleanup deploy
4. statusResultValidator adoption should happen early in a codebase — retrofitting 11 queries is tedious but the DRY benefit is permanent
5. Keep ROADMAP.md Phase Details sections complete for all phases — missing details cause downstream tool detection failures

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 2 sessions across 2 days
- Notable: 7 plans in ~21 minutes — smallest milestone by phase count (4), cleanest execution (0 gap closures, 0 deviations across 5 of 7 plans)

---

## Milestone: v2.5 — Tech Debt Purge

**Shipped:** 2026-03-03
**Phases:** 7 | **Plans:** 15 | **Commits:** 54

### What Was Built
- Test safety net: Stripe webhook handler tests, concurrent credit deduction tests, cascade deletion partial-failure tests, debug gate bypass tests
- Type-safe Stripe billing: zero `as any` casts in webhook handlers, typed SDK event objects, `getPlanFromPriceId` substring fallback removed
- Pending plan change state migrated from Stripe metadata to Convex `subscriptions` table
- Typed extraction/library queries: `Id<"extractionJobs">` props, typed pagination validators, `searchFiltersValidator`, proper cursor pattern
- Centralized `decryptApiKey` with structured audit logging ([AUDIT:KEY_DECRYPT]), `encryptedApiKey` made required in schema
- Strengthened debug gate with audit logging on every invocation ([AUDIT:DEBUG_ACCESS])
- Batch review loading (N+1 fix), bounded all `.collect()` with `.take()` guards, `by_expiry` + `by_status_updatedAt` indexes
- Removed unused dependencies (ollama, unpdf, 20 Radix packages), decomposed focus-mode.tsx into 3 sub-components
- Zero TypeScript compile errors across entire codebase — resolved all 19 Stripe v20 type errors in production and test files

### What Worked
- Test-first strategy (Phase 47 before all modifications) prevented regressions throughout the entire milestone
- Dependency ordering (47 tests -> 48 billing -> 49 types -> 50 security -> 51 perf -> 52 cleanup -> 53 TS fix) kept each phase cleanly isolated
- Phase 53 (TypeScript Compile Fix) was an effective catch-all for TS errors introduced by Phase 48's stricter Stripe typing
- Milestone audit passed on first attempt (31/31 requirements) — re-audit after Phase 53 confirmed zero remaining debt
- Ref-injection pattern for webhook handler testing enabled full unit test coverage without convex-test
- 15 plans executed in a single day — consistent velocity across all 7 phases
- The comprehensive CONCERNS.md inventory (from v2.3) meant zero discovery overhead during planning

### What Was Inefficient
- Phase 53 was added reactively after Phase 48 introduced TypeScript compile errors — should have been anticipated during Phase 48 planning
- v2.5 plans in ROADMAP.md Progress table had broken column alignment (missing Milestone column for phases 47-52)
- SUMMARY.md one_liner fields still not populated (same recurring issue from v2.0 through v2.4)
- Phase count discrepancy: ROADMAP listed "Phases 47-52" in milestones but actual range was 47-53 (Phase 53 added mid-milestone)

### Patterns Established
- Ref-injection pattern for testing Convex webhook handlers: extract pure functions, inject internal refs as parameter
- Double cast (as unknown as X) for Stripe v20 union types in test mocks — Partial<UnionType> resolves to last member
- Record<string, unknown> for Stripe event mock helpers — avoids union type issues with Partial
- [AUDIT:KEY_DECRYPT] and [AUDIT:DEBUG_ACCESS] structured log prefixes for grep-friendly security audit trails
- MAX_PAPERS_PER_JOB = 500 safety constant applied to all per-job queries and mutations
- Required (not optional) refs parameter eliminates an entire class of undefined assignability errors

### Key Lessons
1. Test safety nets before refactoring are essential — Phase 47 caught issues that would have been invisible without coverage
2. Stricter typing in one module can cascade TypeScript errors across the codebase — plan a TS fix phase alongside type-tightening work
3. Centralized decrypt utilities with audit logging are a clean security pattern — single point of enforcement, complete audit trail
4. Double cast (as unknown as X) is the correct pattern for Stripe v20 discriminated union types in tests
5. Required parameters > optional parameters when all callers always provide the value — eliminates undefined assignability errors
6. Comprehensive tech debt inventories (CONCERNS.md) make cleanup milestones predictable — zero discovery overhead during execution

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: 1 session for full milestone
- Notable: 15 plans in 1 day — entire tech debt purge completed in a single session with zero gap closures

---

## Milestone: v3.0 — Zero-Any Overhaul

**Shipped:** 2026-03-04
**Phases:** 6 | **Plans:** 11 | **Commits:** 57

### What Was Built
- Eliminated all `as any` casts from production code — ExtractionResultWithReview derived from validator, branded WorkflowId, v.union for rate limiter, typeof narrowing for Stripe customer
- XSS-safe HighlightedText component replacing all dangerouslySetInnerHTML with React-native text splitting
- Persistent auditLogs table with writeAuditLog internalMutation, env var validation cron, assertPlanPriceConfig fail-fast
- Debug function production exclusion strategy documented
- Incremental extraction report aggregation via extractionJobStats table with lazy backfill for legacy jobs
- ExcelJS migration with dynamic import (~500KB bundle savings), bounded getLibraryCount, subscription cron batching with 45s circuit-breaker
- Migration helper cleanup (listAllConnections, migrateToEncryptedKeys removed)
- OpenAlex contact email fail-loud validation
- 45+ new tests covering credit concurrency OCC, XSS safety, GROBID fallback, env validation, ExcelJS round-trip, subscription cron

### What Worked
- CONCERNS.md inventory from prior milestones made requirements mapping trivial — every concern became a requirement
- Phase 59 (gap closure) was planned proactively from milestone audit, not reactively — audit passed on first run after gap closure
- Parallel plan execution within waves (54-01/54-02, 55-01/55-02, 56-01/56-02) maximized throughput
- Validator-derived types (Infer<typeof validator>) established single source of truth pattern
- Text splitting over innerHTML for XSS was simpler and more correct than DOMPurify approach
- Incremental stats upsert pattern (write on paper complete) decoupled report generation from result loading
- Circuit-breaker cron pattern with self-scheduling continuation is infinitely scalable

### What Was Inefficient
- SUMMARY.md one_liner fields still not populated (same recurring issue from v2.0 through v2.5)
- ROADMAP.md plan checkboxes for phases 55-59 not fully updated during execution
- Phase 57 TBD plans required separate plan-phase runs mid-milestone
- Progress table alignment in ROADMAP.md had inconsistent column formatting for v3.0 phases

### Patterns Established
- Infer<typeof validator> for deriving TypeScript types from Convex validators — single source of truth
- Branded type casts (as WorkflowId) for type bridges instead of as-any
- v.union(v.literal(...)) for runtime argument validation matching compile-time defineRateLimits keys
- Text splitting over innerHTML for safe search highlighting
- Persistent audit table (writeAuditLog) for security-sensitive operations
- Cron-based env var validation for early detection of missing critical configuration
- assertPlanPriceConfig fail-fast in billing handler bodies (not module scope)
- Circuit-breaker cron with self-scheduling continuation for unbounded-growth operations
- Incremental stats upsert on write with lazy backfill on first read for legacy data
- Stats scope guard: bypass fast path when report has paper/question-level filtering

### Key Lessons
1. Validator-derived types should be the default pattern in Convex projects — eliminates manual type maintenance and ensures DB/code alignment
2. XSS prevention via text splitting is always preferable to sanitization — correct by construction, zero dependencies
3. Incremental aggregation (upsert on write) with lazy backfill is the right pattern for decoupling report generation from data loading
4. Circuit-breaker crons with self-scheduling continuation handle growth without rate limit exhaustion — plan for scale in cron jobs early
5. Cron-based env var validation catches configuration drift between deploys — better than handler-level validation that's too late
6. Proactive gap closure phases from milestone audit prevent reactive work — audit-first completion is cleaner than iterative gap discovery

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: ~2 sessions across 2 days
- Notable: 11 plans in 2 days — entire CONCERNS.md resolved in a single milestone

---

## Milestone: v3.1 — Complete Type Safety

**Shipped:** 2026-03-05
**Phases:** 12 | **Plans:** 20 | **Commits:** 82

### What Was Built
- All 9 v.any() validators replaced with typed alternatives (JSON serialization workaround for Clerk webhooks since Convex 1.32.0 lacks v.unknown())
- Extraction and billing backends fully typed — workflow, workpoolActions, mutations, subscriptions, credits, stripeWebhookHandlers with zero `: any`, `as any`, or `any[]`
- All client libraries typed — utils.ts (JsonValue recursive type), store.ts (Zustand persist migration via unknown), use-auth-query.ts (as never boundary pattern), extraction/search/AI libs
- All React components typed — results-list (PaperResult extends Work), paper-card, extraction components (Infer<typeof validator> for saved views), focus-mode, country-selector
- Typed mock factory infrastructure — DeepPartial<T> factories for Convex context, Ids/documents, and Stripe events enabling type-safe test mocks
- All 20+ test files typed using mock factories — 85+ `as any` casts replaced, local test interfaces (TestSubscription, TestRetrievalCandidate) for non-exported types
- Zero-any verified — `tsc --noEmit` zero errors, `scripts/verify-no-any.sh` passes all 3 checks (`: any`/`as any`/`any[]`, `<any>` angle-bracket, tsc compilation)
- Gap closure: GenericActionCtx<GenericDataModel> for Stripe webhook boundary, barrel file "use node" fix, GenericValidator replacing Validator<any>, verify-no-any.sh enhanced

### What Worked
- Layered dependency ordering (validators → backend → libs → components → mocks → tests → verification) kept each phase building on the previous
- `as never` pattern for Convex useQuery/usePaginatedQuery boundary was a clean, reusable solution for generic constraint satisfaction without widening to any
- DeepPartial<T> with deep merge for mock factories enabled selective nested customization — far better than blanket `as any` casts
- Mock factory barrel (tests/factories/index.ts) kept all test files importing from a single location
- Gap closure phases (68-71) were planned proactively from milestone audit findings — all 5 tech debt items resolved cleanly
- Milestone audit passed with perfect scores: 18/18 requirements, 12/12 phases, 47/47 integrations, 6/6 E2E flows
- 20 plans across 12 phases executed in 2 days — average ~5min/plan including all gap closures

### What Was Inefficient
- Phase 68 and 69 were reactive gap closures for issues introduced by Phase 61 (ActionCtx tightening) and pre-existing barrel file issues — could have been caught during Phase 61 planning
- SUMMARY.md one_liner fields still not populated (same recurring issue from v2.0 through v3.0) — required manual accomplishment extraction at milestone completion
- Phase 60 required 3 plans (60-01, 60-02, 60-03) when the gap closure (60-03 Clerk webhook serialization) could have been identified during initial planning
- Progress table in ROADMAP.md had inconsistent column alignment for v3.1 phases (missing Milestone column)

### Patterns Established
- `as never` instead of `as any` at Convex useQuery/usePaginatedQuery generic boundary — satisfies constraints without widening
- DeepPartial<T> with recursive deep merge for typed mock factory overrides
- GenericValidator from convex/values as SDK alias for Validator<any, any, any>
- GenericActionCtx<GenericDataModel> for cross-library type boundaries (Convex → @convex-dev/stripe)
- WorkInput interface pattern for when SDK types have incompatible nested requirements
- `as unknown as GenericActionCtx<GenericDataModel>` for test mock contravariance
- Local test-only interfaces (TestSubscription, TestRetrievalCandidate) for non-exported production types
- `as never` for type-safe invalid input testing (invalid plan names, wrong argument types)
- JSON serialization boundary pattern when Convex validator system lacks v.unknown()

### Key Lessons
1. `as never` is a better Convex boundary pattern than `as any` — satisfies generic constraints without losing type information elsewhere
2. DeepPartial mock factories eliminate entire categories of `as any` casts in tests — invest in factory infrastructure early
3. Cross-library type boundaries (Convex → @convex-dev/stripe) require GenericActionCtx<GenericDataModel>, not ActionCtx — library callback signatures use generic types
4. Barrel file runtime restrictions matter in Convex — "use node" re-exports in default-runtime barrels break the bundler
5. Verification scripts should test all any-type patterns from the start (`<any>` angle brackets were missed initially)
6. Gap closure phases from proactive auditing are more efficient than discovering issues at milestone completion
7. TypeScript type safety across 143 files with zero remaining any types is achievable with systematic layered approach
8. Mock factory barrel exports (index.ts) keep test imports clean and centralized

### Cost Observations
- Model mix: quality profile (opus-dominant)
- Sessions: ~2 sessions across 2 days
- Notable: 20 plans in 2 days — largest plan count in a single milestone, zero tech debt remaining

---

## Milestone: v3.2 — Production Readiness

**Shipped:** 2026-03-06
**Phases:** 3 | **Plans:** 4 | **Commits:** 11 source

### What Was Built
- Debug endpoints converted from public functions with env-var gate to internal functions (platform-enforced unreachability)
- O(1) library count via denormalized libraryItemCount field with atomic counter in all 3 mutation paths
- All high-traffic .collect() calls bounded with .take(N) guards using shared MAX constants from queryBounds.ts
- ~40 naturally-bounded queries annotated with cardinality comments
- Cascade delete paths verified safe from over-bounding (no orphaned data)

### What Worked
- Small, focused milestone (3 phases, 4 plans) executed cleanly in a single day
- All 3 phases were independent — no inter-phase dependencies meant zero contention
- yolo mode with auto-advance pipeline ran all 3 phases without manual intervention
- Research phase before each plan caught important details (Convex query context lacks scheduler, search queries can't use .take())
- All 8/8 requirements checked off with zero gap closure phases needed
- 786 tests passing (8 new counter tests + 13-assertion internal registration test)

### What Was Inefficient
- Phase 72 Plan 02 was nearly a no-op (1 minute, 1 file) since Plan 01 already deleted the files it was supposed to delete
- Plan line number references in Phase 74 were slightly off from research (auto-fixed during execution)

### Patterns Established
- Internal function registration as security boundary (no runtime env-var gate needed)
- Denormalized counter: optional field + lazy scan fallback + mutation-driven initialization
- Math.max(0, count - 1) for negative counter prevention
- MAX constant + .take(N) from shared queryBounds.ts for all high-traffic queries
- Cardinality comment annotation for naturally-bounded queries
- Unbounded comment annotation for cascade delete paths

### Key Lessons
1. Internal function registration is strictly superior to env-var gating — platform-enforced unreachability eliminates an entire class of security bugs
2. Denormalized counters with lazy backfill handle the existing-user problem without requiring data migration
3. Shared constant modules prevent inconsistent bounds across query files — worth the extra indirection
4. Cascade delete paths must remain unbounded — over-bounding silently orphans data
5. Small, focused production-readiness milestones are efficient — 3 independent phases with clear success criteria execute fast

### Cost Observations
- Model mix: budget profile
- Sessions: 1 session for full milestone
- Notable: 4 plans in ~18 minutes total — smallest milestone by plan count, clean execution

---

## Milestone: v4.0 — Bulk Screening & Auto-Rating

**Shipped:** 2026-03-09
**Phases:** 4 | **Plans:** 9 | **Commits:** 42

### What Was Built
- Schema & job infrastructure with screeningJobs/screeningResults tables, dedicated screening workpool, and credit-gated mutations
- Pure scoring engine with per-question point rules, score-to-star threshold mapping, and minimum score filtering
- Background workflow pipeline processing up to 200 papers with AI screening, scoring, library save, and collection assignment
- Configuration dialog with scoring rules editor, star threshold editor, collection picker, cost estimate, and dismiss guards
- Real-time progress tracking via reactive queries and paginated job history list

### What Worked
- Reusing extraction workflow+workpool pattern eliminated design uncertainty — proven infrastructure adapted quickly
- TDD throughout all 4 phases: failing tests first, then implementation, yielding reliable coverage
- Pure-function scoring engine design made unit testing trivial — no Convex context needed
- Phase dependency ordering (schema → scoring → workflow → UI) meant zero back-tracking
- Budget model profile worked well for this feature-build milestone — clean execution without quality issues

### What Was Inefficient
- JOB-07 cancel UI was not implemented despite backend mutation being ready — audit caught the gap
- SUMMARY.md one_liner fields still missing (recurring issue across milestones)
- Roadmap analyze CLI returned 0 phases due to missing phase details format — required manual verification

### Patterns Established
- Separate workpool component for feature isolation (screeningPool independent of extractionPool)
- Configure-vs-progress dialog mode pattern via activeJobId state
- Default scoring config generation from question count (auto sensible defaults)
- reconstructAbstract utility for abstract text recovery from highlight objects
- Status badge variant mapping pattern for job status display

### Key Lessons
1. Reusing proven infrastructure patterns (workflow+workpool) dramatically reduces design time for new features
2. Cancel UI must be planned explicitly as a phase deliverable — backend-only implementation leaves an E2E gap
3. Pure-function scoring engines are highly testable and composable — no framework coupling needed
4. Single-day milestones are achievable for well-scoped feature additions building on existing infrastructure
5. Milestone audit pre-check catches integration gaps that phase-level verification misses

### Cost Observations
- Model mix: budget profile
- Sessions: 1 session for full milestone
- Notable: 9 plans completed in single session — fastest feature-build milestone by velocity

---

## Milestone: v4.1 — Screening Export

**Shipped:** 2026-03-09
**Phases:** 4 | **Plans:** 5 | **Commits:** 21

### What Was Built
- Auth-gated screening export query with ownership check, bounded read, and explicit field mapping
- CSV, JSON, and XLSX export functions with dynamic question columns, answer formatting, and failed/skipped paper handling
- Export dropdown UI on job history cards with format selection, loading spinner, incomplete-job warnings, and 6-locale i18n
- Simplified star thresholds to minScore-only with descending-sort first-match scoring algorithm
- Backward-compatible schema evolution: maxScore removed from write path, kept optional in read validators

### What Worked
- Reuse of established export patterns (extraction/library) for screening export — minimal new design needed
- Linear dependency chain (79→80→81) with independent Phase 82 allowed clean sequential execution
- TDD approach produced high-quality pure functions with comprehensive test coverage (19+ screening export tests)
- Backward-compat schema evolution pattern (remove from write, keep optional in read) worked flawlessly

### What Was Inefficient
- exportLoading translation key added to 6 locale files but never used in component (Loader2 icon used instead) — minor waste
- Phase 82 was additive (not in original milestone scope) — could have been a separate milestone, but small enough to include

### Patterns Established
- Export query pattern: auth gate + ownership check + bounded read + explicit field mapping
- Screening answer formatting: true→Yes, false→No, null/undefined→N/A
- Backward-compat schema evolution: remove field from write schema, keep optional in read validators
- Floor-based threshold matching: sort descending by minScore, first score >= minScore wins

### Key Lessons
1. On-demand `useConvex().query()` is better than reactive `useQuery` for one-shot export actions — no subscription overhead
2. Inline helper duplication (downloadFile) is acceptable when the alternative is cross-module coupling between unrelated features
3. Adding a simplification phase (82) to a feature milestone works when the phase is small and touches the same code surface

### Cost Observations
- Model mix: 100% budget profile (per config)
- Sessions: 1
- Notable: 5 plans completed in ~10 minutes total — fastest per-plan velocity of any milestone (~2min/plan)

---

## Milestone: v5.0 — Extraction Insights Overhaul

**Shipped:** 2026-03-10
**Phases:** 5 | **Plans:** 14 | **Commits:** 65

### What Was Built
- Structural assertion test suite replacing snapshot tests for extraction insights components
- 11 new i18n keys seeded across all 6 locale files before any UI component development
- Color-coded summary cards with threshold-based green/yellow/red accents (CARD-01/02/03)
- Contextual ConfidenceBadge with source tooltip replacing confusing "effective confidence" (CONF-01/02/03)
- Recharts stacked horizontal bars with relative-to-max scaling, lazy-loaded via next/dynamic (BAR-01/02/03/04, INFRA-02)
- Question list status dots (green/yellow/grey) and mini progress bars with completion percentages (QLIST-01/02/03)
- Answer semantic grouping merging case/whitespace/synonym variants with expandable drill-down (GROUP-01/02/03/04)

### What Worked
- i18n keys seeded upfront in Phase 83 prevented missing-key placeholders across all subsequent UI phases
- Structural tests established in Phase 83 allowed confident component iteration in Phases 84-87
- TDD approach across all phases produced 211 new tests with zero regressions (1072+ total suite)
- Pure utility extraction (card-thresholds, bar-scaling, bar-validation, question-status, answer-grouping) enabled isolated testing
- Lazy-loading via next/dynamic successfully deferred ~65KB gzipped Recharts from initial page load
- Zero backend changes — all 6 features consumed existing getJobInsights/getQuestionInsights queries
- Recharts vi.mock pattern for jsdom testing worked reliably across all bar visualization tests

### What Was Inefficient
- SUMMARY.md one_liner fields still not populated by executor (recurring gap from v2.0 onwards)
- Wave 0 test stubs in Phase 85 added an extra plan step — could be integrated into Plan 01 for fewer plans
- Progress table in ROADMAP.md had formatting issues for v5.0 phases (missing milestone column alignment)

### Patterns Established
- i18n-first development: seed all translation keys before component work begins
- Structural tests over snapshots: assert DOM structure and data attributes, not rendered HTML
- Recharts jsdom mock pattern: vi.mock all chart components (BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer)
- renderTooltipContent as pure function export — testable without Tooltip event simulation
- IIFE pattern in JSX for multi-statement derived rendering (synonymMap shared computation)
- next/dynamic with ssr=false for chart library bundle splitting
- isAnimationActive=false on Recharts components for stable jsdom tests

### Key Lessons
1. Seeding i18n keys upfront prevents a class of bugs across all subsequent development phases
2. Structural tests are strictly superior to snapshot tests for UI components that evolve incrementally
3. Recharts lazy-loading via next/dynamic is straightforward and effective for bundle optimization
4. Pure function extraction for all threshold/scaling/grouping logic enables isolated TDD and high test coverage
5. Synonym grouping with MVP scope (case/whitespace/basic) covers common duplicates without NLP complexity

### Cost Observations
- Model mix: 100% budget profile (per config)
- Sessions: 1
- Notable: 14 plans completed in single day — ~4.5min average per plan, 211 new tests

---

## Milestone: v6.0 — Extraction MVP Rebuild

**Shipped:** 2026-04-15
**Phases:** 10 | **Plans:** 29 | **Commits:** 212

### What Was Built
- Scorched-earth teardown of all legacy extraction code (~15,800 LoC), 11 tables, RAG component, and i18n keys across 6 locales
- New slim extraction schema (4 tables) with durable `@convex-dev/workflow`, batched enqueue, idempotent save, and `extractionPool` workpool
- Free-first parsing waterfall: PMC JATS → arXiv HTML → unpdf → Gemini-as-PDF-parser → abstract-only with abort-signal ceilings and 200-page cap
- Three-tier OpenRouter cascade (Gemini 2.5 Flash Lite → Gemini 3 Flash → Claude Haiku 4.5) with flat 7-field Zod schema and per-question parallelism
- Deterministic citation grounding: Levenshtein 85% superRefine, critic pass, `insufficient_evidence` first-class state, UI renders verbatim `slice()` only
- Targeted cancel via per-paper workpoolId, retryable/permanent error taxonomy, early-return guard, reactive progress subscriptions
- Route-segment error boundaries, Clerk visibility-change retry, mutation-to-toast routing
- ULID traceId propagation across all 4 extraction stages, structured JSON logging, per-job metrics query, SLO metric persistence
- Golden set eval framework with `vitest-evals` + `autoevals`, hourly production quality sampling cron, human-review queue backend
- Extraction UI: job creation dialog, live progress with cancel, results cards with verbatim quotes, CSV/JSON/XLSX export, JobMetricsPanel with SLO bars

### What Worked
- Scorched-earth teardown as Phase 1 gave a clean namespace — no dangling references, no dead code confusion
- Free-first parsing waterfall saved LLM costs by resolving most open-access papers via PMC/arXiv before hitting paid Gemini path
- Reusing proven workflow+workpool patterns from screening (v4.0) dramatically reduced extraction orchestration design time
- Structured JSON logging with ULID traceId from day one — no retrofitting observability after the fact
- Error classification module (retryable vs permanent) cleanly separated retry logic from business logic

### What Was Inefficient
- ExtractionDialog `papers` prop never connected — job creation flow is dead in the UI (caught by audit, not during development)
- Quality trend and review queue backends built but never wired to UI consumers — write-only data
- `provider.order` omitted from OpenRouter cascade config despite being in the success criteria
- Phases 94 and 96 show as "Not started" in ROADMAP progress table despite having SUMMARY files — tracking gap
- 3 unsatisfied + 4 partial requirements at audit — higher gap rate than previous milestones

### Patterns Established
- Scorched-earth teardown as prerequisite for rebuild milestones — delete everything first, build on clean slate
- Parsing waterfall pattern: try free sources in cost order, fall back to paid, always have an abstract-only baseline
- OpenRouter cascade with `response-healing` plugin and `@openrouter/ai-sdk-provider` as standard LLM surface
- Levenshtein superRefine + critic pass as deterministic citation grounding — no embeddings needed for hallucination defense
- Per-paper workpoolId for targeted cancel without cross-user blast radius
- ULID traceId propagated through all pipeline stages for grep-friendly incident triage
- `vitest-evals` + `autoevals` as lightweight eval loop suitable for pre-customer MVP stage

### Key Lessons
1. Always wire UI consumers in the same phase that builds the backend query — write-only data is invisible tech debt (EVAL-05, EVAL-06)
2. Dialog prop connections must be verified in integration — ExtractionDialog papers prop was structurally correct but never called with data (UI-01)
3. Milestone audit at 53/63 (84%) is the lowest pass rate yet — larger milestones (10 phases) accumulate more integration gaps than smaller ones
4. Teardown phases should be maximally aggressive — deleting 15,800 LoC in Phase 88 made every subsequent phase simpler
5. OpenRouter's `response-healing` plugin handles most JSON format issues, but `provider.order` must be explicitly set for reliable fallback
6. ROADMAP progress table tracking must be updated atomically with SUMMARY files — stale "Not started" entries on completed phases erode trust

### Cost Observations
- Model mix: budget profile (sonnet/haiku-dominant)
- Sessions: multiple sessions across 2 days
- Notable: Largest milestone yet — 10 phases, 29 plans, 342 files changed, +57K/-28K lines

---

## Milestone: v7.0 — Extraction Workbench

**Shipped:** 2026-04-16
**Phases:** 8 | **Plans:** 23 | **Commits:** 204

### What Was Built
- Hard paper limit (200→1000) with per-tier-ready `EXTRACTION_LIMITS_BY_TIER` map, benchmarked at 3.97 MB typical / 10.31 MB worst-case (Phase 98)
- sessionStorage-backed Zustand basket with `normalizeOpenAlexId` dedupe across 3 ID formats (Phase 99)
- Convex actions `resolveManualIds` + `resolveByDoi`, `tier` field threading through workpool → `createCascadeTiers`, typed `EXTRACTION_LIMIT_EXCEEDED` error (Phase 100)
- TanStack React Table + shadcn `<Table />` primitive, shared `useReactTable` across views, Zustand column visibility (Phase 101)
- "X / 1000" counter, cap-disabled checkboxes, bulk-paste overflow toast, sidebar Extraction badge, `<AddToExtractionButton>` mounts (Phase 102)
- 4-view workbench (table + virtualized card + split + evidence drawer), React 19 `useDeferredValue` search, `/extraction/new` selector with 4 tabs, `parsingSource` badge, `useProtectedQuery` migration (Phase 103)
- Zotero OAuth 1.0a revival (~1433 LoC reconnected), per-item DOI resolution state machine, env-validation cron, dev-guarded purge action (Phase 104)
- ESLint 9 flat config with GAP-03 no-restricted-syntax, global reduced-motion + CSS fallback, mobile responsive, 6-locale parity test, Playwright E2E spec, test:ci chain (Phase 105)
- v6.0 gap closures: UI-01 (job creation reachable), EXTR-01 (TierSelector wired), PARSE-07 (badge rendered), CRASH-02 (useProtectedQuery)

### What Worked
- Benchmark gate in Phase 98 (prove <5 MB before production bump) unblocked all downstream phases with data, not speculation
- Three disjoint phases (99 Zustand basket / 100 Convex actions / 101 UI primitives) parallelized cleanly after Phase 98
- `normalizeOpenAlexId` utility encapsulated 3-format dedupe in one place — no format sprawl across sources
- Re-adding shadcn `<Table />` primitive (not the `data-table` block) gave 4 views shared state via one `useReactTable` instance
- Scoping `@tanstack/react-virtual` to card view only (not table) avoided bundle bloat for the dominant view
- `test:ci` chain extension (lint prepended before test+build+e2e) caught GAP-03 lint violations before 5-min build step

### What Was Inefficient
- Phase 98 never produced VERIFICATION.md — code exists and consumed downstream, but audit trail is incomplete
- `void openEvidence;` suppression in workbench-shell.tsx:132 should have been caught in phase 103 code review — WB-07 chain ended up one-hop-short
- `BasketTriggerButton` shipped as standalone export but never mounted globally — orphan component violates CLAUDE.md rule
- `extraction-dialog.tsx` post-submit wiring missed during integration (no `router.push`, no `basket.clear()`) — regression in SEL-01..SEL-06 flows
- Nyquist wave 0 never closed on 6 of 8 phases — VALIDATION.md `nyquist_compliant: false` accumulated without remediation
- 1161 pre-existing ESLint errors from phases 100-104 surfaced by Phase 105 lint activation — should have been incremental, not end-of-milestone
- Zombie `<ExtractionDialog>` mount in `/extraction` list page survived with no `papers` prop — needs either wiring or deletion
- GAP-03 scope leak: `?? 1000` fallback in `lib/hooks/use-add-to-basket.ts:97` outside ESLint rule scope

### Patterns Established
- **Per-tier-ready constant map**: `EXTRACTION_LIMITS_BY_TIER: Record<Plan, number>` as single source of truth, `MAX = Math.max(...values)` derived; v7.1 tier tuning = edit one constant, zero call-site churn
- **Split internal vs user-facing bounds**: `MAX_EXTRACTION_RESULTS_QUERY` (10000) decoupled from `MAX_EXTRACTION_PAPERS_PER_JOB` (1000) prevents Convex 8 MB surprise
- **sessionStorage Zustand basket** with explicit clear-on-success semantics: survives navigation, resets on submit, tab-scoped
- **Normalized ID utility at source boundaries**: one util handles 3 formats, deduped at add-time not query-time
- **Server-side hard-reject with typed error + i18n toast routing**: `EXTRACTION_LIMIT_EXCEEDED` via `lib/toast/error-resolver.ts` gives UX parity with client cap
- **4-view workbench with shared TanStack instance**: hoist `useReactTable` in WorkbenchShell, views consume via context; column visibility persists in Zustand across jobs
- **Scoped virtualization**: card view virtualizes (`@tanstack/react-virtual`), table does not (1000 rows OK)
- **Drawer pattern for cross-view evidence**: one `EvidenceDrawer` mount serves all 3 views, keyed by `resultId` — rejects 4th-view approach (not all sources are PDFs)
- **OAuth 1.0a verification before migration**: check provider docs before assuming OAuth 2.0 migration (Zotero hasn't)
- **ESLint 9 flat config with progressively specific globs**: two config objects (base + scoped rule), not nested overrides
- **`test:ci` fail-fast chain**: lint → test → build → e2e:auth → e2e:workbench (lint prepended to catch errors before 5-min build)
- **Dev-guarded internal Convex actions**: `purgeStaleZoteroState` + seed actions gated by `process.env.NODE_ENV === 'development'` for destructive ops

### Key Lessons
1. Phase 98 benchmark gate (prove <5 MB before 200→1000 bump) was invaluable — data unblocked all downstream phases without speculative pagination migration
2. Re-adding shadcn primitive (not the block) is the right choice when multiple views need shared state — the block assumes monolithic use
3. Scoping virtualization to card view only, not table view, keeps bundle cost proportional to actual render cost
4. `void someCallback;` as a lint-suppression pattern is a code smell — the callback either belongs or it doesn't; discards signal incomplete integration
5. `normalizeOpenAlexId` at ID boundaries (add-time, not query-time) eliminates an entire class of dedupe bugs across sources
6. Orphan component exports (`BasketTriggerButton` built but never mounted) violate CLAUDE.md — integration tests should catch unmounted exports
7. sessionStorage over localStorage for basket: clears on tab close AND on successful job submit, which matches user mental model of "this is a one-time selection"
8. OAuth 1.0a survives in 2025 — don't assume OAuth 2.0 migration without checking provider docs (Zotero September 2025 still on 1.0a)
9. VERIFICATION.md gap (Phase 98) is a recurring process risk when phases run fast — enforce VERIFICATION.md as gate even for "obvious" changes
10. `test:ci` should start with fastest failure mode (lint) to avoid 5-min build overhead on broken code
11. ESLint rule scope definitions must explicitly enumerate all directories — `lib/hooks/**` slipped past `components/extraction/**` + `app/extraction/**` scope
12. Post-submit navigation + state-clear must be part of integration plan, not assumed; UI-01 regression repeats v6.0 UI-01 pattern
13. Nyquist wave 0 compliance cannot accumulate — enforce at phase close, not milestone audit
14. Pre-existing ESLint errors from earlier phases surfacing at milestone end (1161 from phases 100-104) is a lint-gating regression — catch incrementally, not retroactively

### Cost Observations
- Model mix: budget profile
- Sessions: multiple sessions across 1.5 days
- Notable: 23 plans in 204 commits — higher commit-per-plan ratio than v6.0 due to `auto-advance` chain and doc evolution commits

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Plans | Avg/Plan | Key Change |
|-----------|---------|--------|-------|----------|------------|
| v1.0 | 29 | 3 | 7 | 3min | Established billing audit patterns |
| v1.1 | 25 | 3 | 6 | 2min | Dual-path convergence, i18n integration |
| v1.2 | ~50 | 7 | 11 | 1.5min | Auto-advance pipeline, 3-source audit |
| v2.0 | 63 | 8 | 17 | ~2min | TDD patterns, pure function extraction, vi.mock/resetModules |
| v2.1 | ~181 | 8 | 15 | ~2min | Library feature build, shared components, nuqs URL state, junction tables |
| v2.2 | 34 | 4 | 7 | ~2min | DRY layout infrastructure, factory patterns, chrome shell composition |
| v2.3 | 57 | 8 | 14 | ~2.5min | Hardening sweep, shared crypto, cascade deletion, rate limiting |
| v2.4 | 30 | 4 | 7 | ~3min | Concerns sweep, typed validators, credit guards, cron cleanup |
| v2.5 | 54 | 7 | 15 | ~2min | Tech debt purge, typed Stripe, zero TS errors, audit logging |
| v3.0 | 57 | 6 | 11 | ~2min | Zero as-any, XSS-safe rendering, incremental aggregation, audit table |
| v3.1 | 82 | 12 | 20 | ~5min | Complete type safety, mock factories, zero any in entire codebase |
| v3.2 | 11 | 3 | 4 | ~4.5min | Internal debug endpoints, O(1) library count, query bounding |
| v4.0 | 42 | 4 | 9 | ~3min | Bulk screening feature build, workflow+workpool reuse, TDD scoring engine |
| v4.1 | 21 | 4 | 5 | ~2min | Screening export, pattern reuse, backward-compat schema evolution |
| v5.0 | 65 | 5 | 14 | ~4.5min | Extraction insights overhaul, Recharts lazy-loading, TDD pure utilities, semantic grouping |
| v6.0 | 212 | 10 | 29 | ~7min | Extraction MVP rebuild — scorched-earth teardown, parsing waterfall, OpenRouter cascade, citation grounding, durable workflow, observability, eval framework, extraction UI |
| v7.0 | 204 | 8 | 23 | ~9min | Extraction workbench — 4-view workbench, cross-source selector, 1000-paper cap, Zotero revival, TierSelector wiring, v6.0 gap closures |

### Top Lessons (Verified Across Milestones)

1. Always re-fetch from Stripe API before syncing — event payloads and local DB can be stale (v1.0 + v1.1)
2. ROADMAP.md/REQUIREMENTS.md checkboxes not updating during execution — recurring process gap (v1.0 + v1.1 + v1.2 + v2.0)
3. Audit-first approach prevents regressions and catches orphaned code (v1.0 audit, v1.1 i18n key catch, v1.2 gap closures, v2.1 Phase 26 supersession)
4. Discuss-phase before planning catches design decisions early — skipping it leads to reactive gap closure phases (v1.2)
5. CI env preflight validation must be comprehensive — partial coverage causes confusing runtime failures (v1.2)
6. Pure function extraction is the best mitigation for framework test tooling bugs — test the logic, not the framework (v2.0)
7. Module-load-time env vars require vi.resetModules() + dynamic import — vi.stubEnv alone is insufficient (v2.0)
8. Junction tables for many-to-many in Convex — array fields create cascade delete complexity (v2.1)
9. URL state (nuqs) over local state for filterable views — eliminates sync bugs and enables bookmarkable views (v2.1)
10. Infrastructure-first with prove-on-existing-page strategy reduces rework in shared component builds (v2.2)
11. SUMMARY.md one_liner fields consistently missing — recurring process gap that affects milestone accomplishment extraction (v2.0 + v2.1 + v2.2 + v2.3 + v2.5)
12. Schema-first phases enable clean parallelism — always add optional fields before writing dependent logic (v2.3)
13. Shared utility extraction during hardening milestones is ideal — patterns are understood, not speculative (v2.3)
14. Concerns sweep milestones with complete inventory are high-value, low-risk — zero design overhead, predictable execution (v2.4 + v2.5)
15. Credit-guard pattern (fresh DB read before deduction) is simpler than TOCTOU version fields and handles all cancellation races (v2.4)
16. ROADMAP.md Phase Details sections must be complete for all phases — missing details break CLI tool detection (v2.4)
17. Test safety nets before refactoring catch regressions that would be invisible without coverage (v2.5)
18. Stricter typing in one module cascades TS errors — plan a fix phase alongside type-tightening work (v2.5)
19. Validator-derived types (Infer<typeof validator>) should be default in Convex — eliminates manual type maintenance (v3.0)
20. XSS prevention via text splitting is always preferable to sanitization — correct by construction, zero dependencies (v3.0)
21. Incremental aggregation (upsert on write) with lazy backfill handles scale without loading full datasets (v3.0)
22. Proactive gap closure from milestone audit prevents reactive work — audit-first completion is cleaner (v3.0)
23. `as never` is a better Convex boundary pattern than `as any` — satisfies constraints without widening (v3.1)
24. DeepPartial mock factories eliminate entire categories of `as any` in tests — invest in factory infrastructure early (v3.1)
25. Cross-library type boundaries require generic context types, not action-specific ones — library signatures use generics (v3.1)
26. Complete type safety across 143 files is achievable with systematic layered approach (validators → backend → libs → components → tests) (v3.1)
27. Internal function registration is strictly superior to env-var gating for debug endpoints — platform-enforced unreachability (v3.2)
28. Denormalized counters with lazy backfill avoid data migration while providing O(1) reads (v3.2)
29. Shared constant modules (queryBounds.ts) prevent inconsistent bounds across files — centralize all MAX values (v3.2)
30. Small, focused milestones (3 independent phases) execute cleanly in a single session with zero gap closures (v3.2)
31. Proven infrastructure patterns (workflow+workpool) dramatically reduce new feature design time — reuse over reinvent (v4.0)
32. Cancel/abort UI must be an explicit phase deliverable — backend-only implementation leaves E2E gaps that milestone audit catches (v4.0)
33. Backward-compat schema evolution (remove from write, keep optional in read) is a safe, zero-downtime pattern for field removal (v4.1)
34. On-demand query (useConvex().query()) over reactive subscription (useQuery) for one-shot data fetches like export (v4.1)
35. Seeding i18n keys before UI development prevents missing-key placeholders and enables parallel component development (v5.0)
36. Structural tests over snapshots enable confident UI iteration — component refactors don't trigger test failures (v5.0)
37. Lazy-loading chart libraries via next/dynamic with ssr=false is the standard pattern for bundle optimization (v5.0)
38. Scorched-earth teardown before rebuild eliminates dangling references — delete everything first, build on clean slate (v6.0)
39. Wire UI consumers in the same phase as backend queries — write-only data is invisible tech debt that audit catches too late (v6.0)
40. Larger milestones (10+ phases) accumulate more integration gaps — consider integration checkpoints mid-milestone (v6.0)
41. Free-first parsing waterfalls (PMC → arXiv → paid) minimize LLM cost for open-access-heavy corpora (v6.0)
42. Benchmark-gated cap bumps (prove payload size before raising user-visible limit) unblock downstream phases with data, not speculation (v7.0)
43. Re-add shadcn primitive (not the monolithic block) when multiple views need shared state — one `useReactTable` instance hoisted into shell (v7.0)
44. Scope virtualization to where it's needed (card view: 1000 cards crash; table view: 1000 rows fine) — don't pay bundle cost for unused virtualization (v7.0)
45. `void someCallback;` is a code smell for incomplete integration, not a valid suppression — if the callback belongs, wire it; if not, remove it (v7.0)
46. Orphan component exports (built but never mounted) violate no-dead-code rule — integration tests should catch unmounted public exports (v7.0)
47. ID normalization at source boundaries (add-time) eliminates dedupe bugs across multi-format APIs — one util, 3 formats, consistent dedupe (v7.0)
48. sessionStorage over localStorage when data represents a one-time staging action that should clear on submit AND tab close (v7.0)
49. Don't assume OAuth 2.0 migration without checking provider docs — Zotero still on 1.0a in September 2025 (v7.0)
50. `test:ci` should start with fastest failure mode (lint) to avoid wasting 5-min build time on broken code (v7.0)
51. ESLint rule scope definitions must enumerate ALL directories that can violate — off-scope fallbacks (`lib/hooks/**`) defeat defense-in-depth (v7.0)
52. Nyquist wave 0 compliance cannot accumulate across phases — enforce at phase close, not milestone audit (v7.0)
53. Pre-existing lint errors from earlier phases surfacing at milestone end is a regression — lint must gate incrementally, not retroactively (v7.0)
54. Post-submit navigation + state-clear are part of integration plan, not assumed — UI-01 post-submit regression repeats v6.0 pattern (v6.0 + v7.0)
