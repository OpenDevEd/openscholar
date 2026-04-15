# Phase 92: Deterministic Citation Grounding - Research

**Researched:** 2026-04-15
**Domain:** LLM output validation, Levenshtein string matching, structured output critic patterns, React evidence rendering
**Confidence:** HIGH

## Summary

Phase 92 adds a deterministic citation grounding layer to the extraction cascade built in Phase 91. The phase has four distinct capabilities: (1) Levenshtein similarity verification of LLM-generated evidence quotes via Zod `superRefine`, (2) a same-model critic pass that confirms quote fidelity, (3) `insufficient_evidence` as a first-class answer state, and (4) UI components that render only the verbatim source slice, never the LLM's `evidence_quote` field.

The codebase is well-prepared for this phase. The `extractionResults` schema already includes `criticVerdict: v.optional(v.string())`, the `extractionOutputSchema` in `extract.ts` already uses `Output.object` with Zod validation, and the AI SDK's validation pipeline (`safeParseAsync`) executes Zod refinements including `superRefine`. The `saveResult` mutation needs a `criticVerdict` arg added (the schema field exists but the mutation args do not include it yet).

**Primary recommendation:** Modify `extractSingleAnswer` in `extract.ts` to (a) build the Zod schema with a `superRefine` closure over `bodyText` for Levenshtein verification, (b) add a post-extraction critic call using the same model, (c) handle verdict-based confidence adjustments. Add a new `buildCriticPrompt` to prompts.ts. Add `EvidenceQuote` and `InsufficientEvidenceCard` React components per the UI-SPEC. Install `fastest-levenshtein` as a dependency.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Install `fastest-levenshtein` as a dependency. Use its `distance()` function to compute edit distance, then derive similarity as `1 - (distance / max(a.length, b.length))`. Threshold: >=0.85.
- **D-02:** Add a Zod `.superRefine()` refinement to the `extractionOutputSchema` in `convex/extraction/extract.ts`. The refinement receives `bodyText` via closure (not as a schema field). It checks that `bodyText.slice(evidence_start_char, evidence_end_char)` matches `evidence_quote` at >=85% Levenshtein similarity. On failure, it adds a Zod issue with code `custom` and message describing the mismatch.
- **D-03:** The `superRefine` validation runs inline during `Output.object({ schema })` parsing -- the AI SDK's structured output pipeline handles this automatically. When the refinement fails, the tier catches the Zod error and either retries or escalates per D-04.
- **D-04:** On Levenshtein failure: retry once on the same tier with `retryCount=1` (the prompt builder already has retry-aware messaging). If the retry also fails, escalate to the next cascade tier. If all tiers exhaust, mark the answer as `insufficient_evidence`.
- **D-05:** After a successful extraction (Levenshtein-verified), run a critic pass using the SAME model/tier that produced the extraction. Temperature: 0. The critic prompt asks: "Does this quote appear verbatim in the source text, and does it support this answer?" with structured output: `{ verdict: "supported" | "unsupported" | "partial", reason: string }`.
- **D-06:** The critic schema is a small separate Zod object (`criticOutputSchema`) defined in `extract.ts`. Critic calls use `Output.object({ schema: criticOutputSchema })`.
- **D-07:** Critic verdict handling: `supported` -> answer passes through. `unsupported` -> answer flipped to `insufficient_evidence` with confidence capped at `low`. `partial` -> answer kept but confidence downgraded by one level.
- **D-08:** `criticVerdict` is stored on the `extractionResults` row using the existing `v.optional(v.string())` field in the schema.
- **D-09:** The critic pass has its own `AbortSignal.timeout(30_000)`. If timeout, answer kept with `criticVerdict: "timeout"`.
- **D-10:** A new `buildCriticPrompt` function is added to `lib/ai/core/prompts.ts`.
- **D-11:** `insufficient_evidence` is represented as `answer: "insufficient_evidence"` (string literal, not null).
- **D-12:** When `insufficient_evidence` is set: `confidence` capped at `"low"`, `reasoning` explains why, `evidenceQuote`/`evidenceStartChar`/`evidenceEndChar` are cleared.
- **D-13:** The extraction result validator does NOT need schema changes -- `answer` already accepts `v.union(v.string(), v.null())`.
- **D-14:** The extraction result card UI renders evidence by reading `evidenceStartChar` and `evidenceEndChar` from the result, fetching `bodyText` from the associated paper row, and displaying `bodyText.slice(evidenceStartChar, evidenceEndChar)`. The `evidenceQuote` field is NEVER rendered to the user.
- **D-15:** A new `EvidenceQuote` React component handles the verbatim slice rendering.
- **D-16:** When `answer === "insufficient_evidence"`, the UI shows a distinct state with muted card, info icon, reasoning text, and no evidence block.
- **D-17:** The `evidenceQuote` field remains on the schema for traceability but is not exposed in any user-facing UI component.
- **D-18:** The `extractSingleAnswer` function is modified to add superRefine + critic pass + verdict handling.
- **D-19:** The `ExtractionResult` interface gains a `criticVerdict?: string` field.
- **D-20:** Credit billing: the critic pass token usage is added to the result's `tokensIn`/`tokensOut`.

### Claude's Discretion
- Exact critic prompt wording -- follow the tone of existing prompts in `lib/ai/core/prompts.ts`.
- Whether the `superRefine` closure needs special handling for edge cases (empty bodyText, out-of-bounds char offsets) -- add defensive guards as needed.
- Test fixture design: whether to use real paper snippets or synthetic text for Levenshtein/critic tests.
- Whether the `EvidenceQuote` component uses a dedicated query or piggybacks on an existing paper-detail query.
- The exact visual treatment of the `insufficient_evidence` card -- follow the Clean/Friendly/Approachable design personality.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXTR-03 | Deterministic quoting via Zod `.superRefine()` + `fastest-levenshtein` -- rejects any answer whose `evidence_quote` does not substring-match the source at >=0.85 similarity | Verified: AI SDK's `Output.object` calls `safeParseAsync` which runs `superRefine` refinements. `fastest-levenshtein@1.0.16` provides `distance()`. D-01 through D-04 lock the implementation pattern. |
| EXTR-04 | UI always renders the verbatim quote from `source.text.slice(start_char, end_char)` -- never the LLM's `evidence_quote` field | UI-SPEC defines `EvidenceQuote` component with dedicated Convex query. Requires new `getPaperBodyText` query in `queries.ts`. |
| EXTR-05 | Critic pass (same cheap model, T=0) asking "Does this quote appear verbatim and support this answer?" -- rejects `unsupported` | Verified: `generateText` + `Output.object` with a separate `criticOutputSchema`. D-05 through D-10 lock the flow. |
| EXTR-08 | `insufficient_evidence` as a first-class answer state when retrieval/critic cannot support a decision -- confidence capped, UI surfaces reason | Schema already supports it (`answer: v.union(v.string(), v.null())`). D-11, D-12, D-16 lock the representation and UI. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Levenshtein verification | API / Backend (`extract.ts`) | -- | String similarity is a server-side validation concern; runs inside the Zod schema refinement during LLM output parsing |
| Critic pass | API / Backend (`extract.ts`) | -- | Additional LLM call with structured output; must run server-side where the model provider key is available |
| `insufficient_evidence` state | API / Backend (`extract.ts`, `mutations.ts`) | Browser / Client (result card) | Backend produces the state; frontend renders it |
| Verbatim quote rendering | Browser / Client (`EvidenceQuote` component) | API / Backend (`queries.ts`) | Client fetches `bodyText` via Convex query, slices and renders; backend provides the data |
| Critic prompt construction | API / Backend (`prompts.ts`) | -- | Prompt builders are pure functions in the shared AI module |
| i18n key seeding | Browser / Client (locale files) | -- | Static JSON files consumed by `next-intl` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastest-levenshtein` | 1.0.16 | Levenshtein distance computation | Fastest JS/TS implementation; MIT; zero dependencies; 1.13M weekly downloads; simple API (`distance(a, b)`) [VERIFIED: npm registry] |
| `ai` | 6.0.62 | AI SDK structured output with `Output.object` + `generateText` | Already installed; `Output.object` runs Zod `safeParseAsync` which executes `superRefine` refinements [VERIFIED: source code inspection of `node_modules/ai/src/generate-text/output.ts` and `node_modules/@ai-sdk/provider-utils/src/schema.ts`] |
| `zod` | 4.3.6 | Schema validation with `superRefine` for Levenshtein check | Already installed; Zod 4 `superRefine` API uses `ctx.addIssue({ code: "custom", ... })` [VERIFIED: `node_modules/zod/src/v4/classic/tests/refine.test.ts`] |
| `@openrouter/ai-sdk-provider` | (installed) | OpenRouter model provider for critic pass | Already installed; critic reuses the same model instance that produced the extraction |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@testing-library/react` | (installed) | Component tests for `EvidenceQuote` and `InsufficientEvidenceCard` | Phase 92 UI component tests |
| `vitest` | 3.2.4 | Test runner | Unit tests for Levenshtein verification, mock-critic tests, component tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fastest-levenshtein` | `js-levenshtein`, `levenshtein-edit-distance` | `fastest-levenshtein` is demonstrably faster in benchmarks and has wider adoption; D-01 locks this choice |
| Same-model critic | Separate dedicated critic model | Same-model is simpler (no additional model config), cheaper (reuses cached context), and locked by D-05 |

**Installation:**
```bash
pnpm add fastest-levenshtein
```

**Version verification:**
- `fastest-levenshtein`: 1.0.16 (latest on npm as of 2026-04-15) [VERIFIED: npm registry]
- `ai`: ^6.0.62 (already in `package.json`) [VERIFIED: package.json]
- `zod`: ^4.3.6 (already in `package.json`) [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```
                     extractSingleAnswer(bodyText, question, signal)
                                    |
                     +--------------v--------------+
                     | Build extractionOutputSchema |
                     | with superRefine closure     |
                     | over bodyText                |
                     +-----------------------------+
                                    |
           +------------------------v------------------------+
           |            CASCADE (3 tiers)                    |
           |  For each tier:                                 |
           |                                                 |
           |  +-------------------------------------------+  |
           |  | generateText + Output.object({ schema })  |  |
           |  | AI SDK calls safeParseAsync on output      |  |
           |  |  -> Zod validates fields                   |  |
           |  |  -> superRefine runs Levenshtein check     |  |
           |  +-------------------------------------------+  |
           |        |                    |                    |
           |     success            failure                  |
           |        |         (NoObjectGeneratedError)       |
           |        |                    |                    |
           |        |         +----------v---------+         |
           |        |         | retryCount < 1?    |         |
           |        |         | YES -> retry (D-04)|         |
           |        |         | NO  -> next tier   |         |
           |        |         +--------------------+         |
           |        |                                        |
           +--------v----------------------------------------+
                    |
          +---------v-----------+
          |    CRITIC PASS      |
          | Same model, T=0    |
          | AbortSignal(30s)   |
          | criticOutputSchema |
          +--------------------+
                    |
     +--------------v--------------+
     |     verdict?                |
     |                             |
     | "supported" -> pass through |
     | "partial"   -> downgrade    |
     | "unsupported"-> flip to     |
     |   insufficient_evidence     |
     | timeout     -> keep, mark   |
     +-----------------------------+
                    |
          +---------v-----------+
          | Return enriched     |
          | ExtractionResult    |
          | with criticVerdict  |
          +---------------------+
```

### Recommended Project Structure

```
convex/extraction/
  extract.ts           # MODIFY: superRefine + critic pass in extractSingleAnswer
  mutations.ts         # MODIFY: add criticVerdict arg to saveResult
  queries.ts           # ADD: getPaperBodyText query for UI
  workpoolActions.ts   # MODIFY: pass criticVerdict to saveResult
  validators.ts        # NO CHANGES (D-13)
  extract.test.ts      # ADD: Levenshtein + critic tests

lib/ai/core/
  prompts.ts           # ADD: buildCriticPrompt function
  types.ts             # NO CHANGES

components/extraction/
  evidence-quote.tsx              # NEW: EvidenceQuote component
  insufficient-evidence-card.tsx  # NEW: InsufficientEvidenceCard component
  confidence-badge.tsx            # NEW: ConfidenceBadge component
  critic-verdict-badge.tsx        # NEW: CriticVerdictBadge component

tests/extraction/
  levenshtein.test.ts            # NEW: standalone Levenshtein verification tests
```

### Pattern 1: Zod superRefine with Closure over bodyText

**What:** Build the extraction schema dynamically per-call with a `superRefine` that captures `bodyText` via closure, so Levenshtein verification runs inside the AI SDK's validation pipeline.

**When to use:** When post-parse validation needs external context (like the source text) that is not part of the schema itself.

**Example:**
```typescript
// Source: VERIFIED via AI SDK source code (output.ts line 142, schema.ts line 232)
// AI SDK calls z4.safeParseAsync(zodSchema, value) which runs superRefine

import { distance } from "fastest-levenshtein";

function buildExtractionSchema(bodyText: string) {
  return z
    .object({
      reasoning: z.string(),
      answer: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      evidence_quote: z.string(),
      evidence_source_id: z.string(),
      evidence_start_char: z.number(),
      evidence_end_char: z.number(),
    })
    .superRefine((data, ctx) => {
      // Defensive guards
      if (!bodyText || bodyText.length === 0) return;
      if (data.evidence_start_char < 0 || data.evidence_end_char > bodyText.length) {
        ctx.addIssue({
          code: "custom",
          message: `Character offsets out of bounds: [${data.evidence_start_char}, ${data.evidence_end_char}] for text of length ${bodyText.length}`,
        });
        return;
      }
      if (data.evidence_start_char >= data.evidence_end_char) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid character range: start (${data.evidence_start_char}) >= end (${data.evidence_end_char})`,
        });
        return;
      }

      const sourceSlice = bodyText.slice(data.evidence_start_char, data.evidence_end_char);
      const d = distance(data.evidence_quote, sourceSlice);
      const maxLen = Math.max(data.evidence_quote.length, sourceSlice.length);
      const similarity = maxLen === 0 ? 1 : 1 - d / maxLen;

      if (similarity < 0.85) {
        ctx.addIssue({
          code: "custom",
          message: `Evidence quote failed Levenshtein verification: ${(similarity * 100).toFixed(1)}% similarity (threshold: 85%). Quote: "${data.evidence_quote.slice(0, 80)}..." vs source: "${sourceSlice.slice(0, 80)}..."`,
        });
      }
    })
    .meta({
      propertyOrdering: [
        "reasoning", "answer", "confidence",
        "evidence_quote", "evidence_source_id",
        "evidence_start_char", "evidence_end_char",
      ],
    });
}
```

**Critical insight:** The `superRefine` closure captures `bodyText` at schema construction time. The schema must be rebuilt for each extraction call (not shared across calls), because each paper has different `bodyText`. [VERIFIED: AI SDK source]

### Pattern 2: Critic Pass with Same Model

**What:** After extraction succeeds (Levenshtein-verified), run a second `generateText` call using the same model at T=0 with a critic prompt.

**When to use:** After a verified extraction output, to double-check quote fidelity.

**Example:**
```typescript
// Source: Existing pattern in extract.ts (generateText + Output.object)
const criticOutputSchema = z.object({
  verdict: z.enum(["supported", "unsupported", "partial"]),
  reason: z.string(),
});

const criticPrompts = buildCriticPrompt({
  question: question.question,
  answer: extractedOutput.answer,
  evidenceQuote: extractedOutput.evidence_quote,
  sourceSlice: bodyText.slice(
    extractedOutput.evidence_start_char,
    extractedOutput.evidence_end_char
  ),
  bodyText,
});

const criticSignal = AbortSignal.timeout(30_000);

const { output: criticOutput, usage: criticUsage } = await generateText({
  model: tier.model,
  output: Output.object({ schema: criticOutputSchema }),
  temperature: 0,
  system: criticPrompts.system,
  prompt: criticPrompts.prompt,
  abortSignal: criticSignal,
});
```

### Pattern 3: Retry-Then-Escalate on Levenshtein Failure

**What:** When the `superRefine` Levenshtein check fails, the AI SDK throws `NoObjectGeneratedError`. The cascade catches this and retries once on the same tier before escalating to the next tier.

**When to use:** Specifically for Levenshtein validation failures within the cascade.

**Example:**
```typescript
// The cascade loop in extractSingleAnswer must track retries per tier
for (let i = 0; i < tiers.length; i++) {
  const tier = tiers[i];
  for (let attempt = 0; attempt <= 1; attempt++) {  // max 1 retry per tier
    try {
      const prompts = buildExtractionPrompts(
        { bodyText, question: question.question, expectedType: question.expectedType },
        attempt  // retryCount -- triggers retry-aware prompt messaging
      );
      // generateText + Output.object ...
      // If successful, proceed to critic
      break; // exit retry loop
    } catch (error) {
      if (attempt === 0) continue; // retry once on same tier
      if (i === tiers.length - 1) {
        // All tiers + retries exhausted
        return insufficientEvidenceResult(question.key, tier.name, error);
      }
      break; // escalate to next tier
    }
  }
}
```

### Anti-Patterns to Avoid

- **Rendering `evidenceQuote` from the LLM output:** The UI must NEVER display the model's `evidence_quote` field. Always use `bodyText.slice(evidenceStartChar, evidenceEndChar)`. The `evidenceQuote` field exists only for traceability/debugging.

- **Sharing the schema across calls:** The `superRefine` closure captures `bodyText`, so a shared schema would reference the wrong paper's text. Build the schema fresh in each `extractSingleAnswer` call.

- **Critic pass on already-failed extractions:** The critic should only run after a Levenshtein-verified extraction. If the extraction fails all tiers, skip the critic and go straight to `insufficient_evidence`.

- **Blocking on critic timeout:** The critic has a 30s timeout. If it times out, the answer is kept with `criticVerdict: "timeout"` -- a lenient policy per D-09. Do NOT reject good answers because the critic was slow.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Levenshtein distance | Custom edit distance algorithm | `fastest-levenshtein` `distance()` | O(nm) algorithm with WASM-like performance; handles Unicode properly; battle-tested with 1.13M weekly downloads [VERIFIED: npm] |
| Structured LLM output validation | Manual JSON.parse + manual field checking | `Output.object({ schema })` from AI SDK | AI SDK handles JSON parsing, schema validation, `superRefine` execution, error wrapping in `NoObjectGeneratedError` -- all in one pipeline [VERIFIED: source code] |
| Schema-level refinement | Post-parse manual Levenshtein check | Zod `superRefine` inside `Output.object` | Integrates directly into the AI SDK's validation pipeline; failures are caught by the cascade's try/catch for automatic escalation [VERIFIED: source code] |

**Key insight:** The AI SDK's `Output.object` calls `z4.safeParseAsync(zodSchema, value)` which runs ALL Zod refinements including `superRefine`. This means Levenshtein verification happens inside the AI SDK's validation pipeline -- failures throw `NoObjectGeneratedError`, which the cascade already catches for tier escalation. No additional error handling infrastructure needed.

## Common Pitfalls

### Pitfall 1: superRefine Not Running in JSON Schema Mode

**What goes wrong:** Some developers assume that when Zod schemas are converted to JSON Schema (for the LLM's structured output mode), the `superRefine` refinement is lost because JSON Schema has no concept of Zod refinements.

**Why it happens:** `superRefine` is indeed stripped from the JSON Schema sent to the LLM. However, the AI SDK runs TWO separate steps: (1) send JSON Schema to LLM for structured generation, (2) validate the response with the full Zod schema including refinements via `safeParseAsync`.

**How to avoid:** This is already handled correctly. The AI SDK's `Output.object` validates outputs using the full Zod schema, not just the JSON Schema. Refinements run during validation, not during schema serialization. [VERIFIED: `node_modules/ai/src/generate-text/output.ts` lines 129-158, `node_modules/@ai-sdk/provider-utils/src/schema.ts` line 232]

**Warning signs:** If `superRefine` failures are not triggering cascade escalation, check that the schema is being built with `superRefine` BEFORE passing to `Output.object`.

### Pitfall 2: Stale bodyText Closure in Schema

**What goes wrong:** If the extraction schema is built once at module level (like the current `extractionOutputSchema` constant) and the `superRefine` closure is added later, it might capture the wrong `bodyText`.

**Why it happens:** JavaScript closures capture variables by reference, and the schema must be rebuilt per-call.

**How to avoid:** Build the schema inside `extractSingleAnswer` (or a factory function called from it) so the closure captures the correct `bodyText` for the current paper. The current code defines `extractionOutputSchema` as a module-level constant -- this must be changed to a function.

**Warning signs:** All extractions pass/fail Levenshtein verification identically regardless of content.

### Pitfall 3: Empty bodyText or Out-of-Bounds Offsets

**What goes wrong:** The LLM returns `evidence_start_char: 0, evidence_end_char: 0` (empty slice) or offsets beyond `bodyText.length`, causing the Levenshtein check to compare against empty or undefined strings.

**Why it happens:** LLMs sometimes guess at character offsets, especially for shorter texts or when the evidence is near the end of the document.

**How to avoid:** Add defensive guards in the `superRefine` body: check for empty bodyText, negative offsets, start >= end, and end > bodyText.length. Return early (pass validation) if bodyText is empty (nothing to validate against), and add a Zod issue for invalid offset ranges.

**Warning signs:** Mysterious Levenshtein scores of 0% or NaN.

### Pitfall 4: saveResult Missing criticVerdict Arg

**What goes wrong:** The `saveResult` mutation in `mutations.ts` currently does NOT accept `criticVerdict` in its args (confirmed via grep). If the workpoolAction tries to pass `criticVerdict`, it will be silently dropped by Convex's argument validation.

**Why it happens:** Phase 91 added the `criticVerdict` field to the schema but not to the `saveResult` mutation args -- it was reserved for Phase 92.

**How to avoid:** Add `criticVerdict: v.optional(v.string())` to the `saveResult` mutation args and include it in the `ctx.db.insert` call. Also update `workpoolActions.ts` to pass `result.criticVerdict` through.

**Warning signs:** Critic verdicts are computed but never persisted; database rows always have `criticVerdict: undefined`.

### Pitfall 5: Critic Token Usage Not Aggregated

**What goes wrong:** The critic pass is a separate `generateText` call with its own `usage` object. If its tokens are not added to the extraction result's `tokensIn`/`tokensOut`, credit billing will undercount.

**Why it happens:** The `withUserCreditsBatch` wrapper in `workpoolActions.ts` aggregates token usage from `extractionResults` -- if critic tokens are not included in those results, they are unbilled.

**How to avoid:** After the critic call, add the critic's `usage.inputTokens` and `usage.outputTokens` to the extraction result's `tokensIn` and `tokensOut` before returning from `extractSingleAnswer`.

**Warning signs:** Per-paper costs appear lower than expected; token counts do not match OpenRouter dashboard.

## Code Examples

### Levenshtein Similarity Helper

```typescript
// Source: D-01 (locked decision), fastest-levenshtein API (verified via npm docs)
import { distance } from "fastest-levenshtein";

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1; // both empty -> identical
  return 1 - distance(a, b) / maxLen;
}

// Usage in superRefine:
const similarity = levenshteinSimilarity(data.evidence_quote, sourceSlice);
if (similarity < 0.85) {
  ctx.addIssue({ code: "custom", message: `...` });
}
```

### Critic Output Schema

```typescript
// Source: D-06 (locked decision)
const criticOutputSchema = z.object({
  verdict: z.enum(["supported", "unsupported", "partial"]).describe(
    "Whether the evidence quote appears verbatim in the source and supports the answer"
  ),
  reason: z.string().describe(
    "Brief explanation of the verdict"
  ),
});
```

### buildCriticPrompt Pattern

```typescript
// Source: existing pattern in lib/ai/core/prompts.ts (buildExtractionPrompts)
export interface CriticPromptInput {
  question: string;
  answer: string;
  evidenceQuote: string;
  sourceSlice: string;
}

export function buildCriticPrompt(input: CriticPromptInput) {
  return {
    system: `You are a citation verification specialist...`,
    prompt: `Verify this extraction result...`,
  };
}
```

### EvidenceQuote Component Data Flow

```typescript
// Source: D-15, UI-SPEC component inventory
// Dedicated Convex query for bodyText (not piggyback on heavier query)
export const getPaperBodyText = query({
  args: { paperId: v.id("extractionPapers") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;
    // Verify user owns the job
    const job = await ctx.db.get(paper.jobId);
    if (!job || job.userId !== user._id) return null;
    return paper.bodyText ?? null;
  },
});
```

### Confidence Downgrade Logic

```typescript
// Source: D-07 (locked decision)
function downgradeConfidence(
  current: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  const levels: Record<string, "high" | "medium" | "low"> = {
    high: "medium",
    medium: "low",
    low: "low",
  };
  return levels[current];
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trust LLM quotes verbatim | Levenshtein verify + critic pass | Phase 92 design | Prevents hallucinated quotes from reaching users |
| Show `evidence_quote` from LLM | Show `bodyText.slice(start, end)` | Phase 92 design | Eliminates source of paraphrased/fabricated quotes in UI |
| Binary success/failure for extraction | Three-state: success / `insufficient_evidence` / error (null) | Phase 92 design | Distinguishes "no evidence found" from "extraction crashed" |
| Zod 3 `.refine()` / `.superRefine()` | Zod 4 `.superRefine()` with `ctx.addIssue()` | Zod 4 (current) | API is identical; `code: "custom"` for custom issues |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fastest-levenshtein` works in Convex Node.js actions (no native binary dependencies) | Standard Stack | LOW -- pure JS implementation, but should be verified in the `"use node"` action environment |
| A2 | The `buildExtractionPrompts` retry-aware messaging (the `retryCount > 0` branch) is sufficient to guide the model to correct its quote on retry | Architecture Patterns | MEDIUM -- if the retry prompt does not clearly instruct the model to fix its quote, the retry is wasted; may need prompt tuning |

## Open Questions

1. **What is the performance impact of rebuilding the Zod schema per extraction call?**
   - What we know: The schema is small (7 fields + 1 superRefine). Zod 4 schema construction is fast.
   - What's unclear: Whether per-call schema construction adds measurable latency at scale.
   - Recommendation: Build per-call as required (correctness > micro-optimization). The LLM call latency (seconds) dwarfs schema construction (microseconds).

2. **Should the critic prompt include the full bodyText or just the source slice?**
   - What we know: D-05 asks "Does this quote appear verbatim in the source text". The full bodyText provides complete context.
   - What's unclear: Whether passing full bodyText to the critic doubles token costs unnecessarily.
   - Recommendation: Pass the full bodyText to the critic prompt. The models already have it cached from the extraction call (Gemini automatic caching, EXTR-07), so the incremental cost is negligible. This gives the critic full context to verify the quote appears verbatim.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Convex actions (extract.ts runs in `"use node"` runtime) | Assumed | 22 (pinned in convex.json) | -- |
| `fastest-levenshtein` | Levenshtein verification (EXTR-03) | Not yet installed | 1.0.16 (latest) | Install via `pnpm add fastest-levenshtein` |
| `@testing-library/react` | Component tests | Assumed installed | -- | Install if missing |
| pnpm | Package installation | Available | -- | -- |

**Missing dependencies with no fallback:**
- None (all dependencies installable)

**Missing dependencies with fallback:**
- `fastest-levenshtein`: install via `pnpm add fastest-levenshtein` (Wave 0 task)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `pnpm vitest run convex/extraction/extract.test.ts` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXTR-03 | Fabricated quote rejected at >=0.85 threshold | unit | `pnpm vitest run convex/extraction/extract.test.ts -t "Levenshtein"` | Wave 0 |
| EXTR-03 | Valid verbatim quote passes verification | unit | `pnpm vitest run convex/extraction/extract.test.ts -t "Levenshtein"` | Wave 0 |
| EXTR-04 | EvidenceQuote renders `bodyText.slice(start, end)`, never `evidenceQuote` | component | `pnpm vitest run tests/components/evidence-quote.test.tsx` | Wave 0 |
| EXTR-05 | Critic `unsupported` flips result to `insufficient_evidence` | unit | `pnpm vitest run convex/extraction/extract.test.ts -t "critic"` | Wave 0 |
| EXTR-05 | Critic timeout keeps answer with verdict `timeout` | unit | `pnpm vitest run convex/extraction/extract.test.ts -t "critic"` | Wave 0 |
| EXTR-08 | `insufficient_evidence` has confidence capped at `low` | unit | `pnpm vitest run convex/extraction/extract.test.ts -t "insufficient"` | Wave 0 |
| EXTR-08 | `insufficient_evidence` card renders reasoning, no evidence block | component | `pnpm vitest run tests/components/insufficient-evidence-card.test.tsx` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run convex/extraction/extract.test.ts`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `convex/extraction/extract.test.ts` -- new test cases for Levenshtein and critic (extend existing file)
- [ ] `tests/components/evidence-quote.test.tsx` -- covers EXTR-04
- [ ] `tests/components/insufficient-evidence-card.test.tsx` -- covers EXTR-08
- [ ] `pnpm add -D fastest-levenshtein` -- new dependency

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | yes | `getPaperBodyText` query must verify user owns the job before returning bodyText |
| V5 Input Validation | yes | Zod `superRefine` validates LLM output; character offset bounds checking |
| V6 Cryptography | no | -- |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User accessing another user's bodyText via `getPaperBodyText` | Information Disclosure | Auth check in query: verify `job.userId === user._id` |
| LLM output with out-of-bounds character offsets | Tampering | Defensive bounds checking in `superRefine` |
| Prompt injection via evidence_quote field in critic prompt | Tampering | Critic prompt uses delimiters around user-provided content; T=0 reduces creativity |

## Sources

### Primary (HIGH confidence)
- `node_modules/ai/src/generate-text/output.ts` -- AI SDK Output.object implementation; confirmed safeValidateTypes runs Zod safeParseAsync
- `node_modules/@ai-sdk/provider-utils/src/schema.ts` lines 230-238 -- Zod 4 adapter calls `z4.safeParseAsync(zodSchema, value)` which runs superRefine
- `node_modules/@ai-sdk/provider-utils/src/validate-types.ts` -- safeValidateTypes calls schema.validate which is the Zod adapter
- `node_modules/zod/src/v4/classic/tests/refine.test.ts` -- Zod 4 superRefine API confirmed: `ctx.addIssue({ code: "custom", ... })`
- `convex/extraction/extract.ts` -- Current extraction cascade implementation
- `convex/extraction/mutations.ts` -- saveResult mutation (missing criticVerdict in args)
- `convex/schema.ts` lines 471-497 -- extractionResults table with criticVerdict field
- npm registry: `fastest-levenshtein@1.0.16`

### Secondary (MEDIUM confidence)
- `fastest-levenshtein` GitHub README -- API docs for `distance()` and `closest()`
- 92-CONTEXT.md -- User decisions D-01 through D-20
- 92-UI-SPEC.md -- Component inventory and visual treatment

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified against source code and npm registry
- Architecture: HIGH -- AI SDK validation pipeline verified via source code inspection; Zod superRefine behavior confirmed via test files
- Pitfalls: HIGH -- each pitfall derived from source code analysis, not assumptions

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- core APIs unlikely to change in 30 days)
