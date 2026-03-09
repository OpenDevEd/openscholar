---
phase: quick
plan: 8
subsystem: screening
tags: [ui, ux, i18n, collection-selector]
dependency_graph:
  requires: []
  provides: [improved-create-collection-inline-ux]
  affects: [screening-dialog]
tech_stack:
  added: []
  patterns: [inline-card-ui, labeled-form-fields]
key_files:
  created: []
  modified:
    - components/screening/collection-selector.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json
decisions: []
metrics:
  duration: "~2 minutes"
  completed: "2026-03-09"
---

# Quick Task 8: Improve Create New Collection Inline Flow

Redesigned bare input+ghost-button into a bordered card with label, visible Cancel/Create buttons, and i18n support across 6 locales.

## What Changed

### Task 1: Redesign inline create-collection flow with label, styled buttons, and i18n
**Commit:** c27344b

- Replaced flat `flex items-center gap-2` layout with a visually distinct bordered card (`rounded-md border border-border bg-muted/50 p-3 space-y-2`)
- Added `createCollectionLabel` i18n key to all 6 locale files (en-US, en-GB, fr, hi, ja, zh)
- Label rendered above input as `text-xs font-medium text-muted-foreground`
- Cancel button: ghost variant with translated "Cancel" text, resets state on click
- Create button: default (primary) variant with Check icon + "Create new collection" text, disabled when input is empty
- Both buttons sized at `h-7 px-3 text-xs` for compact but clickable appearance
- Keyboard shortcuts preserved: Enter to create, Escape to cancel

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- Next.js build passed without errors
- All 6 locale files contain `createCollectionLabel` key
- TypeScript compilation clean

## Self-Check: PASSED
