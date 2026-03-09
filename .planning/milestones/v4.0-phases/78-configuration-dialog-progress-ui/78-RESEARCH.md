# Phase 78: Configuration Dialog & Progress UI - Research

**Researched:** 2026-03-09
**Domain:** React UI (Dialog, Forms, Real-time Progress), Convex Reactive Queries
**Confidence:** HIGH

## Summary

Phase 78 is a pure frontend phase that wires existing backend infrastructure (Phase 75-77) to user-facing UI. All Convex mutations, queries, scoring engine, and workflow processing are already built. The work is: (1) a multi-section configuration dialog triggered from the results page, (2) real-time progress tracking using existing reactive queries, and (3) a job history list.

The project already has established patterns for dialogs (Radix UI Dialog via shadcn/ui), dismiss guards (upgrade-confirmation-dialog.tsx), collection picking (collection-picker.tsx), reactive Convex queries (useProtectedQuery + useQuery), and screening question display (screening-expansion.tsx). This phase composes these existing patterns into new components.

**Primary recommendation:** Build the configuration dialog as a multi-step form using existing Dialog/DialogContent components with dismiss guards copied from UpgradeConfirmationDialog. Use `useSearch()` to access current results for paper count, `useProtectedQuery(api.credits.queries.checkBalance)` for credit estimation, and `useQuery(api.screening.queries.getScreeningProgress)` for reactive progress.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| radix-ui (Dialog) | latest | Dialog primitive | Already used project-wide via components/ui/dialog.tsx |
| convex/react | latest | useQuery, useMutation hooks | Project standard for reactive data |
| next-intl | latest | i18n translations | All UI text goes through useTranslations() |
| lucide-react | latest | Icons | Project standard icon library |
| motion/react | latest | Animations | Already used in screening-expansion.tsx |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sonner (toast) | latest | Success/error notifications | After job submission, errors |
| posthog-js | latest | Analytics events | Track dialog opens, job submissions |
| @/components/ui/progress | -- | Progress bar | Job progress visualization |
| @/components/ui/badge | -- | Status badges | Job history status display |
| @/components/ui/select | -- | Collection dropdown | Collection picker in dialog |
| @/components/ui/input | -- | Number inputs | Scoring rule point values |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Multi-section single dialog | Multi-step wizard | Single dialog is simpler, all config visible at once, matches project pattern |
| Custom progress component | Existing Progress primitive | Radix Progress already exists in project, use it |

**Installation:**
No new dependencies needed. Everything is already installed.

## Architecture Patterns

### Recommended Project Structure
```
components/
  screening/
    screening-dialog.tsx          # Main config dialog (DIALOG-01 through DIALOG-07)
    scoring-rules-editor.tsx      # Per-question scoring rules (DIALOG-03)
    star-threshold-editor.tsx     # Score-to-stars mapping (DIALOG-04)
    collection-selector.tsx       # Collection picker + inline create (DIALOG-05)
    screening-progress.tsx        # Real-time progress card (JOB-06)
    screening-job-history.tsx     # Past jobs list (JOB-08)
```

### Pattern 1: Dismiss Guards (from upgrade-confirmation-dialog.tsx)
**What:** Prevent dialog dismissal during async operations
**When to use:** During job submission (DIALOG-07)
**Example:**
```typescript
// Source: components/billing/upgrade-confirmation-dialog.tsx lines 66-76
<DialogContent
  onEscapeKeyDown={(e) => {
    if (isSubmitting) e.preventDefault();
  }}
  onPointerDownOutside={(e) => {
    if (isSubmitting) e.preventDefault();
  }}
  onInteractOutside={(e) => {
    if (isSubmitting) e.preventDefault();
  }}
  showCloseButton={!isSubmitting}
>
```

### Pattern 2: Reactive Progress via Convex Query
**What:** Real-time job progress using existing getScreeningProgress query
**When to use:** After job submission, progress tracking (JOB-06)
**Example:**
```typescript
// Source: convex/screening/queries.ts - getScreeningProgress
// Returns: { status, totalPapers, processedPapers, failedPapers, qualifiedPapers, percentComplete }
const progress = useQuery(api.screening.queries.getScreeningProgress,
  jobId ? { jobId } : "skip"
);
// Convex reactive queries auto-update when processedPapers changes in DB
```

### Pattern 3: Screening Questions from Zustand Store
**What:** Read screening questions from the search history store (same source as screening panel)
**When to use:** Populating dialog with current questions (DIALOG-02)
**Example:**
```typescript
// Source: components/search-command-center/screening-expansion.tsx lines 41-57
const { getSearchResult } = useSearchHistoryStore();
const searchResult = getSearchResult(searchId);
const screeningQuestions = searchResult?.screeningQuestions || [];
// Each question: { question: string } (ScreeningQuestionEntry)
```

### Pattern 4: Search Results Access via useSearch()
**What:** Get current search results and total count from URL-based search context
**When to use:** Paper count display and paper data for job submission (JOB-02)
**Example:**
```typescript
// Source: lib/search/types.ts - SearchContextValue
const { results, totalCount } = useSearch();
const paperCount = Math.min(results.length, 200); // Cap at MAX_SCREENING_PAPERS_PER_JOB
```

### Pattern 5: Credit Balance Check
**What:** Check if user has enough credits before confirming
**When to use:** Cost estimate display and submit validation (JOB-03)
**Example:**
```typescript
// Source: convex/credits/queries.ts - checkBalance
const balanceCheck = useProtectedQuery(api.credits.queries.checkBalance, {
  requiredAmount: paperCount,
});
// Returns: { hasEnough, free, paid, total, required, deficit }
```

### Pattern 6: Collection Listing + Inline Creation
**What:** List user's collections and allow creating new ones
**When to use:** Collection picker in dialog (DIALOG-05)
**Example:**
```typescript
// Source: convex/library/collections.ts
const { data: collections } = useProtectedQuery(
  api.library.collections.getCollectionsWithCounts, {}
);
const createCollection = useMutation(api.library.collections.createCollection);
// createCollection({ name: "New Collection" }) returns Id<"collections">
```

### Anti-Patterns to Avoid
- **Building custom scoring state management:** The scoring config is a simple object passed to createScreeningJob. Build it in local React state, don't add it to Zustand.
- **Polling for progress:** Convex queries are reactive. useQuery automatically re-renders when the underlying data changes. Never setTimeout/setInterval.
- **Putting dialog state in global store:** Dialog open/close is local component state. Only the jobId (after submission) might need to be lifted.
- **Building a new collection picker dialog:** Reuse the collection listing query, but build a simpler inline selector (Select/dropdown + "create new" input), not a full dialog-in-dialog.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dialog dismiss prevention | Custom overlay/portal | Radix Dialog event handlers (onEscapeKeyDown, onPointerDownOutside, onInteractOutside) | Exact pattern in upgrade-confirmation-dialog.tsx |
| Progress bar animation | Custom CSS animation | `<Progress value={percentComplete} />` from components/ui/progress.tsx | Already exists, Radix-based |
| Collection list | Custom query | `api.library.collections.getCollectionsWithCounts` | Already built, sorted alphabetically |
| Credit cost calculation | Custom credit logic | `api.credits.queries.checkBalance` with requiredAmount | Already handles free+paid balance |
| Scoring validation | Custom validator | `validateScoringConfig()` from convex/screening/scoring.ts | Already handles gaps, overlaps, range checks |
| i18n string management | Hardcoded strings | `useTranslations()` with keys in messages/en-US.json | Project convention, all UI text is translated |

**Key insight:** Phase 78 is almost entirely composition. Every backend function and most UI primitives already exist. The work is wiring them together in new components.

## Common Pitfalls

### Pitfall 1: Forgetting to Map Question Format
**What goes wrong:** The screening panel uses `ScreeningQuestionEntry` (just `{ question: string }`) while createScreeningJob expects `{ key: string, question: string }`.
**Why it happens:** Two different shapes for the same concept across client/server boundaries.
**How to avoid:** Generate `key` from question text when building the job payload. The existing pattern uses a question-key-codec (see `lib/ai/core/question-key-codec`).
**Warning signs:** Job creation fails with validation error about missing `key` field.

### Pitfall 2: Not Capping Results at 200
**What goes wrong:** Search may return thousands of results (totalCount can be 50,000+), but only the first page is loaded client-side. MAX_SCREENING_PAPERS_PER_JOB is 200.
**Why it happens:** `results` from useSearch() only contains the current page (~25 papers). totalCount shows the full search count.
**How to avoid:** The dialog needs to show totalCount but explain that only up to 200 will be screened. The createScreeningJob mutation already enforces the 200 cap server-side. The client must fetch/pass up to 200 papers, which may require fetching more than the current page.
**Warning signs:** User expects 5000 papers screened but only 25 (one page) are sent.

### Pitfall 3: Default Scoring Config UX
**What goes wrong:** Users don't know what point values to assign. The scoring UX is novel (noted in STATE.md blockers).
**Why it happens:** No competitor does per-question point weighting.
**How to avoid:** Provide sensible defaults: yes=+1, no=0, null=0 per question. Default star thresholds covering the question count range. Show a preview/summary of what the scoring produces.
**Warning signs:** Users submit with all-zero rules, getting meaningless scores.

### Pitfall 4: Active Job Guard
**What goes wrong:** User tries to start a second screening job while one is running.
**Why it happens:** createScreeningJob throws SCREENING_JOB_ALREADY_ACTIVE for pending/processing jobs.
**How to avoid:** Check for active jobs before showing the dialog or disable the submit button. Could use getScreeningProgress or a dedicated query.
**Warning signs:** Cryptic error toast when user clicks "Screen All" with a running job.

### Pitfall 5: Missing Search Context
**What goes wrong:** "Screen All" button crashes if rendered outside SearchProvider.
**Why it happens:** useSearch() throws if no provider. The button is on the results page which does have it, but edge cases exist.
**How to avoid:** Use useSearchOptional() for the button, or ensure it's only rendered within SearchProvider.
**Warning signs:** Runtime error: "useSearch must be used within SearchProvider".

## Code Examples

### Creating a Screening Job (mutation call from UI)
```typescript
// Source: convex/screening/mutations.ts - createScreeningJob
const createJob = useMutation(api.screening.mutations.createScreeningJob);

const handleSubmit = async () => {
  setIsSubmitting(true);
  try {
    const { jobId } = await createJob({
      papers: papers.map(p => ({
        openalexId: p.id,
        title: p.title ?? p.display_name,
        abstract: p.abstract_inverted_index ? undefined : undefined, // needs reconstruction
        authors: p.authorships?.map(a => a.author.display_name),
        publicationYear: p.publication_year,
        doi: p.doi,
      })),
      questions: screeningQuestions.map((q, i) => ({
        key: `q${i}`,
        question: q.question,
      })),
      scoringConfig: {
        rules: scoringRules,
        starThresholds: starThresholds,
        minimumScore: minimumScore,
      },
      targetCollectionId: selectedCollectionId,
    });
    setActiveJobId(jobId);
    toast.success("Screening job started");
  } catch (err) {
    toast.error(getErrorMessage(err));
  } finally {
    setIsSubmitting(false);
  }
};
```

### Default Scoring Config Generator
```typescript
// Generate sensible defaults from screening questions
function getDefaultScoringConfig(questions: { key: string; question: string }[]) {
  return {
    rules: questions.map(q => ({
      questionKey: q.key,
      yesPoints: 1,
      noPoints: 0,
      nullPoints: 0,
    })),
    starThresholds: [
      { minScore: 0, maxScore: 0, stars: 1 },
      { minScore: 1, maxScore: Math.floor(questions.length * 0.25), stars: 2 },
      { minScore: Math.floor(questions.length * 0.25) + 1, maxScore: Math.floor(questions.length * 0.5), stars: 3 },
      { minScore: Math.floor(questions.length * 0.5) + 1, maxScore: Math.floor(questions.length * 0.75), stars: 4 },
      { minScore: Math.floor(questions.length * 0.75) + 1, maxScore: questions.length, stars: 5 },
    ],
  };
}
```

### Job History List Query (needs creation)
```typescript
// New query needed in convex/screening/queries.ts
export const listUserScreeningJobs = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({
    _id: v.id("screeningJobs"),
    _creationTime: v.number(),
    status: screeningJobStatusValidator,
    totalPapers: v.number(),
    processedPapers: v.number(),
    qualifiedPapers: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("screeningJobs")
      .withIndex("by_user", q => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom dialog primitives | Radix UI Dialog (shadcn/ui) | Project inception | Use DialogContent with showCloseButton prop |
| REST polling for progress | Convex reactive queries | Project inception | Zero polling code needed, auto-updates |
| Redux/context for forms | Local React state + Zustand | v2.0+ | Dialog form state stays local |

**Deprecated/outdated:**
- None relevant. The project's UI stack is current.

## Open Questions

1. **Paper fetching beyond current page**
   - What we know: useSearch() returns only the current page (~25 papers). The OpenAlex API supports per_page up to 200.
   - What's unclear: Should the dialog trigger a separate fetch for up to 200 papers, or should the "Screen All" always use only the first 200 from a dedicated API call?
   - Recommendation: Make a dedicated fetch for the screening dialog that requests up to 200 results using the same query/filters. The search module's `apiUrl` can be adapted with `per_page=200&page=1`.

2. **Abstract reconstruction from inverted index**
   - What we know: OpenAlex returns `abstract_inverted_index` not plain text. Papers passed to createScreeningJob need `abstract` as optional string.
   - What's unclear: Does the project already have a utility to reconstruct abstract text?
   - Recommendation: Check for existing abstract reconstruction utility. If none exists, build a simple one (it's a common OpenAlex pattern).

3. **Where to place the "Screen All" button**
   - What we know: It goes on the results page per DIALOG-01.
   - What's unclear: Exact placement -- in the SearchCommandFooter alongside results count? As a separate action bar?
   - Recommendation: Place in SearchCommandFooter area, visible when screening questions exist (screeningQuestionCount > 0).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run convex/screening/` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIALOG-01 | Screen All button opens dialog | manual-only | N/A - UI interaction | N/A |
| DIALOG-02 | Dialog displays screening questions | manual-only | N/A - UI rendering | N/A |
| DIALOG-03 | Scoring rules editor | manual-only | N/A - UI interaction | N/A |
| DIALOG-04 | Star threshold editor | manual-only | N/A - UI interaction | N/A |
| DIALOG-05 | Collection picker with inline create | manual-only | N/A - UI interaction | N/A |
| DIALOG-06 | Paper count + credit cost display | manual-only | N/A - UI rendering | N/A |
| DIALOG-07 | Dismiss guards during submission | manual-only | N/A - UI interaction | N/A |
| JOB-02 | Paper count capped at 200 with messaging | unit | `npx vitest run tests/ -t "paper count"` | No - Wave 0 |
| JOB-03 | Credit cost estimate display | unit | `npx vitest run tests/ -t "credit cost"` | No - Wave 0 |
| JOB-06 | Real-time progress display | manual-only | N/A - requires running Convex | N/A |
| JOB-08 | Job history list | unit | `npx vitest run convex/screening/queries.test.ts` | Partial (existing file, new query) |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/screening/`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `convex/screening/queries.ts` -- add `listUserScreeningJobs` query (covers JOB-08)
- [ ] `convex/screening/queries.test.ts` -- add test for `listUserScreeningJobs`
- [ ] Most requirements are UI-only (DIALOG-01 through DIALOG-07, JOB-06) and require manual verification

## Sources

### Primary (HIGH confidence)
- Project codebase: convex/screening/mutations.ts, queries.ts, scoring.ts, validators.ts -- complete backend API
- Project codebase: components/billing/upgrade-confirmation-dialog.tsx -- dismiss guard pattern
- Project codebase: components/library/collection-picker.tsx -- collection listing pattern
- Project codebase: components/search-command-center/screening-expansion.tsx -- screening questions source
- Project codebase: components/ui/dialog.tsx -- Dialog component with showCloseButton prop
- Project codebase: components/ui/progress.tsx -- Progress bar component
- Project codebase: convex/credits/queries.ts -- checkBalance query
- Project codebase: lib/search/types.ts -- SearchContextValue with results and totalCount

### Secondary (MEDIUM confidence)
- convex/schema.ts screeningJobs indexes -- by_user index exists for job history listing

### Tertiary (LOW confidence)
- Paper fetching strategy for 200-paper cap -- needs implementation decision

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DIALOG-01 | "Screen All" button opens config dialog | useSearch() for results access, Dialog component exists |
| DIALOG-02 | Dialog displays screening questions | useSearchHistoryStore().getSearchResult(searchId).screeningQuestions |
| DIALOG-03 | Scoring rules editor (per-question points) | ScoringRule type from scoring.ts, validated by screeningScoringConfigValidator |
| DIALOG-04 | Star threshold editor (score ranges to stars) | StarThreshold type from scoring.ts, validateScoringConfig() for warnings |
| DIALOG-05 | Collection picker + inline create | getCollectionsWithCounts query + createCollection mutation both exist |
| DIALOG-06 | Paper count, credit cost, confirm/cancel | checkBalance query for credits, MAX_SCREENING_PAPERS_PER_JOB=200 constant |
| DIALOG-07 | Dismiss guards during submission | Exact pattern in upgrade-confirmation-dialog.tsx (onEscapeKeyDown etc.) |
| JOB-02 | Paper count capped at 200 with messaging | MAX_SCREENING_PAPERS_PER_JOB=200 in convex/lib/queryBounds.ts |
| JOB-03 | Credit cost estimate before confirming | checkBalance query returns hasEnough, deficit; 1 credit = 1 paper |
| JOB-06 | Real-time progress (X/N screened) | getScreeningProgress query returns reactive percentComplete, processedPapers |
| JOB-08 | Past job list with status/count/date | by_user index on screeningJobs exists; need new listUserScreeningJobs query |
</phase_requirements>

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in project, no new dependencies
- Architecture: HIGH - patterns directly from existing codebase (upgrade dialog, collection picker)
- Pitfalls: HIGH - identified from actual code shapes and type mismatches
- Paper fetching: MEDIUM - strategy for getting 200 papers needs implementation decision

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable - pure frontend, no external API changes)
