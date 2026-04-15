---
phase: 92-deterministic-citation-grounding
plan: 02
subsystem: extraction-ui
tags: [evidence-quote, confidence-badge, critic-verdict, i18n, accessibility]
dependency_graph:
  requires: [92-01-getPaperBodyText-query, 92-01-criticVerdict-field]
  provides: [evidence-quote-component, insufficient-evidence-card, confidence-badge, critic-verdict-badge, extraction-i18n-namespace]
  affects: [components/extraction/, messages/]
tech_stack:
  added: []
  patterns: [bodyText-slice-rendering, oklch-semantic-badges, three-state-query-loading, tooltip-verdict-reason]
key_files:
  created:
    - components/extraction/evidence-quote.tsx
    - components/extraction/insufficient-evidence-card.tsx
    - components/extraction/confidence-badge.tsx
    - components/extraction/critic-verdict-badge.tsx
  modified:
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json
    - convex/_generated/api.d.ts
decisions:
  - EvidenceQuote renders bodyText.slice() exclusively -- never LLM evidenceQuote field (EXTR-04, D-14)
  - OKLCH semantic colors for confidence badges with dark mode lightness/opacity adjustment
  - ai-surface utility class for supported critic verdict (violet AI accent)
  - Tooltip with 300ms delay on CriticVerdictBadge for reason text
  - Updated api.d.ts to include extraction module types (Rule 3 fix for worktree type resolution)
metrics:
  duration_seconds: 280
  completed: "2026-04-15T04:58:29Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 7
---

# Phase 92 Plan 02: Deterministic Citation Grounding - UI Components Summary

Four extraction UI components (EvidenceQuote, InsufficientEvidenceCard, ConfidenceBadge, CriticVerdictBadge) with OKLCH semantic coloring, dark mode, accessibility, and extraction i18n namespace across 6 locales.

## What Was Done

### Task 1: EvidenceQuote + InsufficientEvidenceCard with i18n

- Created `components/extraction/evidence-quote.tsx` -- renders verbatim `bodyText.slice(startChar, endChar)` via `useQuery(api.extraction.queries.getPaperBodyText)`, NEVER the LLM evidenceQuote field
- Three-state rendering: loading skeleton (3 pulsing lines), error ("Evidence unavailable" with AlertCircle), rendered quote with left border accent
- Clickable quote block with `role="link"`, `tabIndex={0}`, `aria-label`, `motion-safe:transition-colors`, `focus-visible:ring-[3px]`
- Background uses `var(--pdf-highlight)` CSS variable (auto-adapts to dark mode)
- Out-of-bounds and empty range guards return null or error state
- Created `components/extraction/insufficient-evidence-card.tsx` -- muted card (`opacity-75 border-dashed`) with Info icon and Badge variant="secondary"
- `role="status"` and `aria-live="polite"` for accessibility
- Reasoning text rendered verbatim from extraction result
- Added `extraction` i18n namespace to all 6 locale files (en-US, en-GB, fr, hi, ja, zh) with 10 keys each: insufficientEvidence, evidenceUnavailable, confidenceHigh/Medium/Low, criticVerified/Unverified/Partial/Timeout, viewInSource
- Hindi, Japanese, and Chinese use proper native script characters (Devanagari, Kanji/Kana, Hanzi)

### Task 2: ConfidenceBadge + CriticVerdictBadge

- Created `components/extraction/confidence-badge.tsx` -- renders high/medium/low with semantic OKLCH colors
  - High: green (oklch 145 hue), Medium: amber (oklch 85 hue), Low: neutral muted
  - Lucide icons: CheckCircle2 (high), AlertCircle (medium), MinusCircle (low) at 12px
  - Dark mode via OKLCH lightness increase / opacity reduction
  - `rounded-full text-xs font-semibold` pill shape, Badge variant="outline"
  - `aria-hidden="true"` on icons (text label carries meaning)
- Created `components/extraction/critic-verdict-badge.tsx` -- renders critic verdict with AI accent
  - Supported: `ai-surface` utility class (violet AI accent)
  - Unsupported: red semantic (oklch 27 hue), Partial: amber (oklch 85 hue), Timeout: neutral muted
  - Returns null when verdict is null/undefined
  - Tooltip with `delayDuration={300}` wraps badge when reason text available
  - `rounded-full text-xs font-semibold` matching ConfidenceBadge styling

## Commits

| Task | Type | Hash | Description |
|------|------|------|-------------|
| 1 | feat | 8ef1508 | EvidenceQuote + InsufficientEvidenceCard + i18n namespace in 6 locales |
| 2 | feat | 8a45158 | ConfidenceBadge + CriticVerdictBadge with OKLCH semantic colors |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated api.d.ts to include extraction module types**
- **Found during:** Task 1
- **Issue:** The `convex/_generated/api.d.ts` in this worktree did not include extraction module imports (added by Plan 01 in a separate worktree). EvidenceQuote's `useQuery(api.extraction.queries.getPaperBodyText)` could not resolve.
- **Fix:** Added extraction module imports and fullApi entries to api.d.ts (7 modules: extract, mutations, parse, queries, validators, workflow, workpoolActions)
- **Files modified:** `convex/_generated/api.d.ts`
- **Commit:** 8ef1508

## Known Stubs

None. All components are fully wired to their data sources:
- EvidenceQuote fetches via `useQuery(api.extraction.queries.getPaperBodyText)`
- InsufficientEvidenceCard receives data via props (questionText, reasoning)
- ConfidenceBadge and CriticVerdictBadge receive data via props (confidence, verdict/reason)

## Threat Surface

No new threat flags. Components render server-provided data as plain text (React auto-escapes). No `dangerouslySetInnerHTML`, no user-supplied HTML, no new network endpoints.

- T-92-06 mitigated: EvidenceQuote shows "Evidence unavailable" on null/error, never raw error details
- T-92-07 mitigated: `bodyText.slice()` rendered as plain text via React JSX (auto-escaped)

## Self-Check: PASSED

- [x] `components/extraction/evidence-quote.tsx` exists and contains bodyText.slice, getPaperBodyText
- [x] `components/extraction/insufficient-evidence-card.tsx` exists with opacity-75, border-dashed, role="status"
- [x] `components/extraction/confidence-badge.tsx` exists with OKLCH colors, CheckCircle2/AlertCircle/MinusCircle
- [x] `components/extraction/critic-verdict-badge.tsx` exists with ai-surface, Tooltip, delayDuration={300}
- [x] All 6 locale files contain "extraction" namespace with 10 keys each
- [x] Commit 8ef1508 exists (Task 1)
- [x] Commit 8a45158 exists (Task 2)
- [x] No TypeScript errors in new files
