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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Plans | Avg/Plan | Key Change |
|-----------|---------|--------|-------|----------|------------|
| v1.0 | 29 | 3 | 7 | 3min | Established billing audit patterns |
| v1.1 | 25 | 3 | 6 | 2min | Dual-path convergence, i18n integration |
| v1.2 | ~50 | 7 | 11 | 1.5min | Auto-advance pipeline, 3-source audit |
| v2.0 | 63 | 8 | 17 | ~2min | TDD patterns, pure function extraction, vi.mock/resetModules |
| v2.1 | ~181 | 8 | 15 | ~2min | Library feature build, shared components, nuqs URL state, junction tables |

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
