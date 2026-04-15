# Phase 96: Eval Loop & Quality Sampling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 96-eval-loop-quality-sampling
**Areas discussed:** Golden set structure, Eval test runner design, Hourly sampling strategy, Human-review queue design
**Mode:** --auto (all decisions auto-selected)

---

## Golden Set Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Typed array of case objects | Paper text + question + expected answer + expected source span + parsing source tag | ✓ |
| JSON fixture file | External JSON loaded at test time | |
| Database-backed golden set | Stored in Convex, queried at eval time | |

**User's choice:** [auto] Typed const array in `tests/evals/screening-golden.ts`
**Notes:** Matches EVAL-01 requirement. TypeScript gives compile-time type safety. Distribution: 7 include, 7 exclude, 6 insufficient_evidence across 3+ parsing sources.

| Option | Description | Selected |
|--------|-------------|----------|
| Real paper excerpts (under 10K chars) | Fast eval execution with realistic text | ✓ |
| Full paper text | More realistic but slower tests | |
| Synthetic text | Fast but unrealistic | |

**User's choice:** [auto] Real paper excerpts under 10K characters
**Notes:** Balances realism with test speed. Full papers would make eval suite too slow for CI.

---

## Eval Test Runner Design

| Option | Description | Selected |
|--------|-------------|----------|
| vitest-evals + autoevals with describe.skipIf | Standard integration, RUN_EVALS=1 gate | ✓ |
| Separate vitest config for evals | Isolated config, separate command | |
| Custom eval script outside vitest | Shell script calling extractAnswers directly | |

**User's choice:** [auto] vitest-evals + autoevals with `describe.skipIf(process.env.RUN_EVALS !== '1')`
**Notes:** Leverages existing vitest infrastructure. No config changes needed. CI job sets RUN_EVALS=1.

| Option | Description | Selected |
|--------|-------------|----------|
| Custom citation-substring-match scorer | Reuses fastest-levenshtein at 0.85 threshold | ✓ |
| autoevals built-in similarity scorer | May not match runtime threshold | |

**User's choice:** [auto] Custom scorer reusing fastest-levenshtein at 0.85 threshold
**Notes:** Mirrors the exact runtime Levenshtein guard from Phase 92 for consistency.

| Option | Description | Selected |
|--------|-------------|----------|
| CI path-filtered job | Runs only on PRs touching extraction code | ✓ |
| Run on every PR | More coverage but wasteful | |

**User's choice:** [auto] Path-filtered CI job on `convex/extraction/**` and `lib/extraction/**` changes
**Notes:** Per EVAL-02 requirement. Avoids wasting LLM tokens on unrelated PRs.

---

## Hourly Sampling Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Random offset sampling with 7-day dedup | Simple, broad coverage | ✓ |
| Reservoir sampling | More statistically rigorous, overkill for MVP | |
| Most recent result only | Simple but biased toward new data | |

**User's choice:** [auto] Random offset with 7-day dedup via `by_answerId` index
**Notes:** Simple approach sufficient for MVP. Dedup ensures broad coverage over time.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing critic infrastructure | buildCriticPrompt + criticOutputSchema | ✓ |
| Dedicated sampling critic | Separate prompt/model | |

**User's choice:** [auto] Reuse Phase 92 critic infrastructure directly
**Notes:** Same critic prompt, same model tier, same verdict schema. No new LLM logic needed.

| Option | Description | Selected |
|--------|-------------|----------|
| Silent early-return on no data | No log noise | ✓ |
| Log warning on no data | More visible but noisy | |

**User's choice:** [auto] Silent early-return
**Notes:** Cron runs every hour. No point logging "nothing to sample" 24 times a day during early usage.

---

## Human-Review Queue Design

| Option | Description | Selected |
|--------|-------------|----------|
| reviewStatus field on qualityChecks | pending/reviewed/promoted tri-state | ✓ |
| Separate review table | Normalized but more complex | |
| No review status tracking | Simpler but loses audit trail | |

**User's choice:** [auto] `reviewStatus` field with pending/reviewed/promoted values
**Notes:** Unsupported verdicts auto-set to pending. Developer manually promotes to golden set.

| Option | Description | Selected |
|--------|-------------|----------|
| Developer workflow (manual golden set updates) | Simple, commit-based | ✓ |
| UI-driven golden set promotion | More polished, overkill for MVP | |

**User's choice:** [auto] Developer workflow — manual review, manual commit to golden set file
**Notes:** MVP appropriate. Golden set growth is a developer concern, not an end-user feature.

| Option | Description | Selected |
|--------|-------------|----------|
| Auth-gated quality trend query | Consistent with other queries | ✓ |
| Public quality trend | Simpler but security risk | |

**User's choice:** [auto] Auth-gated with getCurrentUser(ctx) pattern
**Notes:** Consistent with all other extraction queries.

---

## Claude's Discretion

- Exact autoevals Factuality scorer configuration
- Random sampling implementation details (offset query vs. recent-only)
- CI workflow YAML structure
- Golden set text excerpt selection
- Review queue pagination approach

## Deferred Ideas

None — discussion stayed within phase scope.
