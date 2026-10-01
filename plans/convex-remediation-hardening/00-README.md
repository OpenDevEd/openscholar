# Convex Remediation Hardening — Plan Set

Five-plan corrective follow-up to the 2026-04-22 Convex bandwidth remediation rollout.

This plan set exists because a real user-visible library bug escaped the original work:

- `/library?col=...` showed the global total instead of the collection-filtered total,
- pager copy degraded to `20+` / `1+` instead of exact counts,
- the touched test slice was green, but the coverage was too synthetic to catch the real failure,
- `pm2 logs convex` showed typecheck failures during the original rollout window, and
- the post-rollout audit found additional untested edge cases in chat, extraction, AI settings, and screening.

This plan set fixes the product bugs, hardens the coverage, and adds a stricter verification gate so the next pass cannot ship on “green but fake” confidence.

---

## Motivation / gap audit

Grounded issues as of 2026-04-22:

1. **Library count correctness escaped.** The mounted library surface used `getLibraryCount` for the global total and did not have an exact filtered total for collection-scoped views. User-visible effect: `84`-item collection still showed `86`; pager copy showed `20+`.
2. **Library counter invariants are too weak.** [`convex/library/queries.ts`](../../convex/library/queries.ts) currently returns `user.libraryItemCount ?? 0`, so a user row with missing denormalized count can render as empty even if library rows exist.
3. **The library page tests are too synthetic.** [`tests/components/library-page-client.test.tsx`](../../tests/components/library-page-client.test.tsx) mocks protected queries by hook call order and mostly asserts mounted-query args, not user-visible filtered totals/range copy.
4. **Plan-touched code is not type-clean.** `pnpm tsc --noEmit` currently fails in touched or immediately-adjacent files, including [`components/library/collection-picker.tsx`](../../components/library/collection-picker.tsx).
5. **Chat read-model edge cases are under-tested.** [`convex/chat/messages.ts`](../../convex/chat/messages.ts) introduced hard read caps without a test that forces cap exhaustion on tool-heavy threads.
6. **Suggestion-chip count can underreport during bootstrap.** The current count comes from `rows.length` after a defensive source/chatPaper join that can temporarily skip mirrored rows.
7. **AI settings collapses fetch failure into empty state.** [`app/settings/ai/page.tsx`](../../app/settings/ai/page.tsx) catches `convex.query(...)` failure and sets `[]`, which can render like “no models found” instead of an error/retry state.
8. **Sidebar progress can show `100%` too early.** [`components/app-sidebar.tsx`](../../components/app-sidebar.tsx) recomputes progress from raw counts instead of using the query’s already-capped `percentComplete`.
9. **The current gate is not strong enough.** Targeted Vitest is necessary but insufficient for these user-visible async flows; Next.js local docs explicitly recommend E2E for async Server Components and page-level behavior.

---

## Locked design decisions

Locked on 2026-04-22 after source audit, subagent review, Convex guidance, and local Next.js docs:

| # | Decision | Why |
|---|---|---|
| **D1** | **User-visible filtered totals are a product contract, not an implementation detail.** | They must be tested at rendered-copy level, not only via mounted query mocks. |
| **D2** | **`users.libraryItemCount` remains the primary library total source, but missing counters are treated as invariant breaches.** | Keep the fast path, but stop silently blessing `0` as correct when rows exist. |
| **D3** | **Chat source count must come from an authoritative source count, not only from joined rows surviving bootstrap.** | Avoid empty-state undercount flicker while keeping the defensive row join. |
| **D4** | **`listThreadMessages` may keep read caps only if visible-page integrity is preserved and tested.** | Cap exhaustion must not silently truncate user-visible history. |
| **D5** | **Settings fetch failure must render as failure, not as empty data.** | Avoid false “no models” UX on transient backend/auth/network errors. |
| **D6** | **Sidebar must trust shared progress output (`percentComplete`) instead of recomputing locally.** | The shared helper already encodes capping semantics for processing jobs. |
| **D7** | **The permanent gate is multi-layered: targeted Convex/query tests, behavioral component tests, Playwright smoke for page-level state, and typecheck.** | The escaped bug came from relying on only one layer. |
| **D8** | **No new npm package is needed.** | Playwright, Vitest, Convex test harnesses, and pm2 logs already exist in the repo. |
| **D9** | **No compatibility shims or legacy dual paths.** | Repair invalid dev data directly; keep runtime code clean and intentional. |

---

## Plan-file inventory

```text
plans/convex-remediation-hardening/
├── 00-README.md
├── 01-correctness-and-type-restoration.md
├── 02-library-coverage-hardening.md
├── 03-chat-and-extraction-edge-hardening.md
├── 04-settings-and-screening-hardening.md
└── 05-verification-gate-and-browser-smoke.md
```

Summary:

- **01** fixes the escaped product bugs and restores type safety on the touched surface.
- **02** replaces synthetic library confidence with behavior and invariant coverage.
- **03** closes the chat/extraction edge cases found in the audit.
- **04** hardens AI settings and screening behavior plus their missing tests.
- **05** adds the durable verification gate and browser-level smoke coverage.

---

## Dependency graph

```text
01 correctness + type restoration
├──► 02 library coverage hardening
├──► 03 chat + extraction edge hardening
├──► 04 settings + screening hardening
└──► 05 verification gate + browser smoke

02 ─┐
03 ─┼──► 05
04 ─┘
```

Ship order recommendation: **01 → (02, 03, 04 in parallel) → 05**.

---

## Reuse / DRY notes

Primary donors and existing repo patterns to reuse:

- **`tests/components/library-page-client.test.tsx`** — keep the existing page-client harness, but replace call-order mocks with query-ref-aware fixtures.
- **`convex/library/queries.test.ts`** — donor for library count and pagination query tests; extend rather than creating parallel files.
- **`e2e/chat-mode.spec.ts`** and **`e2e/chat-sources-toggle.spec.ts`** — donor Playwright conventions for authenticated chat flows.
- **`tests/components/ai-settings-page-mounted-queries.test.tsx`** and **`tests/components/app-sidebar-screening-query.test.tsx`** — donors for the current settings/screening test harnesses; harden them instead of rewriting from scratch.
- **`tests/components/billing-page-mounted-queries.test.tsx`** — donor for mounted-query regression assertions when trimming live subscriptions.
- **`lib/auth/use-auth-query.ts`** and existing protected-query wrappers — keep them as the client access path; do not introduce a parallel fetching abstraction.
- **Existing Playwright setup** in [`playwright.config.ts`](../../playwright.config.ts) and [`e2e/`](../../e2e/) — use the existing browser stack, not a new test runner.
- **`convex/_generated/ai/guidelines.md`** — still authoritative for all Convex query/mutation edits.

Do not introduce:

- a new test runner,
- class-string assertions,
- a second library count source of truth,
- a second source-count derivation path for chat,
- legacy fallbacks kept “just in case.”

---

## Testing doctrine

This plan set follows the project’s testing doctrine and the local Next.js testing guidance:

- **Behavior first.** Assert on text, roles, ARIA, and `data-*` contracts.
- **No class-name assertions.**
- **Convex query tests** cover data-shape and invariant behavior.
- **Component tests** cover rendered copy and state transitions.
- **Playwright smoke** covers page-level flows that are too synthetic in JSDOM or involve async page behavior.
- **Typecheck is part of the deliverable.**

Specific doctrine for this plan set:

1. Library totals, pager range copy, and export affordances must be asserted from rendered UI.
2. Chat/extraction edge cases must be forced, not inferred from happy-path fixtures.
3. Failure-path UI must be tested explicitly; empty and error are different states.
4. New browser smoke should target only the highest-signal page-level contracts:
   - library filtered total/range,
   - at least one chat/extraction count flow,
   - one settings/screening regression path if setup cost is acceptable.

---

## Migration stance

Destructive dev-data stance still applies.

- If `users.libraryItemCount` is missing or wrong on dev rows, repair or recompute it directly.
- Do not preserve bad rows for compatibility.
- No schema migration is expected.
- If a cleaner fix is to reset a dev-only table or rerun a bounded repair helper, do that instead of carrying runtime ambiguity.

---

## Delegation policy

Use subagents aggressively for bounded audits during execution.

Recommended delegation targets:

- map all consumers of a touched query before changing it,
- inspect existing Playwright auth/data setup before adding a new smoke,
- trace all library counter writers before finalizing invariant tests,
- inspect source-count callers before changing chat bootstrap behavior,
- inspect existing settings/screening tests so new assertions reuse current fixtures.

Keep in the main session:

- red → green → refactor loops,
- plan-file updates,
- commits,
- final verification runs.

---

## Grounding sources

Repo sources:

- [components/library/library-page-client.tsx](../../components/library/library-page-client.tsx)
- [components/library/collection-picker.tsx](../../components/library/collection-picker.tsx)
- [convex/library/queries.ts](../../convex/library/queries.ts)
- [convex/library/queries.test.ts](../../convex/library/queries.test.ts)
- [tests/components/library-page-client.test.tsx](../../tests/components/library-page-client.test.tsx)
- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- [convex/chat/sourceReadModel.ts](../../convex/chat/sourceReadModel.ts)
- [components/extraction/chat/suggestion-chips.tsx](../../components/extraction/chat/suggestion-chips.tsx)
- [components/extraction/chat/papers-context.tsx](../../components/extraction/chat/papers-context.tsx)
- [app/extraction/[jobId]/page.tsx](../../app/extraction/%5BjobId%5D/page.tsx)
- [app/settings/ai/page.tsx](../../app/settings/ai/page.tsx)
- [components/app-sidebar.tsx](../../components/app-sidebar.tsx)
- [tests/components/ai-settings-page-mounted-queries.test.tsx](../../tests/components/ai-settings-page-mounted-queries.test.tsx)
- [tests/components/app-sidebar-screening-query.test.tsx](../../tests/components/app-sidebar-screening-query.test.tsx)
- [playwright.config.ts](../../playwright.config.ts)
- [e2e/chat-mode.spec.ts](../../e2e/chat-mode.spec.ts)
- [e2e/chat-sources-toggle.spec.ts](../../e2e/chat-sources-toggle.spec.ts)
- [convex/_generated/ai/guidelines.md](../../convex/_generated/ai/guidelines.md)

Skills and local guidance:

- [convex-performance-audit skill](../../.agents/skills/convex-performance-audit/SKILL.md)
- [Next.js Vitest guide](../../node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md)

Runtime sources:

- `pm2 logs convex --lines 120 --nostream` on 2026-04-22
- targeted `vitest` runs over the plan-touched slice on 2026-04-22
- `pnpm tsc --noEmit` on 2026-04-22
