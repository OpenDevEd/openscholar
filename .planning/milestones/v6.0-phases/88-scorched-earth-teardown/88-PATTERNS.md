# Phase 88: Scorched-Earth Teardown - Pattern Map

**Mapped:** 2026-04-14
**Files analyzed:** 48 files to delete/modify across 9 deletion layers
**Analogs found:** N/A (destructive phase -- no new files created)

## Nature of This Phase

This phase is **purely destructive**. No new files are created. The pattern map therefore focuses on:
1. **Surgical edit patterns** -- exact line ranges and code blocks to remove from shared files
2. **Wholesale deletion inventory** -- directories and standalone files to `rm -rf`
3. **Cross-cutting cleanup** -- imports, re-exports, and scattered references

There are no "analogs" in the traditional sense. Instead, each shared file is documented with the exact extraction code to remove and the surrounding non-extraction code that must be preserved.

## File Classification

| File/Directory | Role | Action | Layer |
|----------------|------|--------|-------|
| `app/extraction/` (7 files) | route | `rm -rf` | 1 |
| `components/extraction/` (44 files) | component | `rm -rf` | 2 |
| `lib/extraction/` (15 files) | utility | `rm -rf` | 3 |
| `lib/store/extraction.ts` | store | delete file | 3 |
| `lib/types/extraction.types.ts` | type-def | delete file | 3 |
| `lib/pdf/download.ts` | utility | delete file | 3 |
| `lib/store.ts` | store | surgical edit | 4 |
| `lib/types/index.ts` | type-def | surgical edit | 4 |
| `lib/types/search.types.ts` | type-def | surgical edit | 4 |
| `components/app-sidebar.tsx` | component | surgical edit | 4 |
| `lib/ai/core/configs.ts` | config | surgical edit | 4 |
| `lib/ai/client/executor.ts` | service | surgical edit | 4 |
| `lib/ai/core/types.ts` | type-def | surgical edit | 4 |
| `lib/ai/core/schemas.ts` | config | surgical edit | 4 |
| `lib/ai/core/prompts.ts` | config | surgical edit | 4 |
| `convex/extraction/` (32 files) | backend | `rm -rf` | 5 |
| `convex/debug.ts` | backend | delete file | 5 |
| `convex/debug_papers.ts` | backend | delete file | 5 |
| `convex/maintenance/mutations.ts` | backend | surgical edit | 5 |
| `convex/ai/actions.ts` | backend | surgical edit | 5 |
| `convex/lib/rateLimit.ts` | backend | surgical edit | 5 |
| `convex/featureFlags/internal.ts` | backend | surgical edit | 5 |
| `convex/lib/constants.ts` | backend | surgical edit | 5 |
| `convex/lib/queryBounds.ts` | backend | surgical edit | 5 |
| `convex/schema.ts` | schema | surgical edit | 6 |
| `convex/convex.config.ts` | config | surgical edit | 7 |
| `convex/workpool.ts` | backend | surgical edit | 7 |
| `package.json` | config | uninstall deps | 7 |
| `messages/en-US.json` | i18n | surgical edit | 8 |
| `messages/en-GB.json` | i18n | surgical edit | 8 |
| `messages/zh.json` | i18n | surgical edit | 8 |
| `messages/fr.json` | i18n | surgical edit | 8 |
| `messages/hi.json` | i18n | surgical edit | 8 |
| `messages/ja.json` | i18n | surgical edit | 8 |
| `tests/extraction/` (2 files) | test | `rm -rf` | 9 |
| 23 test files in `tests/` | test | delete files | 9 |

## Surgical Edit Patterns

Each section below documents exact code to remove from a shared file, with line numbers verified against the current codebase.

---

### `convex/schema.ts` (schema, Layer 6)

**Remove import** (line 4):
```typescript
import { searchFiltersValidator } from "./extraction/validators";
```
This import is ONLY consumed by extraction tables being deleted. Verified: zero non-extraction usage of `searchFiltersValidator`.

**Remove 11 extraction tables** (lines 316-781):
Remove everything from the `// EXTRACTION JOBS` comment block through the end of the `extractionRunDiffs` table definition (ending at line 781 with the last `.index(...)` call). The next retained table starts at line 783:
```typescript
  // ═══════════════════════════════════════════════════════════════
  // SCREENING JOBS - bulk screening job records
  // ═══════════════════════════════════════════════════════════════
  screeningJobs: defineTable({
```

**Tables to delete:** `extractionJobs`, `extractionQuestions`, `extractionPapers`, `extractionEvidenceUnits`, `extractionResults`, `extractionResultReviews`, `extractionSavedViews`, `extractionWorkflowTemplates`, `extractionReportSnapshots`, `extractionJobStats`, `extractionRunDiffs`.

**Keep:** All tables before line 316 (models, featureFlags, users, credits, etc.) and all tables after line 781 (screeningJobs, etc.).

---

### `convex/convex.config.ts` (config, Layer 7)

**Current file (complete -- 15 lines):**
```typescript
import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";            // REMOVE
import workflow from "@convex-dev/workflow/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";  // REMOVE
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(rag);                                                   // REMOVE
app.use(workflow);
app.use(workpool);                                              // REMOVE
app.use(screeningWorkpool, { name: "screeningWorkpool" });

export default app;
```

**Remove lines:** 3 (`rag` import), 5 (`workpool` import), 10 (`app.use(rag)`), 12 (`app.use(workpool)`).

**After edit, file should be:**
```typescript
import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(workflow);
app.use(screeningWorkpool, { name: "screeningWorkpool" });

export default app;
```

---

### `convex/workpool.ts` (backend, Layer 7)

**Current file (complete -- 25 lines):**
```typescript
import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

// For PDF processing - limited to avoid overwhelming external services
// Reduced to 3 to prevent database conflicts with onComplete handlers
export const pdfProcessingPool = new Workpool(components.workpool, {  // REMOVE
  maxParallelism: 3,                                                   // REMOVE
  retryActionsByDefault: true,                                         // REMOVE
  defaultRetryBehavior: {                                              // REMOVE
    maxAttempts: 3,                                                    // REMOVE
    initialBackoffMs: 2000,                                            // REMOVE
    base: 2,                                                           // REMOVE
  },                                                                   // REMOVE
});                                                                    // REMOVE

// For bulk screening - separate from extraction to avoid cross-cancellation on cancelAll()
export const screeningPool = new Workpool(components.screeningWorkpool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});
```

**Remove lines 4-14:** The `pdfProcessingPool` constant and its comments. Note: after removing `components.workpool` from `convex.config.ts`, the `components` import still works because `components.screeningWorkpool` is still used by `screeningPool`.

**Update comment on line 16:** Remove "separate from extraction to avoid cross-cancellation" reference. Replace with a simple comment like `// For bulk screening operations`.

---

### `lib/store.ts` (store, Layer 4)

**Remove import** (line 15):
```typescript
  ExtractionSortBy,
```
Remove from the `import type { ... } from './types'` block at lines 3-17.

**Remove interface fields** (lines 86-87 in UIState):
```typescript
  extractionViewMode: ViewMode
  extractionSortBy: ExtractionSortBy
```

**Remove interface methods** (lines 99-100 in UIState):
```typescript
  setExtractionViewMode: (mode: ViewMode) => void
  setExtractionSortBy: (sort: ExtractionSortBy) => void
```

**Remove state defaults** (lines 595-596 in useUIStore):
```typescript
      extractionViewMode: 'list-detail',
      extractionSortBy: 'recent',
```

**Remove action implementations** (lines 614-615 in useUIStore):
```typescript
      setExtractionViewMode: (mode) => set({ extractionViewMode: mode }),
      setExtractionSortBy: (sort) => set({ extractionSortBy: sort }),
```

**Remove persist whitelist entries** (lines 654-655 in useUIStore):
```typescript
        extractionViewMode: state.extractionViewMode,
        extractionSortBy: state.extractionSortBy,
```

**Remove entire ExtractionCitationPanel section** (lines 1194-1234):
Remove the constants, interface, store, and dimension helper:
```typescript
// Extraction citation panel store
const EXTRACTION_CITATION_PANEL_WIDTH_EXPANDED = 460;
const EXTRACTION_CITATION_PANEL_WIDTH_COLLAPSED = 48;

interface ExtractionCitationPanelState { ... }

export const useExtractionCitationPanelStore = create<ExtractionCitationPanelState>()( ... );

export const getExtractionCitationPanelDimensions = (isCollapsed: boolean) => ({ ... });
```

Lines 1194-1234 inclusive. The next retained code is `useTransientScreeningStore` at line 1236.

---

### `lib/types/index.ts` (type-def, Layer 4)

**Current file (61 lines). Remove lines 34, 41-60:**

Remove `ExtractionSortBy` from the search types re-export (line 34):
```typescript
  ExtractionSortBy,    // REMOVE this line from the re-export block
```

Remove entire extraction type block (lines 40-60):
```typescript
// Extraction Types
export type {
  ExtractionQuestionType,
  ExtractionQuestion,
  ExtractionSourceType,
  ExtractionHistorySource,
  ExtractionZoteroItem,
  ExtractionZoteroSelection,
  ExtractionManualItem,
  ExtractionJob,
  ExtractionJobStatus,
  ExtractionPaper,
  ExtractionPaperStatus,
  ExtractionResult,
  ExtractionJobDetails,
  CreateExtractionJobInput,
  ExtractionSavedView,
  ExtractionWorkflowTemplate,
  ExtractionReportSnapshot,
  ExtractionRunDiff,
} from './extraction.types';
```

---

### `lib/types/search.types.ts` (type-def, Layer 4)

**Remove lines 203-205:**
```typescript
/**
 * Sort options for extraction jobs
 */
export type ExtractionSortBy = 'recent' | 'oldest' | 'name' | 'status';
```

---

### `components/app-sidebar.tsx` (component, Layer 4)

**Remove import** (line 46, from lucide-react import block):
```typescript
  Database,
```

**Remove hooks** (lines 374, 376):
```typescript
  const extractionEnabled = useFeatureFlag("extraction.enabled");
  // ...
  const hasExtractionPlan = subscriptionState.resolvedPlan === "pro" || subscriptionState.resolvedPlan === "enterprise";
```

**Remove from getCurrentPage function** (lines 438-439):
```typescript
    if ((extractionEnabled || hasExtractionPlan) && pathname.includes("/extraction"))
      return "extraction";
```

**Remove extraction nav entry** (lines 523-533):
```typescript
          {(extractionEnabled || hasExtractionPlan) && (
            <NavItem
              href="/extraction"
              icon={Database}
              label={tc("extraction")}
              isActive={currentPageValue === "extraction"}
              isCollapsed={isCollapsed && !isMobile}
              onClick={handleNavClick}
              index={4}
            />
          )}
```

After removing this, check whether `useFeatureFlag` import (line 35) is still used elsewhere in the file. If `extraction.enabled` was the only feature flag check, the import can be removed too. Grep for `useFeatureFlag` in the file to decide.

---

### `convex/ai/actions.ts` (backend, Layer 5)

**Remove from import block** (line 8):
```typescript
  getExtractionQuestionsConfig,
```
Remove from the `import { ... } from "../../lib/ai/core/configs"` block at lines 6-12.

**Remove entire action** (lines 61-78):
```typescript
export const generateExtractionQuestions = createAIAction(
  {
    jobName: v.string(),
    sourceContext: v.string(),
    existingQuestions: v.array(v.string()),
    responseLanguage: v.optional(v.string()),
  },
  v.object({
    questions: v.array(v.object({
      question: v.string(),
      type: v.union(v.literal("string"), v.literal("boolean"), v.literal("number"), v.literal("array")),
      description: v.optional(v.string()),
    })),
  }),
  "Generate extraction questions",
  getExtractionQuestionsConfig,
  (output) => ({ questions: output.questions })
);
```

---

### `lib/ai/core/configs.ts` (config, Layer 4)

**Remove from import block** (line 5):
```typescript
  extractionQuestionsSchema,
```

**Remove from import block** (line 11):
```typescript
  buildExtractionQuestionsPrompts,
```

**Remove from import block** (line 20):
```typescript
  GenerateExtractionQuestionsInput,
```

**Remove entire function** (lines 94-118):
```typescript
export function getExtractionQuestionsConfig(
  input: GenerateExtractionQuestionsInput
): OperationConfig<GenerateExtractionQuestionsInput, z.infer<typeof extractionQuestionsSchema>> {
  return {
    schema: extractionQuestionsSchema,
    buildPrompts: (input) => buildExtractionQuestionsPrompts(input),
    input,
    repairStrategy: { type: 'full-json' },
    temperature: 0.7,
    postProcess: (output, input) => {
      const newQuestions = output.questions.filter((newQ) => {
        const normalizedNew = newQ.question.toLowerCase().trim()
        return !input.existingQuestions.some((existingQuestion: string) => {
          const normalizedExisting = existingQuestion.toLowerCase().trim()
          return (
            normalizedExisting === normalizedNew ||
            normalizedExisting.includes(normalizedNew) ||
            normalizedNew.includes(normalizedExisting)
          )
        })
      })
      return { questions: newQuestions }
    },
  }
}
```

---

### `lib/ai/client/executor.ts` (service, Layer 4)

**Remove from import block** (line 11):
```typescript
  getExtractionQuestionsConfig,
```

**Remove from type import block** (line 28):
```typescript
  GenerateExtractionQuestionsInput,
```

**Remove executor export** (lines 133-137):
```typescript
export const generateExtractionQuestions = createClientExecutor(
  getExtractionQuestionsConfig,
  (output) => ({ questions: output.questions }),
  'generate_extraction_questions'
)
```

---

### `lib/ai/core/types.ts` (type-def, Layer 4)

**Remove extraction types** (lines 79-92):
```typescript
export interface GenerateExtractionQuestionsInput {
  jobName: string;
  sourceContext: string;
  existingQuestions: string[];
  responseLanguage?: string;
}

export interface GenerateExtractionQuestionsOutput {
  questions: Array<{
    question: string;
    type: "string" | "boolean" | "number" | "array";
    description?: string;
  }>;
}
```

Also remove the comment on line 94: `// AI types only - extraction removed`.

---

### `lib/ai/core/schemas.ts` (config, Layer 4)

**Remove extraction schema** (lines 52-64):
```typescript
export const extractionQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("The data extraction question"),
        type: z.enum(["string", "boolean", "number", "array"]).describe("Expected answer type"),
        description: z.string().optional().describe("Optional context/instructions for the AI extractor"),
      })
    )
    .min(1)
    .max(10)
    .describe("3-7 data extraction questions with their expected types"),
})
```

---

### `lib/ai/core/prompts.ts` (config, Layer 4)

**Remove from import** (line 1):
```typescript
GenerateExtractionQuestionsInput,
```
Remove from the `import type { ..., GenerateExtractionQuestionsInput, ... }` list.

**Remove entire function** (lines 227-278, end of file):
```typescript
export function buildExtractionQuestionsPrompts(input: GenerateExtractionQuestionsInput) {
  // ... entire function body through end of file
}
```

---

### `convex/maintenance/mutations.ts` (backend, Layer 5)

**Remove extraction cleanup block** (lines 38-54):
```typescript
        // Delete extraction jobs (cascade to papers, results, evidence units, etc.)
        // Uses existing deleteExtractionInternal which handles all 9 child tables
        const extractionJobs = await ctx.db
          .query("extractionJobs")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .take(BATCH_SIZE);
        for (const job of extractionJobs) {
          await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, {
            jobId: job._id,
          });
        }

        // If we found a full batch of extraction jobs, there may be more.
        // Don't delete the user yet -- re-schedule to handle remaining jobs.
        if (extractionJobs.length === BATCH_SIZE) {
          continue; // Skip user delete, process on next run
        }
```

**Keep:** Everything before line 38 (API key cleanup) and everything after line 54 (Zotero connection cleanup). The `internal` import on line 3 stays because it is still used at line 79 for `internal.maintenance.mutations.cleanupDeletedUsers`.

---

### `convex/lib/rateLimit.ts` (backend, Layer 5)

**Remove rate limit definition** (lines 18-23):
```typescript
  "start-extraction": {
    kind: "token bucket",
    rate: 5,
    period: HOUR,
    capacity: 3,
  },
```

**Remove from consume validator** (line 58):
```typescript
      v.literal("start-extraction"),
```

---

### `convex/featureFlags/internal.ts` (backend, Layer 5)

**Remove 7 extraction feature flag seeds** (lines 47-53):
```typescript
      { key: "extraction.enabled", enabled: true, minimumTier: 0, description: "Master switch for the extraction feature" },
      { key: "extraction.pdf", enabled: true, minimumTier: 0, description: "PDF processing in extraction pipelines" },
      { key: "extraction.insights", enabled: true, minimumTier: 20, description: "AI-powered insights panel in extraction results" },
      { key: "extraction.reviewQueue", enabled: false, minimumTier: 20, description: "Manual review queue for extraction results" },
      { key: "extraction.reportBuilder", enabled: false, minimumTier: 20, description: "Report builder for extraction jobs" },
      { key: "extraction.start", enabled: true, minimumTier: 20, description: "Start new extraction jobs (Pro+)" },
      { key: "extraction.templates", enabled: true, minimumTier: 20, description: "Workflow template management (Pro+)" },
```

**Keep:** `credits.enabled`, `credits.topups`, `subscriptions.enabled` seeds and all function definitions.

---

### `convex/lib/constants.ts` (backend, Layer 5)

**Remove extraction comment fragment** (line 3 -- the JSDoc for `FREE_SIGNUP_CREDIT_GRANT`):
```typescript
 * Lets free users experience server-side AI (including extraction) before committing to a plan.
```
Change to: `Lets free users experience server-side AI before committing to a plan.`

**Remove extraction reference from line 14** (JSDoc for `ESTIMATED_CREDITS_PER_PAPER`):
```typescript
 * Estimated credit cost per paper for batch AI operations (screening, translation, extraction).
```
Change to: `Estimated credit cost per paper for batch AI operations (screening, translation).`

No structural code changes needed -- comments only.

---

### `convex/lib/queryBounds.ts` (backend, Layer 5)

**Remove extraction-specific constants** (lines 9-10, 13-14):
```typescript
/** Maximum extraction jobs listed per user.
 * Users accumulate jobs over time; 500 is generous for any reasonable usage. */
export const MAX_EXTRACTION_JOBS_PER_USER = 500;

/** Maximum evidence units loaded per paper.
 * Each extraction run produces evidence; 200 per paper is generous. */
export const MAX_EVIDENCE_UNITS_PER_PAPER = 200;

/** Maximum reviews loaded in a single batch by job.
 * Worst case: 500 papers x 20 questions = 10,000 reviews. */
export const MAX_REVIEWS_PER_JOB = 10_000;
```

Lines 9-19 inclusive. Keep `MAX_LIBRARY_BROWSE`, `MAX_COLLECTION_MEMBERS`, `MAX_CREDIT_TRANSACTIONS`, `MAX_SCREENING_PAPERS_PER_JOB`, `MAX_SCREENING_JOBS_PER_USER`.

**Remove extraction reference from line 30** (comment on `MAX_SCREENING_JOBS_PER_USER`):
```typescript
/** Maximum screening jobs listed per user.
 * Matches extraction job limit for consistency. */
```
Change to: `/** Maximum screening jobs listed per user. */`

---

### `messages/*.json` (i18n, Layer 8)

**Pattern for all 6 locale files** (`en-US.json`, `en-GB.json`, `zh.json`, `fr.json`, `hi.json`, `ja.json`):

Remove these top-level JSON sections entirely:
- `"extraction"` object (~140 keys)
- `"extractionView"` object (~14 keys)

Remove these individual keys scattered across other sections:
- `common.extraction`
- `common.extractionError`
- `toast.extractionPlanRequired`
- `errorPages.extractionUnavailable`
- `errorPages.extractionErrorDescription`
- `jobStatus.extractionProgress`
- `jobStatus.loadingExtractionResults`
- `pricing.proFeature2` (if it says "Data extraction (Pro-only)" -- evaluate per locale)

**Validate JSON after edit:** Use `node --input-type=module -e "import{readFileSync as r}from'node:fs';JSON.parse(r('messages/en-US.json','utf8'))"` for each file. Watch for trailing commas after key removal.

---

### Extraction Test Files to Delete (Layer 9)

Delete `tests/extraction/` directory, then delete these 23 individual test files:

| File |
|------|
| `tests/answer-grouping.test.ts` |
| `tests/card-thresholds.test.ts` |
| `tests/confidence-badge.test.tsx` |
| `tests/confidence-messages.test.ts` |
| `tests/export-answer-formatters.test.ts` |
| `tests/export-citations.test.ts` |
| `tests/export-extraction-options.test.ts` |
| `tests/extraction-citation-panel.test.ts` |
| `tests/extraction-feature-flags.test.ts` |
| `tests/extraction-filtering.test.ts` |
| `tests/extraction-i18n-coverage.test.ts` |
| `tests/extraction-insights-overview.test.tsx` |
| `tests/extraction-insights-question-panel.test.tsx` |
| `tests/extraction-insights.test.ts` |
| `tests/extraction-v3-evidence.test.ts` |
| `tests/extraction-v3-integration.test.ts` |
| `tests/extraction-v3-prompts.test.ts` |
| `tests/highlight-text.test.ts` |
| `tests/question-list-item.test.tsx` |
| `tests/question-status.test.ts` |
| `tests/stacked-answer-bars.test.tsx` |
| `tests/summary-cards.test.tsx` |
| `tests/components/grouped-answer-row.test.tsx` |

---

## Shared Patterns (Cross-Cutting)

### Verification After Each Layer

**Apply to:** Every layer boundary (D-02 requires clean compile between layers).

After each deletion layer completes, run:
```bash
npx tsc --noEmit
```
If errors appear, they are dangling references from the just-completed deletion that need surgical fixes in the current layer before proceeding.

### JSON Validation for i18n

**Apply to:** All 6 locale files after Layer 8 edits.
```bash
for f in messages/en-US.json messages/en-GB.json messages/zh.json messages/fr.json messages/hi.json messages/ja.json; do
  node --input-type=module -e "import{readFileSync as r}from'node:fs';JSON.parse(r('$f','utf8'))" && echo "$f OK" || echo "$f BROKEN"
done
```

### Package Cleanup (Layer 7)

After removing `@convex-dev/rag` and `pdfjs-dist` from `package.json`:
```bash
pnpm install
```
This regenerates the lockfile and cleans `node_modules`.

### Convex Codegen (After Layer 6)

After schema table deletion, regenerate Convex types:
```bash
npx convex codegen
```
This updates `convex/_generated/api.d.ts` to remove stale `api.extraction.*` references.

---

## Files With No Extraction References (Confirmed Clean)

These shared files were checked and contain **zero** extraction references:

| File | Verified |
|------|----------|
| `convex/crons.ts` | No extraction cron jobs |
| `convex/http.ts` | No extraction HTTP routes |
| `lib/ai/core/index.ts` | No extraction exports |

---

## No Analog Found

Not applicable. This phase creates no new files, so no analogs are needed. All work is deletion and surgical editing of existing files.

---

## Metadata

**Analog search scope:** Entire codebase (all files containing "extraction" references)
**Files scanned:** 48 files classified for deletion/modification
**Pattern extraction date:** 2026-04-14
**Verification method:** Every shared file was read in full; extraction references identified by line number via grep and direct reading
