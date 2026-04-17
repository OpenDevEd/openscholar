# Phase 100: Backend Wiring + TierSelector Fix - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 12 new/modified files
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `convex/schema.ts` | config | CRUD | self (lines 410-440) | exact |
| `convex/extraction/mutations.ts` | mutation | request-response | self (lines 32-147) | exact |
| `convex/extraction/extract.ts` | service | transform | self (lines 187-227) | exact |
| `convex/extraction/workpoolActions.ts` | service | batch | self (lines 39-336) | exact |
| `convex/extraction/extract.test.ts` | test | transform | self (lines 0-90, 186-234) | exact |
| `convex/openalex/actions.ts` | action | request-response | `convex/zotero/actions.ts` | role-match |
| `convex/lib/errors.ts` | utility | config | self (lines 1-81) | exact |
| `lib/toast/error-resolver.ts` | utility | request-response | self (lines 1-241) | exact |
| `components/extraction/extraction-dialog.tsx` | component | request-response | self (lines 115-151) | exact |
| `messages/en-US.json` | config | config | self (toast section lines 433+) | exact |
| `messages/{en-GB,fr,ja,zh,hi}.json` | config | config | `messages/en-US.json` | exact |

## Pattern Assignments

### `convex/schema.ts` (config, CRUD)

**Analog:** Self -- `extractionJobs` table definition

**Schema field addition pattern** (lines 410-440):
```typescript
// convex/schema.ts -- extractionJobs table
// Add tier field AFTER citationValidityRate, BEFORE closing })
extractionJobs: defineTable({
    userId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("failed")
    ),
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
    cancelledPapers: v.optional(v.number()),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        expectedType: v.optional(v.string()),
      })
    ),
    workflowId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    traceId: v.optional(v.string()),
    citationValidityRate: v.optional(v.number()),
    recallOnInclude: v.optional(v.number()),
    // NEW: tier field (D-01) -- optional, existing rows null-coalesce to "auto"
    tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate"))),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_workflow", ["workflowId"]),
```

---

### `convex/extraction/mutations.ts` (mutation, request-response)

**Analog:** Self -- `createExtractionJob` mutation

**Imports pattern** (lines 1-21):
```typescript
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { ulid } from "ulid";
import { /* validators */ } from "./validators";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_EXTRACTION_PAPERS_PER_JOB, MAX_EXTRACTION_RESULTS_QUERY } from "../lib/queryBounds";
import { getExtractionLimitForUser } from "../lib/extractionLimit";
import { workflow } from "../workflow";
import { extractionPool } from "../workpool";
```

**Args validator pattern** (lines 32-37):
```typescript
export const createExtractionJob = mutation({
  args: {
    papers: v.array(extractionPaperInputValidator),
    questions: v.array(extractionQuestionValidator),
    // NEW: tier arg (D-02)
  },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args) => {
```

**Auth + validation pattern** (lines 38-52):
```typescript
    // 1. Authentication (T-89-04)
    const user = await requireAuth(ctx);

    // 2. Validate paper count (T-89-06)
    if (args.papers.length === 0) {
      throw createError("VALIDATION_ERROR", "At least one paper is required");
    }
    const userLimit = await getExtractionLimitForUser(ctx, user._id);
    if (args.papers.length > userLimit) {
      throw createError(
        "VALIDATION_ERROR",   // D-07: change to "EXTRACTION_LIMIT_EXCEEDED"
        `Maximum ${userLimit} papers per job`,
      );
    }
```

**Job insert pattern** (lines 92-105):
```typescript
    // 5. Create extraction job record
    const now = Date.now();
    const traceId = ulid();
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      status: "pending",
      totalPapers: args.papers.length,
      processedPapers: 0,
      failedPapers: 0,
      questions: args.questions,
      traceId,
      createdAt: now,
      updatedAt: now,
      // NEW: tier: args.tier ?? "auto"  (D-02)
    });
```

---

### `convex/extraction/extract.ts` (service, transform)

**Analog:** Self -- `createCascadeTiers` and `extractSingleAnswer`

**Cascade tier definition pattern** (lines 182-213):
```typescript
interface CascadeTier {
  model: LanguageModel;
  name: string;
}

function createCascadeTiers(): CascadeTier[] {
  const openrouter = createOpenRouter();

  return [
    {
      name: "google/gemini-2.5-flash-lite",       // Index 0: cheapest
      model: openrouter("google/gemini-2.5-flash-lite", {
        plugins: [{ id: "response-healing" }],
        provider: { allowFallbacks: true },
      }),
    },
    {
      name: "google/gemini-3-flash-preview",       // Index 1: middle
      model: openrouter("google/gemini-3-flash-preview", { /* ... */ }),
    },
    {
      name: "anthropic/claude-haiku-4.5",          // Index 2: most capable
      model: openrouter("anthropic/claude-haiku-4.5", { /* ... */ }),
    },
  ];
}
```

**Cascade consumer pattern** (lines 219-227):
```typescript
async function extractSingleAnswer(
  bodyText: string,
  question: QuestionInput,
  signal: AbortSignal,
  traceId?: string,
  jobId?: Id<"extractionJobs">,
  paperId?: Id<"extractionPapers">
): Promise<ExtractionResult> {
  const tiers = createCascadeTiers();  // D-03: pass tier param here
```

**extractAnswers signature pattern** (lines 463-470):
```typescript
export async function extractAnswers(
  bodyText: string,
  questions: QuestionInput[],
  _parsingSource?: string,
  traceId?: string,
  jobId?: Id<"extractionJobs">,
  paperId?: Id<"extractionPapers">
  // NEW: tier?: ModelTier  (D-04)
): Promise<ExtractionResult[]> {
```

---

### `convex/extraction/workpoolActions.ts` (service, batch)

**Analog:** Self -- `processExtractionPaper` action

**Job row lookup pattern** (lines 49-63):
```typescript
  handler: async (ctx, args) => {
    // 1. Load job -- terminal-status guard (mirrors screening pattern)
    const job = await ctx.runQuery(
      internal.extraction.queries.getJobInternal,
      { jobId: args.jobId }
    );
    if (!job) {
      console.warn(JSON.stringify({ event: "job_not_found", jobId: String(args.jobId), traceId: args.traceId }));
      return { success: false };
    }

    const terminalStatuses = ["completed", "cancelled", "failed"];
    if (terminalStatuses.includes(job.status)) {
      console.info(JSON.stringify({ event: "job_terminal_skip", jobId: String(args.jobId), status: job.status, traceId: args.traceId }));
      return { success: false };
    }
    // D-04: Read job.tier here (e.g. const tier = job.tier ?? "auto")
```

**extractAnswers call site pattern** (lines 176-189):
```typescript
        extractionResults = await withUserCreditsBatch(
          ctx,
          jobForQuestions.userId,
          `Extraction (paper ${args.paperId})`,
          async (_pricing) => {
            const results = await extractAnswers(
              parsedPaper.bodyText!,
              questions,
              parsedPaper.parsingSource,
              args.traceId,
              args.jobId,
              args.paperId,
              // NEW: tier  (D-04)
            );
```

---

### `convex/openalex/actions.ts` (action, request-response) -- NEW FILE

**Analog:** `convex/zotero/actions.ts` (external API action) + `convex/wallet/actions.ts` (action pattern)

**Action file imports pattern** (from `convex/zotero/actions.ts` lines 0-13):
```typescript
"use node";  // NOTE: DO NOT USE for this file -- OpenAlex actions only use fetch()
             // Convex guidelines: "fetch() is available in the default Convex runtime"

// Correct pattern for fetch-only actions:
import { action } from "../_generated/server";
import { v } from "convex/values";
```

**Action registration pattern** (from `convex/wallet/actions.ts` lines 12-17):
```typescript
export const finalizeConnection = action({
  args: { walletKeyId: v.id("walletKeys") },
  returns: v.object({
    rawKey: v.string(),
    keyPrefix: v.string(),
  }),
  handler: async (ctx, args): Promise<{ rawKey: string; keyPrefix: string }> => {
```

**Error throwing in actions pattern** (from `convex/zotero/actions.ts` lines 13, 36-37):
```typescript
import { createError } from "../lib/errors";

// ...inside handler:
if (!encryptionKey) {
  throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
}
```

**Env var access pattern** (from `convex/zotero/actions.ts` line 35):
```typescript
const encryptionKey = process.env.ENCRYPTION_KEY;
// For OpenAlex: process.env.OPENALEX_CONTACT_EMAIL
```

**External API helper pattern** (from `convex/zotero/actions.ts` lines 44-50):
```typescript
async function requireCurrentUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) {
    throw createError("UNAUTHENTICATED", "Authentication required");
  }
  return user._id;
}
```

**CRITICAL: No `"use node"` for this file.** All existing action files use `"use node"` because they import Node-specific modules (crypto, Stripe SDK). The new OpenAlex actions only use `fetch()` and `process.env`, both available in the default Convex runtime. The Convex guidelines explicitly state: "`fetch()` is available in the default Convex runtime. You do NOT need `"use node"` just to use `fetch()`."

---

### `convex/extraction/extract.test.ts` (test, transform)

**Analog:** Self -- existing test structure

**Mock setup pattern** (lines 0-45):
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

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

**Test helper pattern** (lines 51-90):
```typescript
function makeSuccessResponse(overrides: Partial<{
  reasoning: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  /* ... */
}> = {}) {
  return {
    output: {
      reasoning: overrides.reasoning ?? "Found in methods section",
      answer: overrides.answer ?? "42 participants",
      /* ... */
    },
    usage: {
      inputTokens: overrides.inputTokens ?? 1000,
      outputTokens: overrides.outputTokens ?? 50,
    },
    /* ... boilerplate response fields ... */
  };
}
```

**Cascade test pattern** (lines 186-222):
```typescript
describe("cascade escalation (EXTR-06)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("escalates from tier 1 to tier 2 on schema failure", async () => {
    const { extractAnswers } = await import("./extract");

    let callCount = 0;
    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error("Schema validation failed");
      }
      if (callCount === 3) return makeSuccessResponse();
      return makeCriticResponse("supported", "OK");
    });

    const results = await extractAnswers(
      "The study enrolled 42 participants in a randomized controlled trial.",
      [{ key: "q1", question: "How many participants?", expectedType: "number" }]
    );

    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("42 participants");
  });
});
```

---

### `convex/lib/errors.ts` (utility, config)

**Analog:** Self -- ErrorCode union and createError factory

**ErrorCode extension pattern** (lines 1-69):
```typescript
export type ErrorCode =
  // ... existing codes ...
  // Extraction
  | "EXTRACTION_JOB_ALREADY_ACTIVE"
  | "EXTRACTION_JOB_NOT_FOUND"
  | "EXTRACTION_JOB_NOT_CANCELLABLE"
  // NEW: add here, grouped with Extraction codes
  | "EXTRACTION_LIMIT_EXCEEDED"
```

**createError factory pattern** (lines 73-81):
```typescript
export function createError(
  code: ErrorCode,
  message?: string
): ConvexError<ErrorData> {
  if (message) {
    return new ConvexError({ code, message });
  }
  return new ConvexError({ code });
}
```

---

### `lib/toast/error-resolver.ts` (utility, request-response)

**Analog:** Self -- MESSAGE_KEY_BY_CODE mapping and ToastErrorMessageKey type

**ToastErrorMessageKey extension pattern** (lines 3-37):
```typescript
export type ToastErrorMessageKey =
  | "convexUnknownError"
  // ... existing keys ...
  | "creditsProductMisconfigured"
  // NEW: add here
  | "extractionLimitExceeded"
  | "extractionJobAlreadyActive";  // D-09: also add this for the inline fix
```

**MESSAGE_KEY_BY_CODE extension pattern** (lines 63-103):
```typescript
const MESSAGE_KEY_BY_CODE: Record<string, ToastErrorMessageKey> = {
  UNAUTHENTICATED: "convexAuthRequired",
  // ... existing mappings ...
  CREDITS_PRODUCT_NOT_CONFIGURED: "creditsProductMisconfigured",
  // NEW: add these
  EXTRACTION_LIMIT_EXCEEDED: "extractionLimitExceeded",
  EXTRACTION_JOB_ALREADY_ACTIVE: "extractionJobAlreadyActive",  // D-09
};
```

---

### `components/extraction/extraction-dialog.tsx` (component, request-response)

**Analog:** Self -- submit handler and error handling

**Current imports pattern** (lines 0-23):
```typescript
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import posthog from "posthog-js";
import { /* Dialog parts */ } from "@/components/ui/dialog";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/toast";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import { TierSelector, type ModelTier } from "./tier-selector";
// NEW: import { resolveToastError, getToastMessageKeyForErrorCode } from "@/lib/toast/error-resolver";
```

**Mutation call pattern** (lines 115-125):
```typescript
  const createJob = useMutation(api.extraction.mutations.createExtractionJob);

  const handleSubmit = useCallback(async () => {
    if (!papers || papers.length === 0 || localQuestions.length === 0) return;
    setIsSubmitting(true);
    try {
      const keyedQuestions = localQuestions.map((q, i) => ({
        key: `q_${i}`,
        question: q,
      }));
      await createJob({ papers, questions: keyedQuestions });
      // D-02: pass tier: await createJob({ papers, questions: keyedQuestions, tier });
```

**Inline error handling to migrate** (lines 133-147):
```typescript
    } catch (error: unknown) {
      const msg = getErrorMessage(error, t("jobCreation.error"));
      if (
        typeof error === "object" &&
        error !== null &&
        "data" in error &&
        typeof (error as { data?: unknown }).data === "string" &&
        ((error as { data: string }).data).includes(
          "EXTRACTION_JOB_ALREADY_ACTIVE"
        )
      ) {
        showStyledToast("error", t("jobCreation.activeJobWarning"));
      } else {
        showStyledToast("error", msg);
      }
    }
```

---

### `messages/en-US.json` (config, config)

**Analog:** Self -- toast section

**Toast key addition pattern** (lines 486-505):
```json
{
  "toast": {
    "convexUnknownError": "Something went wrong. Please try again.",
    "convexAuthRequired": "Please sign in to continue.",
    "...existing keys...": "...",
    "creditsProductMisconfigured": "Credit products are not configured correctly."
  }
}
```

New keys to add (grouped with extraction/billing section):
```json
{
  "toast": {
    "extractionLimitExceeded": "You can extract up to {limit} papers per job. Remove {excess} papers to continue.",
    "extractionJobAlreadyActive": "An extraction job is already running. Please wait for it to finish."
  }
}
```

---

## Shared Patterns

### Authentication (requireAuth)
**Source:** `convex/lib/auth.ts` (imported at `convex/extraction/mutations.ts` line 14)
**Apply to:** `convex/extraction/mutations.ts` (already uses it), NOT needed for `convex/openalex/actions.ts` (public actions that don't need auth per D-05/D-06)
```typescript
import { requireAuth } from "../lib/auth";
// In mutation handler:
const user = await requireAuth(ctx);
```

### Typed Error Factory (createError)
**Source:** `convex/lib/errors.ts` lines 73-81
**Apply to:** `convex/extraction/mutations.ts`, `convex/openalex/actions.ts`
```typescript
import { createError } from "../lib/errors";
// Usage:
throw createError("EXTRACTION_LIMIT_EXCEEDED", `Maximum ${userLimit} papers per job. You submitted ${args.papers.length}.`);
```

### Toast Error Resolution Chain
**Source:** `lib/toast/error-resolver.ts` lines 216-240
**Apply to:** `components/extraction/extraction-dialog.tsx`
```typescript
import { resolveToastError, getToastMessageKeyForErrorCode } from "@/lib/toast/error-resolver";

// In catch block:
const resolved = resolveToastError(error, t("jobCreation.error"));
const messageKey = getToastMessageKeyForErrorCode(resolved.code);
showStyledToast("error", messageKey ? t(`toast.${messageKey}`) : resolved.message);
```

### OpenAlex ID Normalization
**Source:** `lib/openalex/normalize.ts` lines 14-26
**Apply to:** `convex/openalex/actions.ts` -- `resolveManualIds` action
```typescript
import { normalizeOpenAlexId } from "../../lib/openalex/normalize";
// Usage:
const normalized = args.rawInputs.map((raw) => ({
  raw,
  id: normalizeOpenAlexId(raw),
}));
```

### ModelTier Type Reuse
**Source:** `components/extraction/tier-selector.tsx` line 12
**Apply to:** `convex/extraction/extract.ts`, `convex/extraction/workpoolActions.ts`
```typescript
export type ModelTier = "auto" | "cheap" | "accurate";
```

Note: This type is defined in a `"use client"` component file. For Convex server-side code, either import the type (TypeScript will erase it at runtime) or re-declare it locally as `type ModelTier = "auto" | "cheap" | "accurate"` to avoid cross-boundary import issues.

### Convex Validator for ModelTier
**Source:** Pattern from `convex/schema.ts` -- same validator used in both schema and mutation args
**Apply to:** `convex/schema.ts` (schema field), `convex/extraction/mutations.ts` (args)
```typescript
// Reusable validator (could be in convex/extraction/validators.ts or inline)
v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate")))
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| -- | -- | -- | All 12 files have close analogs in the existing codebase |

Every file in this phase either modifies an existing file (with clear self-analog patterns) or creates a new action file that follows the well-established Convex action pattern from `convex/zotero/actions.ts` and `convex/wallet/actions.ts`. No novel patterns are required.

## Metadata

**Analog search scope:** `convex/`, `lib/`, `components/extraction/`, `messages/`
**Files scanned:** 18 analog candidates examined
**Pattern extraction date:** 2026-04-15
