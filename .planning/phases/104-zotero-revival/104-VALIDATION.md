---
phase: 104
slug: zotero-revival
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 104 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 + convex-test |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/env-validation.test.ts convex/zotero/purge.test.ts -x` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/env-validation.test.ts convex/zotero/purge.test.ts -x`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 104-01-01 | 01 | 1 | ZOT-05 | — | N/A | unit | `npx vitest run tests/env-validation.test.ts -x` | Exists (needs update) | ⬜ pending |
| 104-01-02 | 01 | 1 | ZOT-05 | — | N/A | unit | `npx vitest run tests/env-validation.test.ts -x` | Exists (needs new case) | ⬜ pending |
| 104-01-03 | 01 | 1 | ZOT-06 | T-104-01 | internalAction not client-callable | integration | `npx vitest run convex/zotero/purge.test.ts -x` | ❌ W0 | ⬜ pending |
| 104-01-04 | 01 | 1 | ZOT-06 | — | N/A | integration | `npx vitest run convex/zotero/purge.test.ts -x` | ❌ W0 | ⬜ pending |
| 104-02-01 | 02 | 1 | ZOT-01 | — | N/A | manual-only | N/A | N/A | ⬜ pending |
| 104-02-02 | 02 | 1 | ZOT-02, SEL-06 | — | N/A | manual-only | N/A | N/A | ⬜ pending |
| 104-02-03 | 02 | 1 | ZOT-04 | — | N/A | manual-only | N/A | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/zotero/purge.test.ts` — integration test for `purgeStaleZoteroState` (convex-test)
- [ ] Update `tests/env-validation.test.ts` — add `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` to test mirror + new test cases

*Existing infrastructure covers remaining phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ZoteroTab renders, shows connection check | SEL-06 | Action-dependent rendering requires live Convex backend | Open `/extraction/new`, switch to Zotero tab, verify connection status check |
| OAuth flow connects user | ZOT-01 | Requires live Zotero OAuth callback (external service) | Click "Connect Zotero" on settings, complete OAuth flow, verify connected state |
| Browse collections + items | ZOT-02 | Requires live Zotero API with user data | With connected account, browse collections dropdown, verify items load |
| Disabled checkbox for no-DOI items | ZOT-04 | Requires live Zotero data with mixed DOI coverage | Find an item without DOI, verify disabled checkbox with tooltip |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
