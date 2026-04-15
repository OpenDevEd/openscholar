---
phase: 97-extraction-ui-polish
plan: 02
subsystem: extraction-ui
tags: [ui, dialog, extraction, job-creation, components]
dependency_graph:
  requires: [97-01]
  provides: [ExtractionDialog, QuestionBuilder, TierSelector]
  affects: [components/extraction/]
tech_stack:
  added: []
  patterns: [dialog-compostion, question-builder-crud, radio-tier-selector, dismiss-guards, credit-check-skip, posthog-analytics]
key_files:
  created:
    - components/extraction/question-builder.tsx
    - components/extraction/tier-selector.tsx
    - components/extraction/extraction-dialog.tsx
  modified: []
decisions:
  - "Used toast.success() for success and showStyledToast() for errors, matching screening-dialog pattern"
  - "Inlined t() calls in TierSelector instead of mapped string keys to satisfy next-intl type safety"
  - "Used aria-label string for remove button rather than adding i18n key not in spec"
metrics:
  duration: 210s
  completed: "2026-04-15T11:14:00Z"
---

# Phase 97 Plan 02: Extraction Dialog & Job Creation Flow Summary

Extraction job creation dialog with question builder, model tier selector, cost preview, and submit flow -- the primary user entry point for extraction.

## What Was Built

### QuestionBuilder (`components/extraction/question-builder.tsx`)
- Inline add/remove/edit question list with Input components
- Add row with placeholder from i18n and "Add question" button
- Enter key support for quick question entry
- Case-insensitive duplicate prevention before calling onAdd
- AnimatePresence with popLayout mode and subtleSpring transitions
- useReducedMotion support -- skips animation props when preferred
- All text via useTranslations("extraction")

### TierSelector (`components/extraction/tier-selector.tsx`)
- RadioGroup with 3 card-style RadioGroupItem entries (Auto/Fast/Thorough)
- No model names exposed to users (per D-03)
- Selected item highlighted with border-primary/50 and bg-primary/5
- Hover state with bg-accent/30 transition
- focus-visible:ring-[3px] inherited from RadioGroupItem component
- All text via useTranslations("extraction")

### ExtractionDialog (`components/extraction/extraction-dialog.tsx`)
- Composes QuestionBuilder + TierSelector into a cohesive job creation flow
- Credit balance check via useProtectedQuery with conditional "skip" when dialog closed
- Cost preview with Coins icon, aria-live="polite" for screen readers
- Insufficient balance warning with AlertCircle icon in text-destructive
- Submit handler with createExtractionJob mutation
- EXTRACTION_JOB_ALREADY_ACTIVE error detection with dedicated toast
- PostHog analytics capture (extraction_job_created) with paperCount, questionCount, tier
- Dialog dismiss guards (onEscapeKeyDown, onPointerDownOutside, onInteractOutside) during submission
- prevOpenRef state reset pattern on dialog open
- Submit button disabled when: isSubmitting, no questions, no papers, or insufficient balance
- role="status" on submitting indicator for accessibility
- All text via useTranslations("extraction")

## Task Completion

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Create QuestionBuilder and TierSelector sub-components | 89c5e26 | components/extraction/question-builder.tsx, components/extraction/tier-selector.tsx |
| 2 | Create ExtractionDialog with full job creation flow | 2d855cf | components/extraction/extraction-dialog.tsx |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

1. `npx tsc --noEmit` -- zero errors in all three new files
2. All three components export their named function
3. No hardcoded English strings (all text via useTranslations)
4. No `framer-motion` imports (all animation via `motion/react`)
5. No hardcoded color values (CSS variables and Tailwind utilities only)
6. QuestionBuilder uses AnimatePresence, motion.div, useReducedMotion
7. TierSelector uses RadioGroup from @/components/ui/radio-group
8. ExtractionDialog has all dismiss guards, prevOpenRef reset, credit check, PostHog, toasts

## Threat Surface Compliance

- T-97-04 (Tampering): Questions are plain text strings passed to createExtractionJob mutation which validates server-side
- T-97-05 (Credit bypass): Client-side credit check is UX convenience only; server-side enforcement in mutation
- T-97-06 (XSS): All text rendered via React JSX auto-escaping; no dangerouslySetInnerHTML used

## Self-Check: PASSED

- All 3 created files exist on disk
- All 2 task commits verified in git log (89c5e26, 2d855cf)
- SUMMARY.md exists at expected path
