# Phase 105: Polish, Integration, E2E - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 105-polish-integration-e2e
**Mode:** --auto (no interactive questioning; Claude selected recommended defaults)
**Areas discussed:** ESLint Rule Architecture, E2E Playwright Spec, Mobile Responsive Targets, Reduced-Motion Implementation, i18n Audit Methodology

---

## ESLint Rule Architecture (GAP-03)

### Q1: How should the literal-number ban be implemented?
| Option | Description | Selected |
|--------|-------------|----------|
| Flat config + `no-restricted-syntax` rule | Bootstrap `eslint.config.mjs` (Next.js 16 / ESLint 9), use `next/core-web-vitals` preset, add AST-pattern rule for `Literal[value=1000]` and `Literal[value=200]` with glob overrides. Add `npm run lint` to CI. | ✓ |
| Custom ESLint plugin | Author a dedicated rule as an npm-local plugin. | |
| `eslint-plugin-no-magic-numbers` with overrides | Use existing plugin and configure ignored-values + file overrides. | |
| Structural Vitest test only (grep-based) | Skip ESLint entirely — use file-read + regex assertion as a CI gate. | |

**Rationale:** No ESLint config exists at the repo root. Bootstrapping the Next.js-bundled ESLint 9 flat config is a one-time cost that unlocks the standard lint tooling for the whole project. `no-restricted-syntax` is the idiomatic ESLint way to ban AST patterns without writing a plugin. Pure-grep structural test would miss legitimate multi-line cases. Aligns with the "modern standards" directive.

### Q2: Which files does the rule cover?
| Option | Description | Selected |
|--------|-------------|----------|
| `components/extraction/**` + `app/extraction/**` (ROADMAP scope) | Matches GAP-03 wording exactly. | ✓ |
| Everything under `components/**` + `app/**` | Broader coverage. | |
| Whole repo | Maximum coverage including `convex/**`. | |

**Rationale:** ROADMAP GAP-03 explicitly specifies the two globs. Broader scope risks false positives on pre-v7.0 code and scope creep.

### Q3: Should any exceptions exist?
| Option | Description | Selected |
|--------|-------------|----------|
| Exempt test files + files importing from queryBounds | Nested glob override disables rule for `**/*.test.{ts,tsx}` inside the scoped globs. | ✓ |
| No exceptions | Fail every occurrence. | |
| Only test-file exemption | Skip the importing-from-queryBounds check. | |

**Rationale:** Tests legitimately assert against the numeric cap value (1000). Files that import from `queryBounds.ts` are using the approved source and shouldn't be penalized for the literal appearing in the import chain. Exempting both eliminates false positives.

### Q4: Error message wording?
| Option | Description | Selected |
|--------|-------------|----------|
| Guidance-rich message pointing to EXTRACTION_LIMITS_BY_TIER + getExtractionLimit | Names the exact approved alternatives. | ✓ |
| Generic "use named constant" message | Minimal guidance. | |

**Rationale:** The approved-alternative message turns a lint failure into a self-service fix. Matches the project's documentation-first culture.

---

## E2E Playwright Spec

### Q1: What flow does the E2E cover?
| Option | Description | Selected |
|--------|-------------|----------|
| Full flow: sign-in → connect Zotero → stage papers from 4 tabs → counter update → create job → navigate table/card/split/drawer views → export filtered subset | Matches ROADMAP success criterion #2 verbatim. | ✓ |
| Happy path only: sign-in → one tab → create job → table view | Minimal smoke test. | |
| Split by domain: 3 separate specs (selection, workbench, export) | Fine-grained isolation. | |

**Rationale:** ROADMAP Phase 105 §2 explicitly enumerates the full flow. A single spec covers it linearly; splitting introduces cross-spec fixture sharing complexity without isolation benefit.

### Q2: Zotero live vs mocked?
| Option | Description | Selected |
|--------|-------------|----------|
| Mock via `page.route()` network interception | Canned fixtures for Zotero API + stub the connection state. | ✓ |
| Live OAuth 1.0a against a test Zotero account | Real end-to-end. | |
| Skip Zotero tab in E2E (cover unit-level) | Omit Zotero from the E2E path. | |

**Rationale:** Live OAuth 1.0a is brittle in CI (callback URL whitelisting, test-account rate limits, test-account expiry). Network mocking via Playwright is the project-standard pattern and exercises the Zotero UI surface fully.

### Q3: File organization?
| Option | Description | Selected |
|--------|-------------|----------|
| Single `e2e/extraction-workbench.spec.ts` under default project | Matches existing `auth.spec.ts` style. | ✓ |
| Multiple specs under `e2e/extraction/` directory | Separate specs per flow. | |
| Third named Playwright project `extraction` alongside `default` + `billing` | Dedicated project config. | |

**Rationale:** Matches existing `auth.spec.ts` pattern. A third project would duplicate `fullyParallel: false` + `workers: 1` config without benefit at the current scale.

### Q4: How is extraction backend exercised?
| Option | Description | Selected |
|--------|-------------|----------|
| Seed via dev-guarded Convex internalAction (`seedCompletedJob`) | Insert pre-computed results; skip the 1-2 min real cascade. | ✓ |
| Run the real LLM cascade in CI | Full end-to-end. | |
| Mock Convex queries at the network layer | Intercept via `page.route`. | |

**Rationale:** Real cascade takes 1-2 min per paper and is already covered by the extraction unit suite (Phase 92/96). E2E verifies UI wiring, not pipeline correctness. Network-level mocking of Convex queries would break reactive subscriptions. Dev-guarded seed action is the clean middle path.

---

## Mobile Responsive Targets

### Q1: Basket drawer on mobile?
| Option | Description | Selected |
|--------|-------------|----------|
| Full-width `Sheet` baseline (per ROADMAP) | Default shadcn Sheet responsive behavior. | ✓ |
| Dedicated bottom-sheet variant using vaul | Custom mobile-only drawer. | |

**Rationale:** ROADMAP success criterion #3 explicitly states "Sheet as baseline". MOB-F01 defers the bottom-sheet variant to v7.1.

### Q2: Workbench views on mobile?
| Option | Description | Selected |
|--------|-------------|----------|
| Auto-switch to table view at `<768px`; hide card/split switcher | Extend Phase 103 D-06 (split→table mobile fallback) to card view. | ✓ |
| Force card view on mobile (single column natural) | Prioritize card view as mobile-native. | |
| All 3 views available on mobile with degraded layout | Maximum flexibility. | |

**Rationale:** Phase 103 already decided split view falls back to table on mobile. Extending the same rule to card view creates consistent "mobile = table" behavior. All-3-views on mobile would require significant layout work the phase doesn't budget for.

### Q3: Touch target enforcement?
| Option | Description | Selected |
|--------|-------------|----------|
| 44px min via Tailwind `min-h-[44px] min-w-[44px]` on v7.0 interactive elements | WCAG AAA alignment; className-level enforcement. | ✓ |
| 48px (Material Design) | Larger target, more spacing. | |
| No explicit enforcement; rely on shadcn defaults | Skip the audit. | |

**Rationale:** PROJECT.md design principles explicitly cite WCAG AAA targeting. 44px is the WCAG 2.2 AAA minimum. 48px is Material-specific, not a cross-platform standard.

### Q4: Audit scope?
| Option | Description | Selected |
|--------|-------------|----------|
| v7.0-added components only | Scope-limited to Phases 98-104 output. | ✓ |
| All interactive elements in the app | Comprehensive audit. | |

**Rationale:** Auditing pre-v7.0 components risks regressions and scope creep. v7.0 is the current milestone; earlier components should have been audited at their shipping phase.

---

## Reduced-Motion Implementation

### Q1: Global vs per-component approach?
| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: `MotionConfig reducedMotion="user"` + CSS `@media (prefers-reduced-motion)` fallback | Covers both Motion animations and Tailwind/CSS animations. | ✓ |
| Motion-only global `MotionConfig` | Misses raw CSS transitions. | |
| CSS-only `@media` rule | Misses Motion spring animations that bypass CSS. | |
| Per-component `useReducedMotion()` refactor | High cost, incomplete coverage. | |

**Rationale:** Hybrid covers every motion path in the app with two config additions. Motion-only misses Tailwind `transition-*` utilities. CSS-only misses Motion's spring-based animations which are JS-driven. Per-component is already partially done and adding global coverage complements it.

### Q2: What animations to disable?
| Option | Description | Selected |
|--------|-------------|----------|
| View transitions, drawer slides, badge pulse; preserve focus rings, color changes, progress-bar state jumps | Decorative motion off, essential feedback preserved. | ✓ |
| All animations including focus rings | Maximum reduction. | |
| Only the "most obvious" motion (drawer + view switch) | Minimal reduction. | |

**Rationale:** WCAG Motion Reduced guidance recommends suppressing decorative motion while preserving state-communication feedback. Progress bars that jump instantly still communicate state; focus rings are accessibility-essential and not animations per se.

### Q3: Verification?
| Option | Description | Selected |
|--------|-------------|----------|
| Playwright `emulateMedia({ reducedMotion: "reduce" })` + view-switch timing assertion | Native Playwright; CI-gated. | ✓ |
| Manual QA in multiple browsers | Ad-hoc verification. | |
| No verification | Trust the implementation. | |

**Rationale:** Playwright's `emulateMedia` is native (no dep). Adding 3 lines to the existing E2E spec gives CI coverage. Manual QA doesn't scale and isn't repeatable.

---

## i18n Audit Methodology

### Q1: Audit mechanism?
| Option | Description | Selected |
|--------|-------------|----------|
| New structural Vitest test (`tests/i18n/v7-key-parity.test.ts`) | CI-gated, automated, runs under default `npm run test`. | ✓ |
| Manual audit before sign-off | Human review of all 6 files. | |
| One-off audit script in `scripts/` | Run once, no CI gate. | |

**Rationale:** Automated + CI-gated is the only mechanism that catches future drift. Manual audit fails the moment someone adds a key. Script-based works for one-time audit but doesn't prevent regression.

### Q2: What does the test check?
| Option | Description | Selected |
|--------|-------------|----------|
| Programmatic key-set parity across all 6 locales + French diacritic sampling on v7.0 keys | Matches ROADMAP success criterion #5 verbatim. | ✓ |
| Parity only | Skip the diacritic check. | |
| Diacritic sampling only | Skip the parity check. | |
| Deep string-length parity + diacritic | Enforce string length approximately matches. | |

**Rationale:** ROADMAP success criterion #5 specifies both parity and French diacritic check. Length parity would cause false failures (different languages have very different lengths).

### Q3: Scope?
| Option | Description | Selected |
|--------|-------------|----------|
| Whole key tree of each locale file (not a whitelist) | Catches any drift, not just v7.0 drift. | ✓ |
| v7.0 namespaces only (extraction.*, connectionsPage.zotero.*) | Scope-limited to new keys. | |

**Rationale:** Whole-tree parity catches drift in any part of the messages file. Scoping to v7.0 namespaces would leave pre-v7.0 drift undetected, which is a silent-failure problem we shouldn't introduce. The scope is about WHO runs the test (Phase 105 enables it), not WHAT it checks.

### Q4: Missing-key policy?
| Option | Description | Selected |
|--------|-------------|----------|
| Fail the test — no optional locales | All 6 locales are production. | ✓ |
| Soft-fail with a warning log | Non-blocking. | |
| Skip-list for specific "rare" locales | Reduce noise. | |

**Rationale:** All 6 locales are production. Consistent coverage is non-negotiable per CLAUDE.md design principles (accessibility + diverse global users).

---

## Claude's Discretion

Noted during analysis — these areas were not subject to gray-area decisions:
- Exact fixture JSON shape for the Zotero API mock (decided at planning time)
- Exact helper extraction location (`e2e/helpers/sign-in.ts` vs inline)
- Exact glob patterns for nested override blocks
- Exact list of 8-10 French diacritic sample keys
- Whether 44px enforcement uses a wrapper component or inline classNames
- Exact `<100ms` threshold for reduced-motion verification
- Test directory organization (`tests/extraction/` vs `tests/eslint/`)

## Deferred Ideas

- Pre-commit lint hook / husky setup — not part of GAP-03
- MOB-F01 mobile bottom-sheet drawer variant — v7.1
- Unused-i18n-keys audit (reverse parity) — different problem
- Full keyboard shortcuts (j/k/e) — WB-F05 (v7.1)
- Lint rule extension to `convex/**` — separate phase
- Visual regression testing — out of scope per PROJECT.md
- Storybook — not in project

---

*Auto mode: no user interaction. All decisions based on ROADMAP scope, prior phase CONTEXT.md files (98-104), PROJECT.md principles (WCAG AAA, modern standards, DRY), and codebase scout findings.*
</content>
</invoke>