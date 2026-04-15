# Phase 97: Extraction UI Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 97-extraction-ui-polish
**Areas discussed:** Job Creation Flow, Live Progress & Job Management, Results Presentation, Export Integration, Navigation & Routing
**Mode:** --auto (all decisions auto-selected)

---

## Job Creation Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Dialog-based (like screening) | Consistent with screening pattern, users stay in context | ✓ |
| Dedicated route | Separate page for job creation, more space but breaks flow | |

**User's choice:** [auto] Dialog-based (recommended -- matches screening-dialog.tsx pattern)
**Notes:** Screening already established this pattern; users expect consistency across AI features.

| Option | Description | Selected |
|--------|-------------|----------|
| Inline add/remove/edit list | Text inputs with local state management, mirrors screening | ✓ |
| Form wizard (multi-step) | Separate steps for questions, model, cost -- more structured but slower | |

**User's choice:** [auto] Inline add/remove/edit list (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Radio group with Auto/Cheap/Accurate | Simple 3-option selection, maps to cascade tiers | ✓ |
| Dropdown selector | More compact but hides options | |
| Toggle/switch | Only supports 2 options | |

**User's choice:** [auto] Radio group with 3 options (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Inline below model selector | Updates reactively, reuses credit balance check | ✓ |
| Separate cost estimation step | More prominent but adds friction | |

**User's choice:** [auto] Inline below model selector (recommended)

---

## Live Progress & Job Management

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar footer button with progress ring | Matches ScreeningFooterButton, established pattern | ✓ |
| Dedicated progress page | More detail but navigates away from current work | |
| Toast/notification only | Lightweight but easy to miss | |

**User's choice:** [auto] Sidebar footer button with progress ring (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Dialog with job list | Mirrors ScreeningJobHistory, status dots, inline progress | ✓ |
| Dropdown menu | More compact but limited space for details | |

**User's choice:** [auto] Dialog with job list (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Badge with OKLCH semantic colors | 4 states (parsing/extracting/done/failed), extends existing patterns | ✓ |
| Text-only status labels | Simpler but less scannable | |

**User's choice:** [auto] Badge with OKLCH semantic colors (recommended)

---

## Results Presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated route /extraction/[jobId] | Full-page real estate for paper-by-paper review | ✓ |
| Dialog/sheet view | Compact but cramped for result browsing | |
| Inline accordion in job list | Space-efficient but hard to navigate many papers | |

**User's choice:** [auto] Dedicated route (recommended -- results need full page)

| Option | Description | Selected |
|--------|-------------|----------|
| Group by paper, questions nested | Natural for researchers reviewing paper by paper | ✓ |
| Group by question, papers nested | Better for cross-paper comparison | |
| Flat list of all answers | Simplest but loses context | |

**User's choice:** [auto] Group by paper (recommended)

---

## Export Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Clone screening export pattern | lib/screening/export.ts, CSV/JSON/XLSX, dynamic exceljs | ✓ |
| Generic download-menu only | Reuses existing component but no XLSX | |
| Custom export module | More flexibility but reinvents wheel | |

**User's choice:** [auto] Clone screening export pattern (recommended -- proven, supports all 3 formats)

| Option | Description | Selected |
|--------|-------------|----------|
| Job history dropdown + results page header | Both locations, matches screening | ✓ |
| Results page only | Simpler but less accessible from history view | |

**User's choice:** [auto] Both locations (recommended)

---

## Navigation & Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Dual: footer button + nav item | Footer for active jobs, nav for browsing history/results | ✓ |
| Footer button only (like screening) | Consistent but no dedicated browsing | |
| Nav item only | Browsing but no quick progress access | |

**User's choice:** [auto] Dual entry point (recommended -- covers both use cases)

| Option | Description | Selected |
|--------|-------------|----------|
| Actual 6 locales (en-US, en-GB, zh, fr, hi, ja) | Matches real i18n/config.ts | ✓ |
| Aspirational 6 (en, fr, es, de, ar, zh) | From roadmap but doesn't match project | |

**User's choice:** [auto] Actual locales (recommended -- source of truth is i18n/config.ts)

---

## Claude's Discretion

- Component file organization within `components/extraction/`
- Pagination strategy for results query
- Exact animation timings beyond preset defaults
- Route layout structure
- PostHog event naming
- Dark mode color tuning for status badges

## Deferred Ideas

None -- all decisions stayed within phase scope.
