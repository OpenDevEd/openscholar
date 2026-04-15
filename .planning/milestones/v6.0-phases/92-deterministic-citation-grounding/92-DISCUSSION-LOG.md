# Phase 92: Deterministic Citation Grounding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 92-deterministic-citation-grounding
**Areas discussed:** Levenshtein Verification, Critic Pass Architecture, Insufficient Evidence State, UI Verbatim Rendering
**Mode:** --auto (all decisions auto-selected as recommended defaults)

---

## Levenshtein Verification

| Option | Description | Selected |
|--------|-------------|----------|
| Post-schema superRefine | Zod `.superRefine()` on extractionOutputSchema with bodyText closure, validates inline during Output.object parsing | ✓ |
| Post-extraction check | Separate validation step after schema parsing, outside Zod | |
| Pre-save mutation guard | Validate in saveResult mutation before persisting | |

**User's choice:** [auto] Post-schema superRefine (recommended default)
**Notes:** Co-locates validation with the schema. AI SDK handles the Zod error pipeline automatically.

---

## Levenshtein Retry Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Retry once + escalate | Retry same tier with retryCount=1, then escalate to next tier, then insufficient_evidence | ✓ |
| Immediate escalation | Skip retry, escalate directly to next tier | |
| Immediate insufficient_evidence | No retry, mark as insufficient_evidence on first failure | |

**User's choice:** [auto] Retry once + escalate (recommended default)
**Notes:** Gives the model one chance to fix a bad quote. Prompt builder already has retry-aware messaging.

---

## Critic Pass Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Same model, inline | Critic runs in extractSingleAnswer after extraction, using the same tier's model | ✓ |
| Cheapest model always | Always use Flash Lite for critic regardless of extraction tier | |
| Separate function | Critic in a separate module called from workpoolActions | |

**User's choice:** [auto] Same model, inline (recommended default)
**Notes:** Simplest architecture. Critic inherits the model that successfully extracted.

---

## Critic Model Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Same tier model | Critic uses whatever model succeeded the extraction | ✓ |
| Always cheapest | Always use Gemini 2.5 Flash Lite for critic | |
| Dedicated judge model | Use a specific model optimized for evaluation | |

**User's choice:** [auto] Same tier model (recommended default)
**Notes:** MVP simplicity. No need for a separate judge model at this scale.

---

## Insufficient Evidence Representation

| Option | Description | Selected |
|--------|-------------|----------|
| String literal answer | answer="insufficient_evidence" with confidence capped at "low" | ✓ |
| Null with flag | answer=null with a separate isInsufficientEvidence boolean | |
| Enum state | Separate status field on the result | |

**User's choice:** [auto] String literal answer (recommended default)
**Notes:** Distinguishes from null (error/failure) vs "insufficient_evidence" (ran but untrustworthy). No schema changes needed.

---

## UI Verbatim Rendering

| Option | Description | Selected |
|--------|-------------|----------|
| bodyText.slice() | Fetch paper bodyText, render slice(startChar, endChar) | ✓ |
| Server-side slice | Compute slice on server, return in query result | |
| evidenceQuote with disclaimer | Show LLM quote with "may not be exact" caveat | |

**User's choice:** [auto] bodyText.slice() — never render evidenceQuote (recommended default)
**Notes:** Per EXTR-04: UI ALWAYS renders verbatim slice, NEVER the LLM's evidence_quote field.

---

## Claude's Discretion

- Exact critic prompt wording
- superRefine edge case handling (empty bodyText, out-of-bounds offsets)
- Test fixture design (real vs synthetic paper snippets)
- EvidenceQuote component query strategy
- Insufficient evidence card visual treatment

## Deferred Ideas

None — discussion stayed within phase scope.
