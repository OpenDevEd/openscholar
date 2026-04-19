# Plan 01 — Unified Error Taxonomy & Structured Error Persistence

**Depends on:** nothing. **Blocks:** 03, 05, 06, 07.

## Goal

Stop losing error information. Today `createError("AI_INSUFFICIENT_CREDITS", msg)` is thrown but only the message string is persisted — the code is discarded. Refactor so (a) every extraction error persists a structured `{ code, message, context?, retryable, httpStatus?, providerName? }` shape, (b) chat and extraction share one codebook, (c) an append-only per-paper history survives unlimited retries.

Closes gap #5 (structured errors), #10 (error history). Foundation for #3 (retryable classification), #2 (detect credit exhaustion by code), #8 (UI shows title/body per code).

## Scope

**In scope**
- New `lib/errors/taxonomy.ts` — canonical list of error codes + `isRetryable` predicate + provider/network-error classifier.
- New `extractionPaperErrors` table (append-only history).
- Schema refactor: `extractionJobs.errorMessage: string` → `errorCode + errorMessage + errorContext` (breaking, user approved).
- Schema refactor: `extractionPapers.errorMessage: string` → same, plus link to error-history table.
- Translations: merge chat's in-flight `chatErrorTitle`/`chatErrorBody` blocks into a shared `errors.title` / `errors.body` namespace. Chat keys become thin references.
- Error-resolver refactor: `lib/toast/error-resolver.ts` consumes taxonomy.
- Tests for taxonomy and classifier logic.

**Out of scope**
- Pre-flight check (plan 03).
- Retry UI (plan 05).
- `creditsExhausted` status (plan 03).

## Error codes (single codebook)

| Code | Retryable | Applies to | Description |
|---|---|---|---|
| `insufficient_credits` | ✓ after top-up | chat, extraction | Credit balance insufficient to continue. |
| `rate_limit` | ✓ with backoff | chat, extraction | 429 from LLM or embedding provider. |
| `model_unavailable` | ✓ | chat, extraction | 503 or model deprecated/down. |
| `auth` | ✗ (ops fix) | chat, extraction | Provider auth failure (bad API key). |
| `moderation` | ✗ | chat, extraction | Content filter rejected input. |
| `context_too_long` | ✗ without source change | chat, extraction | Token limit exceeded. |
| `network` | ✓ | chat, extraction | Transient fetch/timeout. |
| `provider_5xx` | ✓ | chat, extraction | Generic 5xx from upstream. |
| `aborted` | ✓ | chat, extraction | User-initiated stop. |
| `action_timeout` | ✓ if decomposed | extraction | Hit the 10-min ceiling (plan 02 reduces this to ~zero). |
| `pdf_download_failed` | ✓ once, then ✗ | extraction | HTTP error, 404, non-PDF response. |
| `pdf_invalid` | ✗ | extraction | Corrupt/encrypted/scanned-only PDF. |
| `paper_not_found` | ✗ | extraction | OpenAlex lookup returned null. |
| `indexing_failed` | ✓ | extraction | RAG embedding failure. |
| `llm_content_refusal` | ✗ | extraction | Model refused to answer for policy reasons. |
| `schema_validation` | ✗ | extraction | Extractor produced output that violated the per-question schema. |
| `cancelled` | n/a | chat, extraction | User cancelled the job. |
| `unknown` | ✓ | chat, extraction | Uncaught; treat as transient. |

`isRetryable(code)` returns the table's column. Unlimited attempts per paper (user decision: "unlimited while credits last").

## Design

### 1. `lib/errors/taxonomy.ts`

```ts
export const ERROR_CODES = [
  "insufficient_credits","rate_limit","model_unavailable","auth","moderation",
  "context_too_long","network","provider_5xx","aborted","action_timeout",
  "pdf_download_failed","pdf_invalid","paper_not_found","indexing_failed",
  "llm_content_refusal","schema_validation","cancelled","unknown",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const isRetryable: Record<ErrorCode, boolean> = { ... };

export function classifyUnknownError(err: unknown): { code: ErrorCode; message: string; httpStatus?: number; providerName?: string; context?: unknown } {
  // Fingerprint based on: ConvexError.data.code → ConvexError.message patterns → HTTP status → generic network/AbortError patterns.
  // Map "AI_INSUFFICIENT_CREDITS" (from lib/errors.ts) → "insufficient_credits".
  // Map "INSUFFICIENT_CREDITS" (app-level) → "insufficient_credits".
  // Map AbortError → "aborted". Fetch TypeError → "network". 429 → "rate_limit". etc.
}

export const errorCodeValidator = v.union(...ERROR_CODES.map(c => v.literal(c)));
```

### 2. Schema changes (`convex/schema.ts`)

```ts
extractionJobs: defineTable({
  // ... existing fields ...
  // OLD: errorMessage: v.optional(v.string()),
  // NEW:
  error: v.optional(v.object({
    code: errorCodeValidator,
    message: v.string(),
    context: v.optional(v.any()),    // serialized extra info; bounded <1KB
    httpStatus: v.optional(v.number()),
    providerName: v.optional(v.string()),
    at: v.number(),
  })),
})

extractionPapers: defineTable({
  // ... existing fields ...
  // OLD: errorMessage: v.optional(v.string()),
  // NEW:
  lastError: v.optional(v.object({ /* same shape as above */ })),
  // attempt counter — bounded small int
  attemptCount: v.optional(v.number()),
})

extractionPaperErrors: defineTable({
  paperId: v.id("extractionPapers"),
  jobId: v.id("extractionJobs"),
  attempt: v.number(),           // 1-indexed
  at: v.number(),
  code: errorCodeValidator,
  message: v.string(),
  httpStatus: v.optional(v.number()),
  providerName: v.optional(v.string()),
  context: v.optional(v.any()),
}).index("by_paper", ["paperId"])
  .index("by_job", ["jobId"]),
```

Why a separate table (and not an array on the paper)?
- Project guidelines.md:157 forbids unbounded arrays in docs.
- User wants unlimited retries while credits last.
- Separate table gives us per-attempt pagination + query by job.

### 3. Persistence hooks

Every `try/catch` in extraction maps to taxonomy before persisting:

- `convex/extraction/workpoolActions.ts:570-742` — both catches. Replace `errorMessage: toErrorMessage(e)` with `error: classifyUnknownError(e)` in the returned RunResult.
- `convex/extraction/mutations/internal/onComplete.ts:57-205` — `failPaperAndFinalize` signature changes from `(error: string)` to `(error: ClassifiedError)`. Internally: insert into `extractionPaperErrors`, patch `paper.lastError`, increment `attemptCount`.
- `convex/extraction/mutations/internal/onComplete.ts:237-266` — `handleExtractionJobComplete`: reclassify the workflow's `result.error` string → taxonomy code before patching `extractionJobs.error`.

### 4. Translation unification

Current chat work (uncommitted) adds `messages/en-US.json`:
```
"chatErrorTitle": { "rate_limit": "The model is busy", ... },
"chatErrorBody": { "rate_limit": "Upstream capacity...", ... }
```

Lift to shared namespace:
```
"errors": {
  "title": { "rate_limit": "...", ... },   // superset of codes
  "body":  { "rate_limit": "...", ... }
}
```

Chat UI consumer reads `useTranslations("errors")`. Extraction consumer reads the same. Existing `chatErrorTitle`/`chatErrorBody` deleted (user's "no legacy compatibility" rule). Apply to all locales in `messages/*.json`.

### 5. Error-resolver refactor

`lib/toast/error-resolver.ts:71` currently maps `INSUFFICIENT_CREDITS → "convexInsufficientCredits"` (a toast key). Refactor so it:
1. Calls `classifyUnknownError(err)` → `{ code, message, ... }`.
2. Returns `{ titleKey: `errors.title.${code}`, bodyKey: `errors.body.${code}`, retryable, ... }`.
3. Toast/inline UIs render from that.

## TDD sequence (pure logic only — `lib/errors/taxonomy.ts`)

Write and watch fail → implement → refactor, one red at a time. Commit after each green.

```
R1 → G1   test: ERROR_CODES is a readonly tuple of 18 strings
R2 → G2   test: isRetryable.insufficient_credits === true
R3 → G3   test: isRetryable.pdf_invalid === false  (and every non-retryable)
R4 → G4   test: isRetryable.rate_limit === true    (and every retryable)
R5 → G5   test: classifyUnknownError(new ConvexError({data:{code:"INSUFFICIENT_CREDITS"}}))
          → {code:"insufficient_credits", message:<msg>, retryable:true}
R6 → G6   test: classifyUnknownError(new ConvexError({message:"INSUFFICIENT_CREDITS: need 50"}))
          → code "insufficient_credits"  (prefix-message fallback)
R7 → G7   test: DOMException with name:"AbortError" → code "aborted"
R8 → G8   test: TypeError with message matching /fetch failed|network/i → code "network"
R9 → G9   test: Error with httpStatus:429 → code "rate_limit"
R10→ G10  test: Error with httpStatus:503 → code "provider_5xx"
R11→ G11  test: httpStatus 401|403 → code "auth"
R12→ G12  test: message /content filter|moderation|safety/i → code "moderation"
R13→ G13  test: message /context length|token limit|too long/i → code "context_too_long"
R14→ G14  test: message /timed out|deadline/i → code "action_timeout"
R15→ G15  test: anything else falls through → code "unknown", retryable:true
R16→ G16  test: classifyUnknownError caps context to ≤ 4KB when serialized
R17→ G17  test: errorCodeValidator (Convex v.union) accepts every ERROR_CODES entry and rejects "bogus"
REFACTOR  extract the /regex/ → code mapping into a const table; re-run full suite green
```

Only after this file is fully green does any Convex/schema/translation work begin. Schema and persistence work is test-after (mocking Convex ctx for TDD has diminishing returns — one behavior test per hook in the Test plan section below).

## Files touched

- `lib/errors/taxonomy.ts` (new)
- `lib/errors/taxonomy.test.ts` (new)
- `lib/toast/error-resolver.ts` (refactor)
- `convex/schema.ts` (error column shape; new `extractionPaperErrors` table + 2 indexes)
- `convex/extraction/workpoolActions.ts` (catch sites, ~6 call sites)
- `convex/extraction/mutations/internal/onComplete.ts` (`failPaperAndFinalize`, `handleExtractionJobComplete`)
- `convex/extraction/paperLifecycle.ts` (`markPaperTerminalTx` signature)
- `convex/extraction/validators.ts` (`errorCodeValidator` export)
- `convex/lib/errors.ts` (deprecate `createError(code, msg)` wrappers that throw untyped — route through taxonomy)
- `messages/*.json` (all 6 locales — add `errors.*`, remove `chatErrorTitle`/`chatErrorBody`)
- `components/chat/**` (any consumer reading `chatErrorTitle`/`chatErrorBody` — update to shared namespace). Grep first for keys.

## Migration — **none (dev data is disposable)**

Per `00-README.md` migration stance: no backfill script.

1. Change `convex/schema.ts` — drop `errorMessage`, add `error` on jobs + `lastError`/`attemptCount` on papers + new `extractionPaperErrors` table.
2. Deploy. If the schema validator rejects existing rows with the old `errorMessage` field, **wipe the extraction tables** via the Convex dashboard (or an admin helper mutation gated to `dev`).
3. Start fresh.

Do NOT write a backfill. Do NOT keep `errorMessage` as optional for compat. The user has authorized destructive evolution.

## Test plan

**Unit (lib/errors/taxonomy.test.ts)**
- `classifyUnknownError` fingerprints each of the 18 codes from representative error shapes.
- `isRetryable` table covers every code.
- `classifyUnknownError(new ConvexError({ code: "INSUFFICIENT_CREDITS" }))` → `insufficient_credits`.
- `classifyUnknownError(new AbortError())` → `aborted`.
- Fetch TypeError → `network`. HTTP 429 → `rate_limit`. HTTP 503 → `provider_5xx`.

**Convex tests (`convex/extraction/*.test.ts`)**
- `handleExtractionComplete` with `onFailed(CreditError)` → `extractionPaperErrors` row written with `code="insufficient_credits"`, `attempt=1`; `paper.lastError.code === "insufficient_credits"`.
- Second failure for same paper → `attempt=2`, second row. Unbounded retries respected.
- `handleExtractionJobComplete` with workflow throw → `job.error.code` populated.

**UI tests (React Testing Library, behavior-first)**
- Toast renders the localized title+body by code, not a raw string. Assert via `getByRole("alert")` + `toHaveTextContent(...)`, not className.
- Expose `data-error-code` on the toast container; assert on that attribute.

## Acceptance criteria

- [ ] Every extraction failure (job + paper) stores a structured `error` object with a code from taxonomy.
- [ ] `extractionPaperErrors` rows accumulate one per retry attempt, queryable by `by_paper` and `by_job`.
- [ ] Chat and extraction both read titles/bodies from `errors.title.*` / `errors.body.*` (no `chatErrorTitle`/`chatErrorBody` anywhere).
- [ ] Migration runs idempotently against existing dev data.
- [ ] `classifyUnknownError` test coverage ≥ 95% of codes.
- [ ] `rg -n "errorMessage:" convex/` returns zero references in extraction files (only legitimately-named unrelated fields remain).

## Known pitfalls

- **Chat uncommitted work**: do this plan's translation merge in a single commit that both removes `chatErrorTitle`/`chatErrorBody` and adds `errors.*`. Coordinate with the chat work's commit — if chat lands first, consume its keys; if this lands first, delete and replace.
- **Context field**: `v.any()` on `context` is dangerous. Cap serialized size at 4KB in `classifyUnknownError` to prevent 1MB doc bloat.
- **History table growth**: one row per retry per paper. At unlimited retries, a pathologically failing paper could accumulate many rows. Acceptable — plan 07 adds a "clear error history" admin mutation; plan 05's retry-classification short-circuits obvious non-retryable errors.
