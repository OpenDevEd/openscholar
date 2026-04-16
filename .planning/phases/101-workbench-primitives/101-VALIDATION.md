---
phase: 101
slug: workbench-primitives
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 101 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/extraction-results-view-store.test.ts tests/workbench-columns.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/extraction-results-view-store.test.ts tests/workbench-columns.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 101-01-01 | 01 | 1 | WB-01 | — | N/A | unit | `npx vitest run tests/workbench-columns.test.ts -x` | ❌ W0 | ⬜ pending |
| 101-01-02 | 01 | 1 | WB-01 | — | N/A | unit (jsdom) | `npx vitest run tests/components/workbench-data-table.test.tsx -x` | ❌ W0 | ⬜ pending |
| 101-02-01 | 02 | 1 | WB-02 | — | N/A | unit | `npx vitest run tests/extraction-results-view-store.test.ts -x` | ❌ W0 | ⬜ pending |
| 101-02-02 | 02 | 1 | WB-02 | — | N/A | unit | `npx vitest run tests/extraction-results-view-store.test.ts -x` | ❌ W0 | ⬜ pending |
| 101-03-01 | 03 | 1 | WB-03 | — | N/A | unit | `npx vitest run tests/workbench-columns.test.ts -x` | ❌ W0 | ⬜ pending |
| 101-03-02 | 03 | 1 | WB-10 | — | N/A | unit (jsdom) | `npx vitest run tests/components/workbench-toolbar.test.tsx -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/extraction-results-view-store.test.ts` — stubs for WB-02 (store CRUD, persistence, migration, hydration)
- [ ] `tests/workbench-columns.test.ts` — stubs for WB-01, WB-03 (column factory output, filterFn presence, dynamic question columns)
- [ ] `tests/components/workbench-data-table.test.tsx` — stubs for WB-01 (DataTable rendering with flexRender + shadcn Table)
- [ ] `tests/components/workbench-toolbar.test.tsx` — stubs for WB-03, WB-10 (toolbar renders FilterSection wrappers, filter state changes propagate)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| View switcher visual active state | WB-02 | Visual styling verification | Toggle between Table/Cards/Split views, confirm active button has `bg-background text-primary shadow-sm` styling |
| FilterSection reuse chrome | WB-10 | Visual layout verification | Open workbench, confirm filter groups render inside FilterSection collapsible wrappers with icon + title |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
