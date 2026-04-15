# Phase 92: Deterministic Citation Grounding - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 10
**Analogs found:** 9 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `convex/extraction/extract.ts` | service | request-response | `convex/extraction/extract.ts` (self -- modify) | exact |
| `convex/extraction/mutations.ts` | service | CRUD | `convex/extraction/mutations.ts` (self -- modify) | exact |
| `convex/extraction/workpoolActions.ts` | service | request-response | `convex/extraction/workpoolActions.ts` (self -- modify) | exact |
| `convex/extraction/queries.ts` | service | CRUD | `convex/extraction/queries.ts` (self -- add query) | exact |
| `lib/ai/core/prompts.ts` | utility | transform | `lib/ai/core/prompts.ts` (self -- add function) | exact |
| `convex/extraction/extract.test.ts` | test | transform | `convex/extraction/extract.test.ts` (self -- add cases) | exact |
| `components/extraction/evidence-quote.tsx` | component | request-response | `components/screening/screening-progress.tsx` | role-match |
| `components/extraction/insufficient-evidence-card.tsx` | component | request-response | `components/screening/screening-progress.tsx` | role-match |
| `components/extraction/confidence-badge.tsx` | component | transform | `components/paper-card/shared.tsx` (`ScreeningBadge`) | role-match |
| `components/extraction/critic-verdict-badge.tsx` | component | transform | `components/paper-card/shared.tsx` (`ScreeningBadge`) | role-match |

## Pattern Assignments

### `convex/extraction/extract.ts` (service, request-response) -- MODIFY

**Analog:** Self (lines 1-273). Phase 92 modifies `extractSingleAnswer` and the schema.

**Current module-level schema pattern** (lines 55-89) -- must be replaced with a factory function:
```typescript
const extractionOutputSchema = z
  .object({
    reasoning: z.string().describe(
      "Step-by-step reasoning referencing specific text from the paper. Explain WHY this answer is correct."
    ),
    answer: z.string().describe(
      "The extracted answer to the question. Use the exact text from the paper when possible."
    ),
    confidence: z.enum(["high", "medium", "low"]).describe(
      "Confidence level: high = explicit statement, medium = inferred, low = uncertain/partial evidence"
    ),
    evidence_quote: z.string().describe(
      "Verbatim quote from the source text that supports this answer. Must be an exact substring."
    ),
    evidence_source_id: z.string().describe(
      "Section or paragraph identifier where the evidence was found"
    ),
    evidence_start_char: z.number().describe(
      "Start character offset of the evidence quote in the full source text"
    ),
    evidence_end_char: z.number().describe(
      "End character offset of the evidence quote in the full source text"
    ),
  })
  .meta({
    propertyOrdering: [
      "reasoning",
      "answer",
      "confidence",
      "evidence_quote",
      "evidence_source_id",
      "evidence_start_char",
      "evidence_end_char",
    ],
  });
```

**Current cascade loop pattern** (lines 132-196) -- must be extended with retry-per-tier and critic pass:
```typescript
async function extractSingleAnswer(
  bodyText: string,
  question: QuestionInput,
  signal: AbortSignal
): Promise<ExtractionResult> {
  const tiers = createCascadeTiers();
  const prompts = buildExtractionPrompts(
    { bodyText, question: question.question, expectedType: question.expectedType },
    0
  );

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    try {
      const { output, usage } = await generateText({
        model: tier.model,
        output: Output.object({ schema: extractionOutputSchema }),
        temperature: 0,
        system: prompts.system,
        prompt: prompts.prompt,
        abortSignal: signal,
      });

      if (!output) {
        throw new Error(`Tier ${tier.name} returned null output`);
      }

      return {
        questionId: question.key,
        answer: output.answer,
        confidence: output.confidence,
        evidenceQuote: output.evidence_quote,
        evidenceSourceId: output.evidence_source_id,
        evidenceStartChar: output.evidence_start_char,
        evidenceEndChar: output.evidence_end_char,
        reasoning: output.reasoning,
        modelUsed: tier.name,
        tokensIn: usage.inputTokens ?? 0,
        tokensOut: usage.outputTokens ?? 0,
      };
    } catch (error) {
      const isLastTier = i === tiers.length - 1;
      if (isLastTier) {
        return {
          questionId: question.key,
          answer: null,
          modelUsed: tier.name,
          errorMessage: `All cascade tiers failed. Last error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      console.warn(
        `[ExtractionCascade] Tier ${tier.name} failed for question "${question.key}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    questionId: question.key,
    answer: null,
    errorMessage: "Cascade exhausted unexpectedly",
  };
}
```

**ExtractionResult interface** (lines 36-49) -- must gain `criticVerdict` field:
```typescript
export interface ExtractionResult {
  questionId: string;
  answer: string | null;
  confidence?: "high" | "medium" | "low";
  evidenceQuote?: string;
  evidenceSourceId?: string;
  evidenceStartChar?: number;
  evidenceEndChar?: number;
  reasoning?: string;
  modelUsed?: string;
  tokensIn?: number;
  tokensOut?: number;
  errorMessage?: string;
}
```

**Import pattern** (lines 20-24):
```typescript
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { buildExtractionPrompts } from "../../lib/ai/core/prompts";
```

---

### `convex/extraction/mutations.ts` (service, CRUD) -- MODIFY

**Analog:** Self. The `saveResult` mutation (lines 301-353) must gain a `criticVerdict` arg.

**Current saveResult args pattern** (lines 302-319):
```typescript
export const saveResult = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    questionId: v.string(),
    answer: v.union(v.string(), v.null()),
    confidence: v.optional(extractionConfidenceValidator),
    evidenceQuote: v.optional(v.string()),
    evidenceSourceId: v.optional(v.string()),
    evidenceStartChar: v.optional(v.number()),
    evidenceEndChar: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    modelUsed: v.optional(v.string()),
    parsingSource: v.optional(parsingSourceValidator),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
```

**Current db.insert call** (lines 332-351) -- must include `criticVerdict`:
```typescript
    await ctx.db.insert("extractionResults", {
      jobId: args.jobId,
      paperId: args.paperId,
      questionId: args.questionId,
      answer: args.answer,
      confidence: args.confidence,
      evidenceQuote: args.evidenceQuote,
      evidenceSourceId: args.evidenceSourceId,
      evidenceStartChar: args.evidenceStartChar,
      evidenceEndChar: args.evidenceEndChar,
      reasoning: args.reasoning,
      modelUsed: args.modelUsed,
      parsingSource: args.parsingSource,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      errorMessage: args.errorMessage,
      createdAt: Date.now(),
    });
```

**Import pattern** (lines 1-16):
```typescript
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  extractionJobStatusValidator,
  extractionPaperStatusValidator,
  extractionQuestionValidator,
  extractionPaperInputValidator,
  extractionConfidenceValidator,
  parsingSourceValidator,
} from "./validators";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";
```

---

### `convex/extraction/workpoolActions.ts` (service, request-response) -- MODIFY

**Analog:** Self. The `processExtractionPaper` action (lines 37-236) must pass `criticVerdict` to `saveResult`.

**Current saveResult call pattern** (lines 191-212):
```typescript
      for (const result of extractionResults) {
        await ctx.runMutation(
          internal.extraction.mutations.saveResult,
          {
            jobId: args.jobId,
            paperId: args.paperId,
            questionId: result.questionId,
            answer: result.answer,
            confidence: result.confidence,
            evidenceQuote: result.evidenceQuote,
            evidenceSourceId: result.evidenceSourceId,
            evidenceStartChar: result.evidenceStartChar,
            evidenceEndChar: result.evidenceEndChar,
            reasoning: result.reasoning,
            modelUsed: result.modelUsed,
            parsingSource: parsedPaper.parsingSource,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            errorMessage: result.errorMessage,
          }
        );
      }
```

---

### `convex/extraction/queries.ts` (service, CRUD) -- ADD `getPaperBodyText` query

**Analog:** `convex/extraction/queries.ts` lines 20-61 (`getExtractionProgress`) -- public query with auth + user isolation.

**Auth-guarded public query pattern** (lines 20-61):
```typescript
export const getExtractionProgress = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({ /* fields */ })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    // ... return shaped data
  },
});
```

**Import pattern** (lines 1-10):
```typescript
import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  extractionJobStatusValidator,
  extractionPaperStatusValidator,
  extractionQuestionValidator,
  parsingSourceValidator,
} from "./validators";
import { getCurrentUser } from "../lib/auth";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";
```

**User isolation pattern** -- the new `getPaperBodyText` must verify `job.userId === user._id` (same as `getExtractionProgress` line 37):
```typescript
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;
```

For the new query, the pattern should be: load paper -> load its job -> verify `job.userId === user._id` -> return `paper.bodyText`.

---

### `lib/ai/core/prompts.ts` (utility, transform) -- ADD `buildCriticPrompt`

**Analog:** Self. All 6 existing prompt builders follow the same pattern.

**Prompt builder pattern** (e.g. `buildExtractionPrompts` at lines 227-262):
```typescript
export function buildExtractionPrompts(input: ExtractionPromptInput, retryCount: number) {
  return {
    system: `You are an academic data extraction specialist. ...`,
    prompt: `Extract the answer to the following question from this research paper.
...
${retryCount > 0 ? '\n\nIMPORTANT: Previous extraction attempt failed...' : ''}`,
  };
}
```

**Input type pattern** (from `lib/ai/core/types.ts` lines 61-65):
```typescript
export interface ExtractionPromptInput {
  bodyText: string
  question: string
  expectedType?: string
}
```

**Key convention:** Each prompt builder has a corresponding input interface in `lib/ai/core/types.ts`. The new `CriticPromptInput` interface should be added there.

**Return shape:** Always `{ system: string; prompt: string }`.

---

### `convex/extraction/extract.test.ts` (test, transform) -- ADD Levenshtein + critic tests

**Analog:** Self (lines 1-277). Existing test structure.

**Mock setup pattern** (lines 1-21):
```typescript
const mockGenerateText = vi.fn();

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: mockGenerateText,
  };
});

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => (modelId: string) => ({ modelId, provider: "openrouter" }),
}));
```

**Test helper pattern** (lines 27-65):
```typescript
function makeSuccessResponse(overrides: Partial<{
  reasoning: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  evidence_quote: string;
  evidence_source_id: string;
  evidence_start_char: number;
  evidence_end_char: number;
  inputTokens: number;
  outputTokens: number;
}> = {}) {
  return {
    output: {
      reasoning: overrides.reasoning ?? "Found in methods section",
      answer: overrides.answer ?? "42 participants",
      confidence: overrides.confidence ?? "high",
      evidence_quote: overrides.evidence_quote ?? "42 participants were enrolled",
      evidence_source_id: overrides.evidence_source_id ?? "Methods",
      evidence_start_char: overrides.evidence_start_char ?? 100,
      evidence_end_char: overrides.evidence_end_char ?? 130,
    },
    usage: {
      inputTokens: overrides.inputTokens ?? 1000,
      outputTokens: overrides.outputTokens ?? 50,
    },
    text: "",
    finishReason: "stop",
    response: { id: "test", timestamp: new Date(), modelId: "test" },
    // ... other fields
  };
}
```

**Describe/it pattern** (lines 70-185):
```typescript
describe("extraction output schema (EXTR-02)", () => {
  it("produces JSON Schema with propertyOrdering ...", () => {
    // ...
  });
});

describe("cascade escalation (EXTR-06)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("escalates from tier 1 to tier 2 on schema failure", async () => {
    const { extractAnswers } = await import("./extract");
    // ...
  });
});
```

**Key convention:** Uses dynamic `await import("./extract")` after mocks are set up. Tests check both happy path and failure modes.

---

### `components/extraction/evidence-quote.tsx` (component, request-response) -- NEW

**Analog:** `components/screening/screening-progress.tsx` -- a client component that fetches Convex data via `useQuery` and renders with loading/error states.

**Convex query + loading state pattern** (lines 1-99):
```typescript
"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ...

export function ScreeningProgress({ jobId }: ScreeningProgressProps) {
  const t = useTranslations("screeningDialog");
  const progress = useQuery(api.screening.queries.getScreeningProgress, {
    jobId,
  });

  // Loading state (undefined = query still pending)
  if (progress === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("progressTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-2 rounded-full bg-muted" />
            <div className="h-4 w-48 rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Null state (not found / no access)
  if (progress === null) {
    return null;
  }

  // Loaded state
  return (
    <Card>
      {/* ... */}
    </Card>
  );
}
```

**Key conventions for EvidenceQuote:**
- `"use client"` directive
- `useQuery` from `convex/react` for data fetching
- `useTranslations` from `next-intl` for i18n
- Three-state rendering: `undefined` (loading skeleton), `null` (error/empty), value (rendered)
- Import `Id` type from `@/convex/_generated/dataModel`
- Import `api` from `@/convex/_generated/api`
- Lucide icons for visual indicators
- `cn()` from `@/lib/utils` for conditional classnames

---

### `components/extraction/insufficient-evidence-card.tsx` (component, request-response) -- NEW

**Analog:** `components/screening/screening-progress.tsx` for Card structure + `components/billing/credit-balance-card.tsx` for info-card layout.

**Info card pattern** (from `credit-balance-card.tsx` lines 1-105):
```typescript
"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreditBalanceCardProps {
  freeBalance: number;
  // ...
  className?: string;
}

export function CreditBalanceCard({
  freeBalance,
  // ...
  className,
}: CreditBalanceCardProps) {
  const t = useTranslations("billingPage");

  return (
    <div className={cn("space-y-4", className)}>
      {/* ... */}
    </div>
  );
}
```

**Key conventions for InsufficientEvidenceCard:**
- Props-driven component (receives data, does not fetch)
- Uses `Card` from `@/components/ui/card` with `opacity-75 border-dashed` per UI-SPEC
- `Badge variant="secondary"` for the "Insufficient evidence" label
- Lucide `Info` icon
- `className` prop with `cn()` merge

---

### `components/extraction/confidence-badge.tsx` (component, transform) -- NEW

**Analog:** `components/paper-card/shared.tsx` `ScreeningBadge` (lines 385-418).

**State-to-style mapping badge pattern** (lines 385-418):
```typescript
export function ScreeningBadge({
  displayState,
  index,
  question,
  variant = "default",
}: ScreeningBadgeProps) {
  const tp = useTranslations("paperCard");
  const baseClasses = cn(
    "flex items-center gap-1 rounded border text-xs transition-colors",
    variant === "icon-only" ? "p-1" : "px-2 py-1"
  );

  const stateClasses = {
    checked: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400",
    crossed: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400",
    loading: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400 cursor-wait",
    unchecked: "bg-muted/50 border-border text-muted-foreground",
  };

  return (
    <div
      className={cn(baseClasses, stateClasses[displayState])}
      title={tp("questionN", { n: index + 1, question })}
    >
      {displayState === "checked" && <Check className="h-3 w-3" />}
      {displayState === "crossed" && <X className="h-3 w-3" />}
      {displayState === "unchecked" && <Minus className="h-3 w-3" />}
      {displayState === "loading" && (
        <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
      )}
      {variant !== "icon-only" && <span className="font-mono">{index + 1}</span>}
    </div>
  );
}
```

**Key conventions for ConfidenceBadge and CriticVerdictBadge:**
- State-to-class mapping object for semantic coloring
- `cn()` to merge base + state classes
- Lucide icon per state (12px / `h-3 w-3`)
- `useTranslations` for i18n labels
- UI-SPEC uses OKLCH semantic colors (see UI-SPEC color table), but the pattern structure matches ScreeningBadge

---

### `components/extraction/critic-verdict-badge.tsx` (component, transform) -- NEW

**Analog:** Same as `confidence-badge.tsx` -- `components/paper-card/shared.tsx` `ScreeningBadge` (lines 385-418). See pattern excerpt above.

**Additional convention:** Uses `ai-surface` utility class for the `supported` verdict per UI-SPEC.

---

## Shared Patterns

### Authentication / User Isolation
**Source:** `convex/lib/auth.ts` lines 31-39 (`getCurrentUser`) and `convex/extraction/queries.ts` lines 33-37
**Apply to:** New `getPaperBodyText` query in `queries.ts`
```typescript
const user = await getCurrentUser(ctx);
if (!user) return null;

const job = await ctx.db.get(args.jobId);
if (!job || job.userId !== user._id) return null;
```

### Error Handling in Cascade
**Source:** `convex/extraction/extract.ts` lines 172-188
**Apply to:** Modified `extractSingleAnswer` with retry loop
```typescript
    } catch (error) {
      const isLastTier = i === tiers.length - 1;
      if (isLastTier) {
        return {
          questionId: question.key,
          answer: null,
          modelUsed: tier.name,
          errorMessage: `All cascade tiers failed. Last error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      console.warn(
        `[ExtractionCascade] Tier ${tier.name} failed for question "${question.key}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
```

### AI SDK Structured Output
**Source:** `convex/extraction/extract.ts` lines 146-153
**Apply to:** Both extraction call (existing) and new critic call
```typescript
const { output, usage } = await generateText({
  model: tier.model,
  output: Output.object({ schema: extractionOutputSchema }),
  temperature: 0,
  system: prompts.system,
  prompt: prompts.prompt,
  abortSignal: signal,
});
```

### Prompt Builder Convention
**Source:** `lib/ai/core/prompts.ts` -- all 6 existing builders
**Apply to:** New `buildCriticPrompt`
- Input interface defined in `lib/ai/core/types.ts`
- Returns `{ system: string; prompt: string }`
- System prompt establishes role, prompt provides specific data
- Template literals with conditional sections

### React Component Data Fetching
**Source:** `components/screening/screening-progress.tsx` lines 46-65
**Apply to:** `EvidenceQuote` component
```typescript
"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";

// Three-state rendering:
const data = useQuery(api.extraction.queries.getPaperBodyText, { paperId });
if (data === undefined) return /* skeleton */;
if (data === null) return /* error/empty */;
return /* rendered content */;
```

### i18n Pattern
**Source:** `messages/en-US.json` (1455 lines, no existing `extraction` namespace)
**Apply to:** All new components need i18n keys under a new `extraction` namespace
- Components use `useTranslations("extraction")` (or a sub-namespace)
- i18n keys listed in UI-SPEC copywriting contract

### Test Mocking Pattern
**Source:** `convex/extraction/extract.test.ts` lines 1-21
**Apply to:** New Levenshtein and critic test cases
- `vi.mock("ai")` with `importOriginal` to preserve non-mocked exports
- `vi.mock("@openrouter/ai-sdk-provider")` to stub model creation
- `mockGenerateText.mockReset()` in `beforeEach`
- Dynamic import `await import("./extract")` after mocks

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `messages/en-US.json` (extraction keys) | config | -- | No existing `extraction` i18n namespace. UI-SPEC copywriting contract lists exact keys to add. Follow the existing top-level namespace pattern (e.g. `"screeningDialog": { ... }`). |

## Metadata

**Analog search scope:** `convex/extraction/`, `lib/ai/core/`, `components/`, `messages/`
**Files scanned:** 18
**Pattern extraction date:** 2026-04-15
