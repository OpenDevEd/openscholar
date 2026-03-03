# Roadmap: OpenAlex Count

## Milestones

- v1.0 Stripe Integration Audit -- Phases 1-3 (shipped 2026-02-27)
- v1.1 Upgrade Flow -- Phases 4-6 (shipped 2026-02-27)
- v1.2 E2E Billing Tests -- Phases 7-13 (shipped 2026-02-28)
- v2.0 TDD & Test Coverage -- Phases 14-21 (shipped 2026-02-28)
- v2.1 Library & Collections -- Phases 22-30 (shipped 2026-03-01)
- v2.2 Library UI Overhaul -- Phases 31-34 (shipped 2026-03-02)
- v2.3 Codebase Hardening -- Phases 35-42 (shipped 2026-03-02)
- v2.4 Concerns Sweep -- Phases 43-46 (in progress)

## Phases

<details>
<summary>v1.0 Stripe Integration Audit (Phases 1-3) -- SHIPPED 2026-02-27</summary>

- [x] Phase 1: Subscription Lifecycle Correctness (3/3 plans) -- completed 2026-02-27
- [x] Phase 2: Credit System Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 3: Operational Hardening (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>v1.1 Upgrade Flow (Phases 4-6) -- SHIPPED 2026-02-27</summary>

- [x] Phase 4: Upgrade Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 5: Upgrade Resilience (2/2 plans) -- completed 2026-02-27
- [x] Phase 6: UX Polish (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>v1.2 E2E Billing Tests (Phases 7-13) -- SHIPPED 2026-02-28</summary>

- [x] Phase 7: Test Infrastructure Foundation (3/3 plans) -- completed 2026-02-28
- [x] Phase 8: Subscription and Upgrade Specs (2/2 plans) -- completed 2026-02-28
- [x] Phase 9: Lifecycle and Credit Specs (2/2 plans) -- completed 2026-02-28
- [x] Phase 10: Fix Credits Spec Auth Wiring (1/1 plan) -- completed 2026-02-28
- [x] Phase 11: Tech Debt Cleanup (1/1 plan) -- completed 2026-02-28
- [x] Phase 12: Billing E2E CI Wiring (1/1 plan) -- completed 2026-02-28
- [x] Phase 13: CI Env Hardening & CRED-02 Regression (1/1 plan) -- completed 2026-02-28

Full details: `.planning/milestones/v1.2-ROADMAP.md`

</details>

<details>
<summary>v2.0 TDD & Test Coverage (Phases 14-21) -- SHIPPED 2026-02-28</summary>

- [x] Phase 14: Test Infrastructure (1/1 plan) -- completed 2026-02-28
- [x] Phase 15: AI Prompts & Schema Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 16: AI Batch Processing Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 17: AI Cost & Billing Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 18: Search & Filter Tests (3/3 plans) -- completed 2026-02-28
- [x] Phase 19: Data Export Tests (3/3 plans) -- completed 2026-02-28
- [x] Phase 20: User Auth & State Machine Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 21: Plan Enforcement & Feature Gating Tests (2/2 plans) -- completed 2026-02-28

Full details: `.planning/milestones/v2.0-ROADMAP.md`

</details>

<details>
<summary>v2.1 Library & Collections (Phases 22-30) -- SHIPPED 2026-03-01</summary>

- [x] Phase 22: Schema & Rating Bridge (2/2 plans) -- completed 2026-02-28
- [x] Phase 23: Core Library Page (2/2 plans) -- completed 2026-02-28
- [x] Phase 24: Advanced Filtering & URL State (2/2 plans) -- completed 2026-02-28
- [x] Phase 25: Collections (3/3 plans) -- completed 2026-03-01
- ~~Phase 26: Export & Polish~~ -- Superseded by Phases 29-30
- [x] Phase 27: Library UI Redesign (2/2 plans) -- completed 2026-03-01
- [x] Phase 28: Bug Fixes & Verification (2/2 plans) -- completed 2026-03-01
- [x] Phase 29: Library Export (1/1 plan) -- completed 2026-03-01
- [x] Phase 30: Library Polish (1/1 plan) -- completed 2026-03-01

Full details: `.planning/milestones/v2.1-ROADMAP.md`

</details>

<details>
<summary>v2.2 Library UI Overhaul (Phases 31-34) -- SHIPPED 2026-03-02</summary>

- [x] Phase 31: Generalized Layout Infrastructure (2/2 plans) -- completed 2026-03-01
- [x] Phase 32: Search Page Sidebar Refactor (1/1 plan) -- completed 2026-03-01
- [x] Phase 33: Library Page UI Overhaul (2/2 plans) -- completed 2026-03-01
- [x] Phase 34: Display Polish and Validation (2/2 plans) -- completed 2026-03-01

Full details: `.planning/milestones/v2.2-ROADMAP.md`

</details>

<details>
<summary>v2.3 Codebase Hardening (Phases 35-42) -- SHIPPED 2026-03-02</summary>

- [x] Phase 35: Quick Wins & Debug Cleanup (3/3 plans) -- completed 2026-03-02
- [x] Phase 36: Type Safety Sweep (2/2 plans) -- completed 2026-03-02
- [x] Phase 37: Schema Additions (1/1 plan) -- completed 2026-03-02
- [x] Phase 38: Deletion Cascade & Storage Cleanup (1/1 plan) -- completed 2026-03-02
- [x] Phase 39: Zotero Key Encryption (2/2 plans) -- completed 2026-03-02
- [x] Phase 40: Performance (2/2 plans) -- completed 2026-03-02
- [x] Phase 41: Rate Limiting Enforcement (1/1 plan) -- completed 2026-03-02
- [x] Phase 42: Test Coverage (2/2 plans) -- completed 2026-03-02

Full details: `.planning/milestones/v2.3-ROADMAP.md`

</details>

### v2.4 Concerns Sweep (In Progress)

**Milestone Goal:** Fix all tech debt, known bugs, and security concerns identified in the codebase mapping.

- [x] **Phase 43: Schema Migration & Quick Wins** - Encrypt and remove deprecated apiKey field, delete test page, fix placeholder email, document debug policy (completed 2026-03-02)
- [x] **Phase 44: Workflow & Deletion Integrity** - Cancel extraction actually stops processing, fix orphan diffs, surface diff truncation, extend GDPR user cleanup (completed 2026-03-03)
- [ ] **Phase 45: Type Safety Sweep** - Typed extraction validators, typed migration steps, typed review metadata, remove getJobDetails cap
- [ ] **Phase 46: Cron Additions** - Automated cleanup of expired Zotero OAuth tokens

Full details: `.planning/milestones/v2.4-ROADMAP.md`

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Subscription Lifecycle Correctness | v1.0 | 3/3 | Complete | 2026-02-27 |
| 2. Credit System Correctness | v1.0 | 2/2 | Complete | 2026-02-27 |
| 3. Operational Hardening | v1.0 | 2/2 | Complete | 2026-02-27 |
| 4. Upgrade Correctness | v1.1 | 2/2 | Complete | 2026-02-27 |
| 5. Upgrade Resilience | v1.1 | 2/2 | Complete | 2026-02-27 |
| 6. UX Polish | v1.1 | 2/2 | Complete | 2026-02-27 |
| 7. Test Infrastructure Foundation | v1.2 | 3/3 | Complete | 2026-02-28 |
| 8. Subscription and Upgrade Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 9. Lifecycle and Credit Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 10. Fix Credits Spec Auth Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 11. Tech Debt Cleanup | v1.2 | 1/1 | Complete | 2026-02-28 |
| 12. Billing E2E CI Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 13. CI Env Hardening & CRED-02 Regression | v1.2 | 1/1 | Complete | 2026-02-28 |
| 14. Test Infrastructure | v2.0 | 1/1 | Complete | 2026-02-28 |
| 15. AI Prompts & Schema Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 16. AI Batch Processing Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 17. AI Cost & Billing Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 18. Search & Filter Tests | v2.0 | 3/3 | Complete | 2026-02-28 |
| 19. Data Export Tests | v2.0 | 3/3 | Complete | 2026-02-28 |
| 20. User Auth & State Machine Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 21. Plan Enforcement & Feature Gating Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 22. Schema & Rating Bridge | v2.1 | 2/2 | Complete | 2026-02-28 |
| 23. Core Library Page | v2.1 | 2/2 | Complete | 2026-02-28 |
| 24. Advanced Filtering & URL State | v2.1 | 2/2 | Complete | 2026-02-28 |
| 25. Collections | v2.1 | 3/3 | Complete | 2026-03-01 |
| 26. Export & Polish | v2.1 | -- | Superseded | - |
| 27. Library UI Redesign | v2.1 | 2/2 | Complete | 2026-03-01 |
| 28. Bug Fixes & Verification | v2.1 | 2/2 | Complete | 2026-03-01 |
| 29. Library Export | v2.1 | 1/1 | Complete | 2026-03-01 |
| 30. Library Polish | v2.1 | 1/1 | Complete | 2026-03-01 |
| 31. Generalized Layout Infrastructure | v2.2 | 2/2 | Complete | 2026-03-01 |
| 32. Search Page Sidebar Refactor | v2.2 | 1/1 | Complete | 2026-03-01 |
| 33. Library Page UI Overhaul | v2.2 | 2/2 | Complete | 2026-03-01 |
| 34. Display Polish and Validation | v2.2 | 2/2 | Complete | 2026-03-01 |
| 35. Quick Wins & Debug Cleanup | v2.3 | 3/3 | Complete | 2026-03-02 |
| 36. Type Safety Sweep | v2.3 | 2/2 | Complete | 2026-03-02 |
| 37. Schema Additions | v2.3 | 1/1 | Complete | 2026-03-02 |
| 38. Deletion Cascade & Storage Cleanup | v2.3 | 1/1 | Complete | 2026-03-02 |
| 39. Zotero Key Encryption | v2.3 | 2/2 | Complete | 2026-03-02 |
| 40. Performance | v2.3 | 2/2 | Complete | 2026-03-02 |
| 41. Rate Limiting Enforcement | v2.3 | 1/1 | Complete | 2026-03-02 |
| 42. Test Coverage | v2.3 | 2/2 | Complete | 2026-03-02 |
| 43. Schema Migration & Quick Wins | 2/2 | Complete    | 2026-03-02 | - |
| 44. Workflow & Deletion Integrity | 2/2 | Complete    | 2026-03-03 | - |
| 45. Type Safety Sweep | v2.4 | 0/TBD | Not started | - |
| 46. Cron Additions | v2.4 | 0/TBD | Not started | - |
