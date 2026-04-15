---
status: partial
phase: 90-free-first-parsing-waterfall
source: [90-VERIFICATION.md]
started: 2026-04-15T03:25:00Z
updated: 2026-04-15T03:25:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live PMC parsing
Deploy to Convex dev and trigger extraction on a paper with a PMC ID; confirm bodyText and parsingSource are stored correctly.
expected: Paper row shows parsingSource = "pmc" with substantial body text
result: [pending]

### 2. Live PDF parsing
Trigger extraction on a PDF-only paper; confirm unpdf/Gemini tiers fire in production.
expected: Paper row shows parsingSource = "unpdf" or "gemini" with real content
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
