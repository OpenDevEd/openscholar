---
status: partial
phase: 105-polish-integration-e2e
source: [105-VERIFICATION.md]
started: 2026-04-16T23:20:00Z
updated: 2026-04-16T23:20:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Full E2E Playwright run against provisioned Convex dev + Clerk test user
expected: All 3 tests in e2e/extraction-workbench.spec.ts complete — stage papers (Library/Collections/Search/Manual/Zotero) with counter showing `N/1000`, switch Table/Card/Split views, open evidence drawer, confirm reduced-motion <150ms view-switch, download CSV/JSON/XLSX files each > 0 bytes
result: [pending]
why_human: E2E spec requires a live Convex dev deployment + `E2E_CLERK_USER_EMAIL` + Clerk test mode. 105-REVIEW.md warnings (WR-01/WR-02/WR-03/WR-04) flag that some selectors (e.g., `/table view/i` regex, `getByRole('searchbox')`, evidence-drawer click on unwired callback) may need iteration on first live run. Infrastructure exists; first-run green is not guaranteed.

### 2. Manual mobile viewport check in Chrome DevTools at <=640px
expected: Basket drawer renders full-width; workbench toolbar stacks vertically; view switcher hides Card+Split; each interactive element has a visual hit area >= 44x44 CSS px; no horizontal clipping on tab triggers
result: [pending]
why_human: Visual responsive behavior cannot be verified programmatically — the CSS classes are present but rendered layout requires a real browser

### 3. Manual reduced-motion check with OS `prefers-reduced-motion: reduce` enabled
expected: View transitions feel instantaneous with no spring/slide animations; opacity fades may remain; layout does not shift/break
result: [pending]
why_human: Subjective UX quality check — programmatic 150ms budget is asserted in E2E but human feel is the real test

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
