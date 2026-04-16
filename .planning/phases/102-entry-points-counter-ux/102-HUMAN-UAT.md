---
status: partial
phase: 102-entry-points-counter-ux
source: [102-VERIFICATION.md]
started: 2026-04-16T12:35:00Z
updated: 2026-04-16T12:35:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. ExtractionCounter Visual States
expected: Progress bar fills proportionally. Below 80% it uses the default primary color. At 80%+ it turns amber. At 100% it turns destructive red.
result: [pending]

### 2. AddToExtractionButton Toggle Behavior
expected: Paper is added to basket without page navigation. Icon toggles from Plus to Check. Clicking again removes the paper. Tooltip updates between states.
result: [pending]

### 3. Cap-Disabled UX State
expected: Button shows disabled state with 'Basket full -- remove papers to continue' tooltip. Papers already in basket remain toggleable for removal.
result: [pending]

### 4. Sidebar Badge Reactivity
expected: Badge appears when count > 0, shows exact number for 1-9, shows '9+' for 10+, disappears at 0
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
