---
status: partial
phase: 104-zotero-revival
source: [104-VERIFICATION.md]
started: 2026-04-16T00:00:00Z
updated: 2026-04-16T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Zotero OAuth Connect Flow
expected: Redirect to Zotero, authorize, return to connected state with username/ID/timestamp displayed on card
result: [pending]

### 2. Zotero Library Browsing and Item Selection
expected: Browse collections, load 25 items/page, click checkbox on DOI item triggers inline spinner then green checkmark, item added to basket with source "zotero"
result: [pending]

### 3. Two-Step Disconnect Confirmation
expected: AnimatePresence transitions render correctly between confirm/cancel states, mutation executes on confirm, toast appears
result: [pending]

### 4. No-DOI Items Tooltip Rendering
expected: Grayed/disabled checkbox with "No DOI available" tooltip on hover for items without DOIs
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
