# Phase 96: Eval Loop & Quality Sampling - Research

**Researched:** 2026-04-15
**Domain:** LLM evaluation framework, production quality monitoring, Convex cron/table patterns
**Confidence:** HIGH

## Summary

Phase 96 introduces three complementary quality mechanisms: (1) a 20-case golden set evaluated via `vitest-evals` + `autoevals` in CI, (2) an hourly Convex cron that samples production answers through the existing critic infrastructure, and (3) queries exposing quality trends and a human-review queue for golden-set growth.

The technical risk is low. The eval framework (`vitest-evals` by Sentry + `autoevals` by Braintrust) is well-documented, the Convex patterns are established in this codebase (7 existing crons, auth-gated queries, internal actions), and the extraction pipeline's pure `extractAnswers()` function is directly callable from test code. The main integration points -- schema addition, cron registration, and CI workflow extension -- all follow existing patterns with clear precedent.

**Primary recommendation:** Implement in three waves: (1) golden set data + eval test infrastructure, (2) CI gating workflow, (3) Convex cron + quality trend queries + review queue.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01 through D-04: Golden set structure in `tests/evals/screening-golden.ts` as typed const array with specific interface shape
- D-05 through D-09: Eval test runner using `vitest-evals` `describeEval` + `autoevals` Factuality scorer, gated by `RUN_EVALS=1`
- D-10 through D-11: CI job with `paths` filter on extraction directories, canary test for gate verification
- D-12 through D-15: Hourly cron in `convex/crons.ts`, `qualitySampling.ts` module with specific schema
- D-16 through D-18: `getQualityTrend` public query returning 7-day rolling counts
- D-19 through D-22: Human-review queue with `reviewStatus` field, `getReviewQueue` query, `updateReviewStatus` mutation

### Claude's Discretion
- Exact Factuality scorer prompt configuration -- follow library defaults
- Whether random sampling uses simple offset or restricts to recent results
- CI workflow YAML structure -- add to existing or create dedicated `evals.yml`
- Test fixture excerpts for golden set cases
- Whether `getReviewQueue` includes pagination or simple `.collect()` with bound

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVAL-01 | 20-case hand-labeled golden set in `tests/evals/screening-golden.ts` | `describeEval` data pattern with typed `GoldenCase` interface; `extractAnswers()` is pure async callable from test |
| EVAL-02 | Run golden set via `vitest-evals` + `autoevals` with Factuality and citation-substring-match scorers | `describeEval` supports custom scorer functions returning `{ score: number }`; Factuality from autoevals integrates directly |
| EVAL-03 | CI blocks merges when recall < 95% or citation-validity < 98% | GitHub Actions `paths` filter + `threshold` in describeEval + aggregate assertion pattern |
| EVAL-04 | Hourly cron samples 1 production answer, runs critic, writes to `qualityChecks` | Existing cron pattern in `convex/crons.ts`; `buildCriticPrompt` reusable from `lib/ai/core/prompts.ts` |
| EVAL-05 | `getQualityTrend` returns 7-day rolling counts | Auth-gated query pattern with `by_timestamp` index on `qualityChecks` |
| EVAL-06 | Unsupported samples land in human-review queue for golden-set growth | `reviewStatus` field with `getReviewQueue` query + `updateReviewStatus` mutation |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Golden set data + eval tests | Test infrastructure (vitest) | -- | Pure test-time code, never deployed |
| Factuality scoring | Test infrastructure (vitest) | External API (OpenAI/OpenRouter) | autoevals calls an LLM for factuality judgment |
| Citation-substring-match scoring | Test infrastructure (vitest) | -- | Pure function using fastest-levenshtein |
| CI gating | GitHub Actions | -- | Workflow YAML + path filtering |
| Hourly quality sampling cron | API / Backend (Convex) | External API (OpenRouter) | Convex cron -> internalAction -> LLM critic |
| qualityChecks table | Database / Storage (Convex) | -- | New table with indexes |
| Quality trend query | API / Backend (Convex) | -- | Auth-gated public query |
| Human-review queue query | API / Backend (Convex) | -- | Auth-gated public query + mutation |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest-evals | 0.7.0 | Eval test framework built on vitest | [VERIFIED: npm registry] Sentry's eval framework, `describeEval` pattern integrates into existing vitest setup |
| autoevals | 0.0.132 | LLM-as-judge scorers (Factuality) | [VERIFIED: npm registry] Braintrust's scorer library, provides `Factuality` function compatible with vitest-evals |
| fastest-levenshtein | 1.0.16 | Citation substring-match scoring | [VERIFIED: already installed] Same library used in runtime extraction (Phase 92) |
| vitest | 3.2.4 | Test runner | [VERIFIED: package.json] Already installed, eval tests run within existing vitest infrastructure |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @openrouter/ai-sdk-provider | 6.0.0-alpha.1 | OpenRouter LLM access for hourly sampling | [VERIFIED: package.json] Already installed, used by extraction cascade and critic |
| ai | 6.0.62 | Vercel AI SDK for generateText in sampling action | [VERIFIED: package.json] Already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vitest-evals | Raw vitest describe/it | vitest-evals provides `describeEval` with built-in threshold gating and scorer integration -- less boilerplate |
| autoevals Factuality | Custom LLM-as-judge prompt | autoevals has a validated prompt template for factuality; custom prompts need iteration |
| Separate evals.yml | Extend existing ci.yml | Separate file is cleaner for path-filtered evals-only job; avoids complexity in existing CI |

**Installation:**
```bash
pnpm add -D vitest-evals autoevals
```

**Version verification:**
- vitest-evals: 0.7.0 [VERIFIED: `npm view vitest-evals version`]
- autoevals: 0.0.132 [VERIFIED: `npm view autoevals version`]

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────┐
                     │            CI / Developer                │
                     │                                         │
                     │  RUN_EVALS=1 pnpm test tests/evals/    │
                     │         │                               │
                     │         v                               │
                     │  ┌─────────────────────┐                │
                     │  │ screening-eval.test  │                │
                     │  │  describeEval()      │                │
                     │  └────────┬────────────┘                │
                     │           │                             │
                     │     ┌─────┴──────┐                      │
                     │     v            v                      │
                     │  extractAnswers() Factuality scorer     │
                     │  (pure async)    (autoevals LLM call)   │
                     │     │            │                      │
                     │     v            v                      │
                     │  ┌─────────────────────┐                │
                     │  │ Aggregate thresholds │                │
                     │  │ recall >= 95%        │                │
                     │  │ citation >= 98%      │                │
                     │  └─────────────────────┘                │
                     └─────────────────────────────────────────┘

                     ┌─────────────────────────────────────────┐
                     │         Convex Runtime (Production)      │
                     │                                         │
                     │  crons.ts ──hourly──> qualitySampling   │
                     │                       .sampleAndCheck   │
                     │                            │            │
                     │              ┌─────────────┼──────┐     │
                     │              v             v      │     │
                     │    extractionResults  buildCriticPrompt │
                     │    (random sample)    + generateText    │
                     │              │             │      │     │
                     │              v             v      │     │
                     │         qualityChecks table       │     │
                     │         (verdict, judgeModel,     │     │
                     │          timestamp, reviewStatus)  │     │
                     │              │                    │     │
                     │     ┌────────┴────────┐          │     │
                     │     v                v           │     │
                     │  getQualityTrend  getReviewQueue │     │
                     │  (7-day rolling)  (pending items)│     │
                     └─────────────────────────────────────────┘
```

### Recommended Project Structure
```
tests/
├── evals/
│   ├── screening-golden.ts        # 20-case hand-labeled golden set (EVAL-01)
│   └── screening-eval.test.ts     # describeEval runner (EVAL-02, EVAL-03)
convex/
├── extraction/
│   ├── qualitySampling.ts         # Hourly sampling action + write mutation (EVAL-04)
│   └── queries.ts                 # + getQualityTrend, getReviewQueue (EVAL-05, EVAL-06)
│   └── mutations.ts               # + updateReviewStatus (EVAL-06)
├── crons.ts                       # + hourly quality sampling entry (EVAL-04)
└── schema.ts                      # + qualityChecks table (EVAL-04)
.github/
└── workflows/
    └── evals.yml                  # Eval-specific CI job (EVAL-03)
```

### Pattern 1: describeEval with Custom + Library Scorers
**What:** The `describeEval` function from vitest-evals integrates autoevals scorers alongside custom scoring functions in a single eval suite.
**When to use:** When you need LLM-as-judge scoring (Factuality) combined with deterministic scoring (Levenshtein citation match).
**Example:**
```typescript
// Source: https://github.com/getsentry/vitest-evals README + autoevals docs
import { describeEval } from "vitest-evals";
import { Factuality } from "autoevals";
import { SCREENING_GOLDEN_SET } from "./screening-golden";
import { extractAnswers } from "../../convex/extraction/extract";

// Custom citation-substring-match scorer
const CitationMatchScorer = async ({
  output,
  expected,
}: {
  output: string;
  expected: Record<string, unknown>;
}) => {
  // Parse output, compute Levenshtein similarity, return { score: 0|1 }
  return { score: similarity >= 0.85 ? 1.0 : 0.0 };
};

describeEval("screening golden set", {
  data: async () =>
    SCREENING_GOLDEN_SET.map((c) => ({
      input: c.question,
      expected: c.expectedAnswer,
      // Additional fields passed through to scorers
      paperBodyText: c.paperBodyText,
      expectedVerdict: c.expectedVerdict,
      expectedSourceSpan: c.expectedSourceSpan,
    })),
  task: async (input) => {
    // Call the pure extraction function directly
    const results = await extractAnswers(bodyText, [{ key: "q1", question: input }]);
    return results[0]?.answer ?? "";
  },
  scorers: [Factuality, CitationMatchScorer],
  threshold: 0.6, // Per-case minimum; aggregate thresholds checked separately
});
```

### Pattern 2: Convex Internal Action for Hourly Sampling
**What:** An `internalAction` with `"use node"` that queries for a random completed result, re-runs the critic, and writes to `qualityChecks` via an internal mutation.
**When to use:** Background cron work that needs LLM API access (Node.js runtime) and database writes (via mutation).
**Example:**
```typescript
// Source: existing workpoolActions.ts pattern in this codebase
"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

export const sampleAndCheck = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // 1. Query for eligible results via internalQuery
    const sample = await ctx.runQuery(
      internal.extraction.qualitySampling.getRandomEligibleResult,
      {}
    );
    if (!sample) return null; // No eligible results -- early return

    // 2. Re-run critic via LLM (uses buildCriticPrompt)
    // 3. Write result via internalMutation
    await ctx.runMutation(
      internal.extraction.qualitySampling.writeQualityCheck,
      { answerId: sample._id, verdict, judgeModel, timestamp: Date.now() }
    );
    return null;
  },
});
```

### Pattern 3: Auth-Gated Query with Index Range Scan
**What:** Public query that scans `qualityChecks` by timestamp index for 7-day window, aggregates counts.
**When to use:** Quality trend dashboard query.
**Example:**
```typescript
// Source: existing getExtractionJobMetrics pattern in queries.ts
export const getQualityTrend = query({
  args: {},
  returns: v.union(v.null(), v.object({
    supported: v.number(),
    unsupported: v.number(),
    partial: v.number(),
    total: v.number(),
    passRate: v.number(),
  })),
  handler: async (ctx, _args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const checks = await ctx.db
      .query("qualityChecks")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", sevenDaysAgo))
      .take(1000);

    // Aggregate counts...
  },
});
```

### Anti-Patterns to Avoid
- **Running evals in normal test suite:** Evals call real LLMs and cost money. Gate with `RUN_EVALS=1` environment variable per D-05. The `describe.skipIf` pattern ensures `pnpm test` never triggers evals. [VERIFIED: vitest docs]
- **Using `ctx.db` inside an action:** Convex actions cannot access the database directly. The sampling action must use `ctx.runQuery` and `ctx.runMutation` for all DB operations. [VERIFIED: Convex guidelines]
- **Querying without index for timestamp range:** Convex requires index-based queries. The `by_timestamp` index on `qualityChecks` enables efficient range scans. Never use `.filter()`. [VERIFIED: Convex guidelines]
- **Unbounded `.collect()` on growing tables:** The `qualityChecks` table grows by ~24 rows/day. Use `.take(1000)` for 7-day queries as a safety bound. [VERIFIED: Convex guidelines]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM factuality scoring | Custom factuality prompt | `autoevals` `Factuality` | Validated prompt template, returns calibrated 0-1 score, handles edge cases [CITED: braintrust.dev/docs/reference/autoevals] |
| Eval test framework | Raw vitest assertions | `vitest-evals` `describeEval` | Built-in threshold gating, scorer protocol, data iteration, lifecycle hooks [CITED: github.com/getsentry/vitest-evals] |
| Citation similarity | Custom string comparison | `fastest-levenshtein` `distance()` | Already used in runtime extraction (Phase 92); consistent 0.85 threshold across test and prod [VERIFIED: codebase] |
| Critic prompt construction | New prompt from scratch | `buildCriticPrompt()` | Already implemented in `lib/ai/core/prompts.ts`, battle-tested in extraction pipeline [VERIFIED: codebase] |

**Key insight:** The entire critic infrastructure (prompt, schema, model invocation pattern) already exists from Phase 92. The hourly sampling cron reuses it wholesale -- no new LLM integration code needed.

## Common Pitfalls

### Pitfall 1: Eval Tests Running on Every `pnpm test`
**What goes wrong:** Eval tests call real LLMs, costing money and slowing down the test suite.
**Why it happens:** Missing `RUN_EVALS=1` gate means evals run on every test invocation.
**How to avoid:** Use `describe.skipIf(process.env.RUN_EVALS !== '1')` as the outer wrapper, AND have CI only set `RUN_EVALS=1` in the dedicated eval job. [VERIFIED: vitest docs for `describe.skipIf`]
**Warning signs:** Slow test runs, unexpected OpenAI API charges.

### Pitfall 2: autoevals Factuality Requiring OPENAI_API_KEY
**What goes wrong:** `autoevals` Factuality scorer defaults to using OpenAI's API, requiring `OPENAI_API_KEY` to be set.
**Why it happens:** Factuality is an LLM-as-judge scorer that needs an LLM backend.
**How to avoid:** Either set `OPENAI_API_KEY` in CI secrets, or configure autoevals to use OpenRouter/another provider via the `model` and `client` parameters. The project already has OpenRouter keys. [CITED: braintrust.dev/docs/reference/autoevals]
**Warning signs:** `Error: OPENAI_API_KEY is not set` in CI logs.

### Pitfall 3: Convex Action Trying to Use ctx.db
**What goes wrong:** The sampling action crashes because actions don't have database access.
**Why it happens:** Developer forgets that `internalAction` runs in Node.js runtime without DB access.
**How to avoid:** All DB reads go through `ctx.runQuery(internal.*.*)`, all writes through `ctx.runMutation(internal.*.*)`. Reference the existing `workpoolActions.ts` pattern. [VERIFIED: Convex guidelines]
**Warning signs:** Runtime error `ctx.db is not a function`.

### Pitfall 4: Random Sampling Without Deduplication
**What goes wrong:** The cron repeatedly samples the same production answers.
**Why it happens:** Simple random selection without checking if an answer was already sampled.
**How to avoid:** Per D-13, check `by_answerId` index on `qualityChecks` to skip answers already sampled in the last 7 days before writing. [VERIFIED: CONTEXT.md D-13]
**Warning signs:** `qualityChecks` table has many duplicate `answerId` entries.

### Pitfall 5: CI Workflow Not Gating Merges
**What goes wrong:** Eval failures don't actually block PRs.
**Why it happens:** The eval workflow job isn't set as a required status check in GitHub branch protection.
**How to avoid:** After creating the workflow, add the eval job as a required status check in GitHub repo settings. The canary test (D-11) verifies this works end-to-end. [ASSUMED]
**Warning signs:** PRs merge despite eval failures.

### Pitfall 6: Separate File for Actions vs Queries/Mutations
**What goes wrong:** TypeScript compilation fails or Convex runtime errors when mixing runtimes.
**Why it happens:** Convex files with `"use node"` cannot export queries or mutations. Actions must be in separate files. [VERIFIED: Convex guidelines]
**How to avoid:** `qualitySampling.ts` must ONLY export the `internalAction`. Internal queries and mutations for sampling support must go in separate files (or use the existing `queries.ts` / `mutations.ts`).
**Warning signs:** `Cannot use "use node" with queries or mutations` error.

## Code Examples

### Golden Set Type Interface
```typescript
// Source: CONTEXT.md D-01, D-04
export interface GoldenCase {
  paperId: string;
  paperBodyText: string;
  question: string;
  expectedAnswer: string;
  expectedVerdict: "include" | "exclude" | "insufficient_evidence";
  expectedSourceSpan: { startChar: number; endChar: number };
  parsingSource: "pmc" | "arxiv" | "unpdf" | "gemini" | "abstract_only";
}

export const SCREENING_GOLDEN_SET: readonly GoldenCase[] = [
  // ... 20 cases (7 include, 7 exclude, 6 insufficient_evidence)
] as const;
```

### Custom Citation-Substring-Match Scorer
```typescript
// Source: CONTEXT.md D-07, Phase 92 Levenshtein pattern
import { distance } from "fastest-levenshtein";

export async function citationSubstringMatchScorer({
  output,
  expected,
}: {
  output: string;
  expected?: { expectedSourceSpan: { startChar: number; endChar: number }; paperBodyText: string };
}): Promise<{ score: number }> {
  if (!expected || !output) return { score: 0 };

  const { startChar, endChar } = expected.expectedSourceSpan;
  const sourceSlice = expected.paperBodyText.slice(startChar, endChar);
  const maxLen = Math.max(output.length, sourceSlice.length);
  const similarity = maxLen === 0 ? 1 : 1 - distance(output, sourceSlice) / maxLen;

  return { score: similarity >= 0.85 ? 1.0 : 0.0 };
}
```

### qualityChecks Schema Addition
```typescript
// Source: CONTEXT.md D-15
qualityChecks: defineTable({
  answerId: v.id("extractionResults"),
  verdict: v.string(),
  judgeModel: v.string(),
  timestamp: v.number(),
  reviewStatus: v.string(), // "pending" | "reviewed" | "promoted"
})
  .index("by_answerId", ["answerId"])
  .index("by_timestamp", ["timestamp"]),
```

### Cron Registration
```typescript
// Source: existing crons.ts pattern
crons.interval(
  "quality sampling",
  { hours: 1 },
  internal.extraction.qualitySampling.sampleAndCheck,
  {},
);
```

### CI Workflow (evals.yml)
```yaml
# Source: existing ci.yml pattern adapted for eval-specific job
name: Evals

on:
  pull_request:
    paths:
      - 'convex/extraction/**'
      - 'lib/extraction/**'

jobs:
  eval-suite:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      RUN_EVALS: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: pnpm test tests/evals/
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Promptfoo CLI for eval runs | `vitest-evals` + `autoevals` in-repo | 2025 | Evals are vitest tests, run in CI, same toolchain as unit tests |
| Manual quality spot-checks | Automated hourly sampling cron | Phase 96 | Drift detection without human effort |
| Static golden set | Review queue feeding golden-set growth | Phase 96 | Golden set improves organically from production data |

**Deprecated/outdated:**
- Langfuse / Braintrust / Phoenix / Promptfoo: Explicitly out of scope for MVP per REQUIREMENTS.md

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GitHub branch protection can enforce the eval job as a required status check | Pitfalls | CI may not actually block merges; manual verification needed after setup |
| A2 | autoevals Factuality can be configured to use OpenRouter instead of OpenAI directly | Pitfalls | May need OPENAI_API_KEY specifically; could use OpenRouter's OpenAI-compatible endpoint |
| A3 | `describe.skipIf` in vitest works at the suite level to skip all nested tests | Patterns | If not, would need individual `it.skipIf` per test case |

## Open Questions

1. **autoevals API key configuration for OpenRouter**
   - What we know: Factuality defaults to OPENAI_API_KEY. The `model` and `client` parameters can override this. [CITED: braintrust.dev/docs/reference/autoevals]
   - What's unclear: Whether OpenRouter's OpenAI-compatible base URL (`https://openrouter.ai/api/v1`) works seamlessly with autoevals' client configuration
   - Recommendation: Set `OPENAI_BASE_URL=https://openrouter.ai/api/v1` and `OPENAI_API_KEY=$OPENROUTER_API_KEY` in the eval CI job, OR pass a custom client to Factuality. Test both approaches.

2. **Golden set paper text sourcing**
   - What we know: D-03 requires real paper text excerpts under 10K characters
   - What's unclear: Which specific papers to use (need representative PMC, arXiv, and PDF-fallback examples)
   - Recommendation: Developer selects 20 papers from production data or public sources. This is a manual curation step that happens during implementation.

3. **describeEval aggregate assertion pattern**
   - What we know: `describeEval` has a `threshold` parameter for per-case minimum score
   - What's unclear: Whether `threshold` supports aggregate metrics (e.g., "95% of cases pass") or only per-case minimums
   - Recommendation: Use `threshold` for per-case, then add a separate `afterAll` or final assertion that computes aggregate recall and citation-validity across all cases. The test file can track results in a closure.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| vitest | Eval tests | Yes | 3.2.4 | -- |
| Node.js 22 | Convex runtime, CI | Yes | 22 | -- |
| pnpm | Package install | Yes | -- | npm (already used in CI) |
| GitHub Actions | CI gating | Yes | -- | -- |
| OpenRouter API | Factuality scorer, hourly sampling | Yes (env var) | -- | OPENAI_API_KEY as fallback |

**Missing dependencies with no fallback:**
- `vitest-evals` and `autoevals` -- must be installed as devDependencies

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 + vitest-evals 0.7.0 |
| Config file | `vitest.config.ts` (existing, already covers `tests/**/*.test.ts`) |
| Quick run command | `RUN_EVALS=1 pnpm vitest run tests/evals/` |
| Full suite command | `pnpm test` (skips evals without `RUN_EVALS=1`) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVAL-01 | 20-case golden set with correct shape | unit (type check) | `pnpm tsc --noEmit` | No -- Wave 0 |
| EVAL-02 | describeEval runs with Factuality + citation scorer | eval (LLM) | `RUN_EVALS=1 pnpm vitest run tests/evals/screening-eval.test.ts` | No -- Wave 0 |
| EVAL-03 | CI blocks on threshold breach | CI integration | GitHub Actions `evals.yml` run | No -- Wave 0 |
| EVAL-04 | Hourly cron writes to qualityChecks | convex-test unit | `pnpm vitest run convex/extraction/qualitySampling.test.ts` | No -- Wave 0 |
| EVAL-05 | getQualityTrend returns correct aggregates | convex-test unit | `pnpm vitest run convex/extraction/queries.test.ts` | Exists (extend) |
| EVAL-06 | Review queue query + status mutation | convex-test unit | `pnpm vitest run convex/extraction/mutations.test.ts` | Exists (extend) |

### Sampling Rate
- **Per task commit:** `pnpm tsc --noEmit` (type check, fast)
- **Per wave merge:** `pnpm test` (full unit suite, no evals)
- **Phase gate:** `RUN_EVALS=1 pnpm vitest run tests/evals/` + `pnpm test`

### Wave 0 Gaps
- [ ] `tests/evals/screening-golden.ts` -- golden set data file (EVAL-01)
- [ ] `tests/evals/screening-eval.test.ts` -- eval test runner (EVAL-02)
- [ ] `.github/workflows/evals.yml` -- CI eval job (EVAL-03)
- [ ] `convex/extraction/qualitySampling.ts` -- new module (EVAL-04)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | -- |
| V3 Session Management | No | -- |
| V4 Access Control | Yes | `getCurrentUser(ctx)` auth gate on all public queries/mutations |
| V5 Input Validation | Yes | Convex validators on all function args (`v.id()`, `v.string()`) |
| V6 Cryptography | No | -- |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated quality data access | Information Disclosure | `getCurrentUser(ctx)` null check on `getQualityTrend` and `getReviewQueue` |
| Review status tampering | Tampering | Auth-gated `updateReviewStatus` mutation; Convex validators enforce allowed values |
| LLM prompt injection via sampled paper text | Tampering | UUID delimiters in `buildCriticPrompt` (already implemented in Phase 92) |

## Sources

### Primary (HIGH confidence)
- vitest-evals GitHub README [CITED: github.com/getsentry/vitest-evals] -- describeEval API, scorer protocol, configuration
- autoevals Braintrust docs [CITED: braintrust.dev/docs/reference/autoevals] -- Factuality scorer API, parameters, return types
- Codebase: `convex/extraction/extract.ts` -- extractAnswers() function signature, critic pattern
- Codebase: `convex/crons.ts` -- 7 existing cron registrations, pattern for hourly jobs
- Codebase: `convex/extraction/queries.ts` -- auth-gated query patterns, getExtractionJobMetrics
- Codebase: `lib/ai/core/prompts.ts` -- buildCriticPrompt function, CriticPromptInput interface
- npm registry -- vitest-evals 0.7.0, autoevals 0.0.132 version verification

### Secondary (MEDIUM confidence)
- Sentry blog post on vitest-evals [CITED: blog.sentry.io/evals-are-just-tests-so-why-arent-engineers-writing-them/] -- describeEval usage pattern with autoevals Factuality

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified via npm registry, codebase already uses vitest and fastest-levenshtein
- Architecture: HIGH -- all Convex patterns (crons, actions, queries, schema) have multiple existing precedents in codebase
- Pitfalls: HIGH -- pitfalls verified against Convex guidelines and library documentation

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable domain -- eval frameworks and Convex patterns move slowly)

## Project Constraints (from CLAUDE.md)

- **Convex backend:** All backend code follows Convex patterns. Always read `convex/_generated/ai/guidelines.md` first. [VERIFIED: read during research]
- **No legacy, no compat:** Destructive rebuild. No backward compatibility considerations.
- **DRY:** Reuse existing infrastructure (buildCriticPrompt, fastest-levenshtein, cron patterns) before building new.
- **Modern standards:** Use latest library versions, no deprecated APIs.
- **Test-first discipline:** Every new code path needs tests. Eval tests ARE the tests for this phase.
