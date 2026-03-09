---
phase: quick
plan: 7
subsystem: screening-ui
tags: [ui, ux, screening, dialog]
dependency_graph:
  requires: []
  provides: [redesigned-screening-dialog]
  affects: [screening-dialog, scoring-rules-editor, star-threshold-editor]
tech_stack:
  added: []
  patterns: [lucide-star-icons, badge-numbered-list, merged-question-scoring]
key_files:
  created: []
  modified:
    - components/screening/star-threshold-editor.tsx
    - components/screening/scoring-rules-editor.tsx
    - components/screening/screening-dialog.tsx
decisions:
  - Dropped "(Points)" suffix from scoring input labels — redundant given section context
  - Used combined heading via interpolation rather than new i18n key — avoids locale file changes
  - Removed Badge import from screening-dialog since it moved to scoring-rules-editor
metrics:
  duration: 187s
  completed: "2026-03-09"
  tasks_completed: 2
  tasks_total: 2
---

# Quick Task 7: Redesign Screening Modal UI/UX Summary

Real Star icons in threshold dropdown, merged questions+scoring section with Badge numbering and aligned inputs, wider dialog with improved visual hierarchy.

## Tasks Completed

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Fix star icons and improve star threshold editor | 0a91b9e | Replaced asterisk characters with lucide Star icons (yellow filled), added bordered/muted row styling |
| 2 | Merge questions list into scoring rules and fix alignment | eb1ccb1 | Removed separate questions section, added Badge+question text to scoring cards, widened dialog to max-w-2xl |

## Deviations from Plan

None - plan executed exactly as written.

## Key Changes

### Star Threshold Editor (`star-threshold-editor.tsx`)
- Imported `Star` from lucide-react
- Replaced `{"*".repeat(s)}` with actual `<Star>` icon components (filled yellow)
- Added `rounded-lg border border-border/50 bg-muted/30 p-3` to each threshold row
- Changed row alignment from `items-end` to `items-center`

### Scoring Rules Editor (`scoring-rules-editor.tsx`)
- Added `Badge` import and numbered badge per question card
- Question text displayed with badge above the point inputs
- Removed "(Points)" suffix from Yes/No/Uncertain labels for cleaner alignment
- Added `pl-7` indent on input grid to align under question text
- Cards use `bg-card` with `border-border/50` for subtle styling
- Minimum score section uses `bg-muted/30` for distinct appearance

### Screening Dialog (`screening-dialog.tsx`)
- Removed entire "Screening questions (read-only)" section (was lines 359-388)
- Combined section heading: `{t("questionsTitle")} & {t("scoringTitle")}`
- Widened dialog from `sm:max-w-lg` to `sm:max-w-2xl`
- Added `bg-muted/30` and `border-border/50` to paper count and credit cost sections
- Upgraded all section headers from `font-medium` to `font-semibold`
- Removed unused `Badge` import
- Added "no questions" fallback in the merged section

## Self-Check: PASSED
