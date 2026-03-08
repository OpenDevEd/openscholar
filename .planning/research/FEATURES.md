# Feature Landscape

**Domain:** Bulk paper screening with scoring rules, auto-rating, and collection assignment for academic search platform
**Researched:** 2026-03-08
**Milestone:** v4.0 Bulk Screening & Auto-Rating

## Table Stakes

Features users expect when a "Screen All" button exists. Missing = feature feels broken or incomplete.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| Bulk screening job creation | Users click "Screen All" and expect all results (not just current page of 20) to be processed | Med | Convex workpool, existing screening AI pipeline | Reuse existing `processScreeningBatch` and `createScreeningResponsesSchema` from `lib/ai/core` |
| Background processing with progress | Users expect to navigate away and come back; no one waits for 200 papers | Med | Convex workflow + workpool (already used by extraction) | Follow existing extraction job pattern: `pending -> processing -> completed/failed` |
| Paper count and credit cost estimate | Users need to know what they're committing before starting | Low | `credits` table, existing `calculateCreditsToDeduct` helpers | Show "~X credits for Y papers" in confirmation dialog; estimate from avg cost per screening call |
| Job progress tracking | Real-time progress bar showing N/200 papers screened | Low | Convex reactive queries (already proven in extraction) | Reuse extraction's `processedPapers/totalPapers` pattern |
| Cancel in-progress job | Users must be able to stop a bulk job that's burning credits | Low | Existing `cancelExtraction` pattern with credit-guard | Copy extraction's cancel pattern: set status to `cancelled`, workpool credit-guard skips remaining |
| Per-paper screening results persistence | Results must survive page refresh -- cannot live only in Zustand | Med | New Convex table or extension of existing screening responses | Current screening uses client-side Zustand (`ScreeningResponses`); bulk results MUST be server-side |
| Error handling per paper | Some papers will fail (no abstract, AI error); must not block the batch | Low | Workpool's per-item error handling | Extraction already handles this: `failedPapers` counter, per-paper `errorMessage` |

## Differentiators

Features that set the bulk screening apart from competitors like Rayyan (simple include/exclude) or Covidence (manual screening). Not expected, but valued.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| User-defined scoring rules | Users assign point values to each screening question answer (e.g., "Is RCT? yes=+3, no=-1"). This is the core differentiator vs. binary include/exclude tools | Med | Screening questions already exist in `ScreeningQuestionEntry` | Each question gets: `yesPoints: number, noPoints: number, unclearPoints: number`. Default: yes=+1, no=0, unclear=0 |
| Score-to-rating mapping | Users define thresholds that map cumulative scores to 0-5 star ratings (e.g., "0-2 = 1 star, 3-5 = 3 stars, 6+ = 5 stars") | Low | `libraryItems.rating` field (0-5), scoring rules above | Simple threshold array: `[{minScore: number, rating: number}]` sorted ascending. Last matching threshold wins |
| Auto-save to library with rating | Papers automatically saved to library with computed star rating after screening | Med | `libraryItems` table, `libraryItemCount` denormalized counter | Upsert pattern: if paper already in library, update rating; if new, insert with slim 10-field metadata |
| Auto-assign to collection | Users select a target collection; screened papers auto-added to it | Low | `collections` + `libraryItemCollections` junction table (existing) | Create junction row if not exists; respect existing `itemCount` denormalization |
| Configuration dialog with preview | Modal showing question weights, score thresholds, collection picker, and estimated cost before committing | Med | Shadcn Dialog, existing collection queries | Single dialog triggered from "Screen All" button. Preview section shows sample score calculation |
| Minimum score threshold for library | Only papers scoring above a user-defined minimum get saved to library | Low | Scoring rules above | Avoids cluttering library with low-relevance papers. Default: save all (threshold = 0) |
| Scoring rule presets / templates | Save and reuse scoring configurations across searches | Low | New `screeningRuleTemplates` table or localStorage | Defer to v4.1; start with per-search inline config |

## Anti-Features

Features to explicitly NOT build. These would add complexity without proportional value, or conflict with existing architecture.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Active learning / priority ordering | Requires continuous model retraining loop (ASReview pattern); massive complexity for marginal gain on 200-paper batches | Process all papers equally. Active learning matters for 10,000+ paper sets, not 200 |
| Multi-reviewer consensus workflow | Covidence/Rayyan territory; requires permission models, conflict resolution UI, inter-rater reliability stats | Single-user screening. Platform is personal, not team-based (collaborative features explicitly out of scope) |
| Full-text PDF screening in bulk | Current screening uses title+abstract only. Adding PDF processing to bulk would multiply cost by 10x and require RAG pipeline per paper | Title+abstract screening only for bulk. PDF-based extraction is a separate feature (already exists) |
| Machine learning confidence scores | Rayyan-style "predicted relevance" requires training on user's include/exclude decisions | Use AI screening confidence from existing `createScreeningResponsesSchema` (0-1 confidence field) instead |
| Nested/weighted scoring formulas | Complex boolean logic (IF question1=yes AND question2=yes THEN bonus points) | Simple additive scoring: sum all question points. Users can approximate complex rules by adjusting point values |
| Automatic re-screening on question edit | If user edits a question after bulk screening, do not re-screen all papers automatically | Show a warning that results are stale; user can re-run manually. Prevents surprise credit burns |
| Real-time streaming of individual results | SSE/WebSocket for each paper as it completes | Convex reactive queries already provide near-real-time updates. Poll via `useQuery` on job progress, proven pattern from extraction |
| Screening across multiple searches | Screening job spans papers from different search queries | One bulk screening job = one search context. Users can screen different searches separately |

## Feature Dependencies

```
Screening Questions (EXISTING) --> Scoring Rules (new: points per answer)
                                      |
                                      v
Scoring Rules --> Score Computation (sum points per paper)
                      |
                      v
Score Computation --> Score-to-Rating Mapping (threshold -> 0-5 stars)
                      |
                      v
Score-to-Rating --> Auto-Save to Library (upsert libraryItem with rating)
                      |
                      v
Auto-Save to Library --> Auto-Assign to Collection (junction row insert)

--- Parallel dependency ---

Bulk Screening Job Table (new) --> Job Progress Tracking (reactive query)
                                     |
Bulk Screening Job Table --> Credit Cost Estimation (pre-check)
                                     |
Bulk Screening Job Table --> Cancel Job (credit-guard pattern)
```

**Critical path:** Scoring Rules -> Score Computation -> Rating Mapping -> Library Save -> Collection Assignment. This is the core value pipeline and must be built in order.

**Parallel work:** The bulk job infrastructure (Convex table, progress queries, cancel mutation) can be built independently from the scoring/rating pipeline and connected at integration time.

## Existing Infrastructure to Reuse

| Existing Component | How It Maps to New Feature |
|--------------------|---------------------------|
| `processScreeningBatch` (lib/ai/core) | Core AI call for screening; reuse for bulk with server-side orchestration |
| `createScreeningResponsesSchema` (lib/ai/core/schemas.ts) | Zod schema for AI screening output; already handles yes/no/null per question with confidence |
| Extraction workflow + workpool pattern | Job lifecycle, progress tracking, cancel, credit-guard -- exact same pattern for bulk screening |
| `libraryItems` table + mutations | Upsert paper with rating; existing `saveToLibrary` mutation pattern |
| `libraryItemCollections` junction table | Auto-assign to collection; existing `addToCollection` mutation |
| `collections` table with `itemCount` | Denormalized count maintenance on auto-add |
| `users.libraryItemCount` | Denormalized counter increment on auto-save |
| `credits` table + `deductCredits` | Credit pre-check and per-paper deduction |
| `ScreeningQuestionEntry` type | Already stores questions in Zustand search history; extend with scoring metadata |
| `ScreeningExpansion` component | Current UI for managing screening questions; add scoring rule config alongside |
| `ITEMS_PER_PAGE = 20` constant | Current per-page limit; bulk extends to up to 200 (10 pages) |
| `SearchResult` type in Zustand | Stores `screeningQuestions` and `screeningResponses`; bulk config stored server-side |

## MVP Recommendation

**Phase 1 -- Core bulk screening pipeline (table stakes):**
1. Bulk screening job Convex table (mirrors extraction job schema pattern)
2. Bulk screening paper results table (server-side, per-paper per-question responses)
3. Background screening via workpool with credit-guard
4. Job progress tracking with reactive query
5. Configuration dialog with paper count, credit estimate, and start/cancel

**Phase 2 -- Scoring and auto-rating (differentiators):**
1. Scoring rules on screening questions (yes/no/unclear point values)
2. Score computation after each paper's screening completes
3. Score-to-rating threshold mapping configuration
4. Auto-save to library with computed rating (upsert)
5. Auto-assign to selected collection (junction row insert)

**Phase 3 -- Polish:**
1. Minimum score threshold to filter library saves
2. Job history view (list of past bulk screening jobs)
3. Re-run screening for updated questions

**Defer to v4.1+:**
- Scoring rule templates (save/load reusable configs)
- Bulk screening from library page (screen existing library items)
- Export bulk screening results to CSV

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Table stakes features | HIGH | Directly mirrors existing extraction job pattern; all infrastructure exists in codebase |
| Scoring rules UX | MEDIUM | No direct competitor implements user-defined point-per-answer scoring; novel UX that needs user testing |
| Score-to-rating mapping | HIGH | Simple threshold logic; well-understood pattern (grading rubrics) |
| Auto-collection assignment | HIGH | Existing junction table and mutations; trivial extension |
| Credit cost estimation | MEDIUM | Per-paper screening cost varies by model and question count; estimate will be approximate |
| 200-paper limit | HIGH | Convex workpool handles this scale well; extraction already processes up to 500 papers per job |

## Sources

- [Rayyan AI-Powered Systematic Review](https://www.rayyan.ai/) -- Competitor analysis: five-star similarity scoring, bulk actions, include/exclude workflow
- [Elicit Systematic Review](https://elicit.com/solutions/literature-review) -- Per-criteria screening transparency, up to 500 papers, screening criteria auto-generation
- [Convex Workpool component](https://www.convex.dev/components/workpool) -- Background job infrastructure with parallelism control and batch enqueue
- [Convex Workflow component](https://www.convex.dev/components/workflow) -- Durable execution for multi-step jobs
- [ASReview vs Rayyan performance comparison](https://psycharchives.org/en/item/cb2c6618-0acf-4a5a-976d-23f1d54ecd8e) -- Active learning trade-offs at scale
- [AI Tools for Systematic Review 2026](https://paperguide.ai/blog/ai-tools-for-systematic-review/) -- Current landscape overview
- Existing codebase: `convex/extraction/workpoolActions.ts`, `lib/ai/core/schemas.ts`, `convex/schema.ts`, `components/search-command-center/screening-expansion.tsx`, `hooks/use-batch-screening.ts`
