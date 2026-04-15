# Phase 94: Crash Prevention Sweep - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 94-crash-prevention-sweep
**Areas discussed:** Error boundary scope, useQuery audit scope, Clerk visibility retry, Mutation rejection routing, Prompt injection delimiters, AbortSignal coverage, Zustand migration strategy

---

## Error Boundary Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All extraction-facing routes | Add error.tsx to results/ and settings/ now; extraction/ deferred to Phase 97 | |
| All app routes | Add error.tsx to every route segment in app/ | |

**User's choice:** [auto] All extraction-facing routes (recommended default)
**Notes:** `app/extraction/` does not exist yet (created in Phase 97). Root `app/error.tsx` already exists. Only `app/results/error.tsx` and `app/settings/error.tsx` are needed now.

---

## useQuery Audit Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Extraction UI only | Focus audit on extraction-related components | |
| Full codebase audit | Audit every useQuery call site across the app | |

**User's choice:** [auto] Extraction UI only (recommended default)
**Notes:** `evidence-quote.tsx` already defensive. Auth-wrapped hooks solid. Settings pages use conditional skip. Grep-backed lint test prevents regressions.

---

## Clerk Visibility Retry Approach

| Option | Description | Selected |
|--------|-------------|----------|
| visibilitychange + single retry | Listen for tab visibility change, retry auth sync with cooldown | |
| Polling-based keepalive | Periodic auth state check every N seconds | |
| No retry | Rely on page refresh | |

**User's choice:** [auto] visibilitychange + single retry (recommended default)
**Notes:** `retryUserSync` callback already exists in `convex-provider.tsx`. Just needs a `visibilitychange` event listener. 5-second cooldown between retries.

---

## Mutation Rejection Routing Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Fix known gaps + extraction | Fix 4 identified components with missing/swallowed catches | |
| Fix all + wrapper hook | Create useToastOnMutationError wrapper and apply everywhere | |

**User's choice:** [auto] Fix known gaps + extraction (recommended default)
**Notes:** 4 gaps identified: `rating-selector.tsx`, `focus-mode.tsx`, `library-page-client.tsx`, `settings/connections/page.tsx`. Use existing `useAppToast()` and `error-resolver.ts`.

---

## Prompt Injection Delimiter Design

| Option | Description | Selected |
|--------|-------------|----------|
| Per-request UUID delimiters | `<<<uuid>>>...<<</uuid>>>` with system prompt trust instruction | |
| Static XML-style tags | `<evidence>...</evidence>` with instruction | |
| Hash-based delimiters | SHA-256 of request metadata as delimiter | |

**User's choice:** [auto] Per-request UUID delimiters (recommended default)
**Notes:** UUID is unpredictable per-request, making injection significantly harder than static delimiters. Applied to `buildExtractionPrompts` and `buildCriticPrompt`.

---

## AbortSignal Coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Already complete | All convex/extraction/ fetches have AbortSignal.timeout | |
| Extend to other modules | Audit and add timeouts to non-extraction fetch calls | |

**User's choice:** [auto] Already complete (recommended default)
**Notes:** `parse.ts` has 20s-120s timeouts on all sources. `extract.ts` has 60s/30s on LLM/critic calls. `errors.ts` classifies AbortError as retryable. Add grep test to prevent regressions.

---

## Zustand Migration Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Collapse to v1 + version all stores | Reset search-history ladder, add version:1 to unversioned stores | |
| Keep existing ladders | Only add versions to unversioned stores, preserve migration chains | |
| Nuclear reset | Clear all localStorage on version bump | |

**User's choice:** [auto] Collapse to v1 + version all stores (recommended default)
**Notes:** 7-step search-history ladder collapsed to single v1 migration. AI config (v5) collapsed to v1. All 8+ unversioned persisted stores get `version: 1` with default-state migration.

## Claude's Discretion

- Error boundary recovery UI wording and i18n keys
- useQuery grep test implementation (shell script vs Vitest)
- Exact Clerk retry cooldown duration
- UUID generation location (inline vs parameter)
- Individual mutation fixes vs wrapper hook approach
- Test fixture design

## Deferred Ideas

None -- discussion stayed within phase scope.
