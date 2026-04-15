---
phase: 96-eval-loop-quality-sampling
plan: 01
subsystem: eval-infrastructure
tags: [eval, testing, ci, golden-set, extraction-quality]
dependency_graph:
  requires: [convex/extraction/extract.ts, lib/ai/core/prompts.ts]
  provides: [tests/evals/screening-golden.ts, tests/evals/screening-eval.test.ts, .github/workflows/evals.yml]
  affects: [package.json]
tech_stack:
  added: [vitest-evals@0.7.0, autoevals@0.0.132]
  patterns: [describeEval, Factuality scorer, custom citation scorer, RUN_EVALS gate]
key_files:
  created:
    - tests/evals/screening-golden.ts
    - tests/evals/screening-eval.test.ts
    - .github/workflows/evals.yml
  modified:
    - package.json
    - pnpm-lock.yaml
decisions:
  - "Used describe.skipIf(RUN_EVALS !== '1') wrapping describeEval for zero-cost normal test runs"
  - "Routed autoevals Factuality through OpenRouter via OPENAI_BASE_URL to avoid separate OpenAI key"
  - "Separated Factuality and citation scoring into two describeEval blocks for independent threshold tracking"
  - "Set threshold: null on per-case evals, using separate aggregate it blocks for recall/citation thresholds"
metrics:
  duration: 457s
  completed: "2026-04-15T09:44:49Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 2
---

# Phase 96 Plan 01: Golden Set + Eval Runner + CI Workflow Summary

20-case hand-labeled golden set with Factuality + Levenshtein citation scoring, gated by RUN_EVALS=1, CI workflow triggers only on extraction PR paths.

## What Was Built

### Golden Set (tests/evals/screening-golden.ts)
- `GoldenCase` interface with paperId, paperBodyText, question, expectedAnswer, expectedVerdict, expectedSourceSpan, and parsingSource fields
- `SCREENING_GOLDEN_SET` readonly array of exactly 20 cases
- Distribution: 7 include, 7 exclude, 6 insufficient_evidence
- Parsing sources: 4 pmc, 5 arxiv, 4 unpdf, 4 gemini, 3 abstract_only (satisfies all >= 3 requirements)
- Realistic academic paper excerpts spanning medicine, computer science, environmental science, political science, genomics, autonomous vehicles, and more
- Runtime source span validation via `makeCase` helper at module load time
- Each case has validated character offsets pointing to real evidence within body text

### Eval Test Runner (tests/evals/screening-eval.test.ts)
- `describe.skipIf(process.env.RUN_EVALS !== "1")` gates all eval tests -- normal `pnpm test` skips entirely (zero LLM calls, zero cost)
- Two `describeEval` blocks:
  1. **Extraction quality**: Calls `extractAnswers` directly, scores with autoevals `Factuality`
  2. **Citation substring match**: Custom `citationSubstringMatchScorer` using `fastest-levenshtein` 85% similarity threshold (matches the production Levenshtein verification in extract.ts)
- Aggregate threshold assertions in separate `it` blocks:
  - recall-on-include >= 95% (include cases must return non-insufficient answers)
  - citation-validity-rate >= 98% (evidence quotes must match source spans)
- 42 total test cases when RUN_EVALS=1 (20 factuality + 20 citation + 2 aggregate)
- 120s timeout per eval case (accounts for LLM latency)

### CI Workflow (.github/workflows/evals.yml)
- Triggers only on PRs touching: `convex/extraction/**`, `lib/extraction/**`, `tests/evals/**`, `lib/ai/core/prompts.ts`
- Sets `RUN_EVALS=1` to enable the eval gate
- Routes autoevals Factuality through OpenRouter via `OPENAI_BASE_URL` / `OPENAI_API_KEY` (avoids needing a separate OpenAI API key)
- Placeholder Clerk/Convex env vars prevent transitive import failures from module resolution
- 15-minute timeout for 20 LLM calls with retries
- Matches existing ci.yml patterns (node 22, npm ci, actions/checkout@v4, actions/setup-node@v4)

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install eval dependencies and create golden set | 2e9a47b | package.json, pnpm-lock.yaml, tests/evals/screening-golden.ts |
| 2 | Create eval test runner with scorers | d543da6 | tests/evals/screening-eval.test.ts |
| 3 | Create CI eval workflow | 45b6664 | .github/workflows/evals.yml |

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Separate describeEval blocks for Factuality vs citation scoring**: The autoevals Factuality scorer needs `expected` as a string answer, while the citation scorer needs `expected` as JSON containing source span metadata. Using two describeEval blocks keeps each scorer's data contract clean.

2. **threshold: null with separate aggregate it blocks**: Setting per-case threshold to null avoids failing individual cases (which is expected for exclude/insufficient_evidence cases where the model may correctly return different answers). The aggregate assertions in separate `it` blocks enforce the actual quality gates (95% recall, 98% citation validity).

3. **OpenRouter routing for autoevals**: The Factuality scorer from autoevals uses the OpenAI SDK internally. Setting `OPENAI_BASE_URL` to OpenRouter's endpoint and `OPENAI_API_KEY` to the OpenRouter key routes all LLM calls through a single provider, matching the project's existing OpenRouter-only architecture.

4. **Placeholder env vars in CI**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `NEXT_PUBLIC_CONVEX_URL` are set to placeholder values in the eval workflow. These are required by transitive module imports but not used during eval execution.

## Self-Check: PASSED

All files verified present on disk. All commit hashes verified in git log.
