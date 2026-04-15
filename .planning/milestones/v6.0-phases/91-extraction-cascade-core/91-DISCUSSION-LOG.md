# Phase 91: Extraction Cascade Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 91-extraction-cascade-core
**Areas discussed:** Result Schema Extension, Cascade Model Selection, Prompt Architecture, Credit Billing Integration

---

## Result Schema Extension

| Option | Description | Selected |
|--------|-------------|----------|
| Add all EXTR-09 fields directly to schema | Extend extractionResults with answer, confidence, evidence fields, reasoning, modelUsed, criticVerdict, parsingSource | ✓ |
| Store results as JSON blob | Single JSON field with untyped result payload | |
| Separate evidence table | Normalize evidence into its own table | |

**User's choice:** [auto] Add all EXTR-09 fields directly to schema (recommended default)
**Notes:** Matches the flat schema requirement from EXTR-02. Idempotent save pattern stays unchanged — only fields grow.

---

## Cascade Model Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential retry on schema failure or error | Try Flash Lite → Flash → Haiku via try/catch chain, escalate on failure | ✓ |
| Confidence-based escalation | Run cheap model first, escalate if confidence < threshold | |
| Parallel multi-model with best-pick | Run all tiers simultaneously, pick best result | |

**User's choice:** [auto] Sequential retry on schema failure or error (recommended default)
**Notes:** Matches EXTR-06 requirement. OpenRouter provider.order handles provider-level failover; application cascade handles model-tier escalation.

---

## Prompt Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| New prompt builder in lib/ai/core/prompts.ts | Follow established pattern with buildExtractionPrompts function | ✓ |
| Inline prompts in extract.ts | Prompts co-located with extraction logic | |
| Separate prompts module in convex/extraction/ | Extraction-specific prompt module | |

**User's choice:** [auto] New prompt builder in lib/ai/core/prompts.ts (recommended default)
**Notes:** Follows the 5-function pattern already established. System prompt defines academic extractor role, output schema, verbatim quoting rules.

---

## Credit Billing Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Use withUserCreditsBatch from screening | Wrap cascade calls in existing credit wrapper | ✓ |
| New extraction-specific credit wrapper | Build extraction-specific billing logic | |
| No credits for MVP | Defer billing to a later phase | |

**User's choice:** [auto] Use withUserCreditsBatch from screening (recommended default)
**Notes:** Proven pattern. Parsing stays free, LLM extraction calls billed.

---

## Claude's Discretion

- Exact system prompt wording
- Concurrency semaphore implementation
- Token usage storage granularity
- Test fixture design
- Workpool action return shape

## Deferred Ideas

None — discussion stayed within phase scope.
