# Convex Bandwidth Remediation — Execution Prompts

Use these prompts in a fresh session. Each is self-contained and assumes only the referenced plan files plus repo sources.

## Preamble

These prompts inherit repo doctrine:

1. DRY first. Reuse existing queries, helpers, providers, and tests before adding anything new.
2. No legacy compatibility paths. Once a broad mounted query is replaced, delete the mounted old path.
3. Convex guidance in `convex/_generated/ai/guidelines.md` overrides memory.
4. Research before guessing. Use skills/docs/subagents when the plan says to verify an API or helper.
5. Tests must go green before the plan is considered complete.
6. Delegate bounded exploration and docs reading to subagents. Keep TDD, plan edits, and commits in the main session.

---

## Plan 01 — `plans/convex-bandwidth-remediation/01-library-paginated-surface.md`

```text
Header:
- Execute plan file: plans/convex-bandwidth-remediation/01-library-paginated-surface.md
- Context README: plans/convex-bandwidth-remediation/00-README.md
- No prerequisite plan dependency.

Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing library query patterns and document the choice in the commit message.

STANDING RULES
1. DRY: reuse convex/library/queries.ts browse/search donors and lib/auth/use-auth-query.ts paginated wrapper before adding new query shapes.
2. No legacy: once the mounted page stops using listLibrary, do not leave a second mounted path behind.
3. Convex guidelines override training data. Read convex/_generated/ai/guidelines.md before changing Convex files.
4. Testing doctrine: assert on behavior, ARIA, and data-* only. Never assert on CSS classes.
5. Research before guessing: if browse/search pagination behavior is unclear, verify against official Convex docs and the existing extraction library-source query.
6. Delegate any investigation >3 file reads or >3 greps.

EXECUTION RHYTHM
Phase A — TDD, pure/query logic first, commit per green:
- Start in convex/library/queries.test.ts.
- Write red tests for paginated browse/search behavior and count behavior.
- Green the query/backfill logic.
- Commit per green.

Phase B — test-after UI and explicit export path, commit per logical unit:
1. Cut LibraryPageClient over to mounted paginated reads.
2. Move full-corpus reads to explicit point-in-time export/download paths.
3. Add/update React tests.
4. Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with scope and plan tag, e.g. `perf(library): [plan-01] mount paginated library query`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.

WHEN TO STOP
- Stop only when all acceptance criteria in the plan file are met, tests are green, and the mounted library page no longer subscribes to listLibrary.
- You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user.

DEVIATIONS
- If the plan is wrong, commit in-progress work first.
- Edit the plan file with the corrected approach and rationale.
- Commit the plan edit as `docs: [plan-01] revise <section> - <reason>`.
- Then proceed.

START NOW
1. Read plans/convex-bandwidth-remediation/00-README.md.
2. Read plans/convex-bandwidth-remediation/01-library-paginated-surface.md.
3. Read convex/_generated/ai/guidelines.md.
4. Run `git status --short`.
5. Begin Phase A in convex/library/queries.test.ts.

Go.
```

---

## Plan 02 — `plans/convex-bandwidth-remediation/02-chat-shell-and-source-read-paths.md`

```text
Header:
- Execute plan file: plans/convex-bandwidth-remediation/02-chat-shell-and-source-read-paths.md
- Context README: plans/convex-bandwidth-remediation/00-README.md
- No prerequisite plan dependency, but read the README design decisions first.

Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. When helper naming or file placement is ambiguous, choose the layout that best matches the existing convex/chat module organization and record it in the commit message.

STANDING RULES
1. DRY: reuse existing chat source row shape, PapersContext contracts, and extraction job access helpers.
2. No legacy: after chat-mode cutover, do not keep getJobDetails mounted on the chat path.
3. Convex guidelines override training data. Read convex/_generated/ai/guidelines.md first.
4. Testing doctrine: behavior, ARIA, data-* only.
5. Research before guessing: if source/inclusion helper reuse or prompt-builder constraints are unclear, verify with subagents and official Convex docs.
6. Delegate anything >3 file reads or >3 greps.

EXECUTION RHYTHM
Phase A — TDD, helper/query logic first, commit per green:
- Add red tests for the shell query and shared source-read helper.
- Green the helper and query logic.
- Commit per green.

Phase B — test-after UI wiring, commit per logical unit:
1. Cut app/extraction/[jobId]/page.tsx over to the shell query for chat mode.
2. Rewire chatPapers and chat/context to the shared helper.
3. Replace SuggestionChips count query with PapersContext.totalCount.
4. Add/update component tests.
5. Commit per logical unit.

COMMIT DISCIPLINE
- Use commit messages like `perf(chat): [plan-02] split chat shell query`.
- One commit per green in Phase A.
- One commit per logical unit in Phase B.
- Never commit red tests.

WHEN TO STOP
- Stop only when chat-mode pages no longer mount getJobDetails, the shared source helper is in place, and tests are green.
- You may NOT stop for: ambiguity resolvable from repo sources, concern about token budget, desire to ask the user for file placement preference.

DEVIATIONS
- Commit in-progress work first.
- Update the plan file and rationale.
- Commit the docs change before code that depends on it.

START NOW
1. Read plans/convex-bandwidth-remediation/00-README.md.
2. Read plans/convex-bandwidth-remediation/02-chat-shell-and-source-read-paths.md.
3. Read convex/_generated/ai/guidelines.md.
4. Run `git status --short`.
5. Begin Phase A with query/helper tests.

Go.
```

---

## Plan 03 — `plans/convex-bandwidth-remediation/03-chat-message-read-model.md`

```text
Header:
- Execute plan file: plans/convex-bandwidth-remediation/03-chat-message-read-model.md
- Context README: plans/convex-bandwidth-remediation/00-README.md
- Depends on plan 02 being merged if the shared chat helper layout changes adjacent files.

Long-running autonomous task. Expect 2-3 hours. Do not stop mid-plan to ask for confirmation. When the installed @convex-dev/agent helper API differs from expectations, verify it first and then choose the smallest parity-preserving implementation.

STANDING RULES
1. DRY: prefer installed @convex-dev/agent helpers before copying conversion logic locally.
2. No legacy: once listThreadMessages is slimmed, remove the duplicated base-read path.
3. Convex guidelines override training data. Read convex/_generated/ai/guidelines.md before editing Convex code.
4. Testing doctrine: behavior/data-* only.
5. Research before guessing: verify the installed agent helper surface with a subagent or local package read before coding.
6. Delegate anything >3 reads or greps.

EXECUTION RHYTHM
Phase A — TDD, query parity first, commit per green:
- Write red tests for listThreadMessages parity across normal/failed/aborted/streaming cases.
- Green the query rewrite.
- Commit per green.

Phase B — test-after client verification, commit per logical unit:
1. Update client/message tests if needed.
2. Add any bounded pagination caps supported by the installed helper version.
3. Commit per logical unit.

COMMIT DISCIPLINE
- Use commit messages like `perf(chat): [plan-03] collapse thread message base reads`.
- One commit per green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.

WHEN TO STOP
- Stop only when listThreadMessages no longer duplicates the base thread-corpus read, parity tests are green, and streaming/aborted behavior still works.
- You may NOT stop for: API uncertainty that can be resolved by package inspection, token anxiety, urge to ask the user whether local helper extraction is acceptable.

DEVIATIONS
- Commit work first.
- Update the plan file with the corrected helper strategy.
- Commit the docs revision before the code relying on it.

START NOW
1. Read plans/convex-bandwidth-remediation/00-README.md.
2. Read plans/convex-bandwidth-remediation/03-chat-message-read-model.md.
3. Read convex/_generated/ai/guidelines.md.
4. Inspect installed @convex-dev/agent helper exports.
5. Run `git status --short`.
6. Begin Phase A in the chat query tests.

Go.
```

---

## Plan 04 — `plans/convex-bandwidth-remediation/04-billing-and-screening-query-thinning.md`

```text
Header:
- Execute plan file: plans/convex-bandwidth-remediation/04-billing-and-screening-query-thinning.md
- Context README: plans/convex-bandwidth-remediation/00-README.md
- No prerequisite dependency.

Autonomous task. Expect 1-3 hours. Do not stop mid-plan to ask for confirmation. When there are multiple valid names for the new screening shell query, choose the one most consistent with convex/screening/queries.ts and keep the old history query untouched.

STANDING RULES
1. DRY: reuse the existing screening aggregate-backed progress helpers.
2. No legacy: remove the mounted billing diagnostics query completely; do not leave a dormant hook behind.
3. Convex guidelines override training data.
4. Testing doctrine: behavior/data-* only.
5. Research before guessing: if the best active-job index path is unclear, inspect schema indexes before coding.
6. Delegate anything >3 reads or greps.

EXECUTION RHYTHM
Phase A — TDD, query logic first, commit per green:
- Add red tests for the new screening shell query.
- Green the query.
- Commit per green.

Phase B — test-after page/component cleanup, commit per logical unit:
1. Remove grant diagnostics from the billing page.
2. Cut AppSidebar over to the new screening shell query.
3. Add/update component tests.
4. Commit per logical unit.

COMMIT DISCIPLINE
- Use messages like `perf(screening): [plan-04] add sidebar active-job query`.
- One commit per green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.

WHEN TO STOP
- Stop only when the billing page no longer mounts diagnostics, AppSidebar no longer uses listUserScreeningJobs(limit: 1), and tests are green.
- You may NOT stop for: naming ambiguity solvable from local patterns, token concerns, desire to ask whether a deleted dead query should be kept.

DEVIATIONS
- Commit work first.
- Edit the plan and rationale.
- Commit the docs revision before dependent code.

START NOW
1. Read plans/convex-bandwidth-remediation/00-README.md.
2. Read plans/convex-bandwidth-remediation/04-billing-and-screening-query-thinning.md.
3. Read convex/_generated/ai/guidelines.md.
4. Run `git status --short`.
5. Begin Phase A with screening query tests.

Go.
```

---

## Plan 05 — `plans/convex-bandwidth-remediation/05-shared-live-state-and-model-catalog.md`

```text
Header:
- Execute plan file: plans/convex-bandwidth-remediation/05-shared-live-state-and-model-catalog.md
- Context README: plans/convex-bandwidth-remediation/00-README.md
- Depends on plans 01 and 04 being merged if they change parent ownership patterns on library/settings surfaces.

Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. When deciding whether to hoist a query into a provider, prefer the narrowest subtree that genuinely shares the state and reject root-global scope unless the data is truly app-shell-wide.

STANDING RULES
1. DRY: mirror FeatureFlagProvider and existing subtree provider patterns before inventing a new architecture.
2. No legacy: once a targeted duplicate subscription is hoisted/shared, remove the redundant child query.
3. Convex guidelines override training data.
4. Testing doctrine: behavior/data-* only.
5. Research before guessing: verify whether a candidate subtree really has one common owner before creating a provider.
6. Delegate anything >3 reads or greps.

EXECUTION RHYTHM
Phase A — TDD, provider/query contracts first, commit per green:
- Add red tests for the provider selectors and smaller model-catalog query shape.
- Green the provider/query work.
- Commit per green.

Phase B — test-after consumer cutovers, commit per logical unit:
1. Cut targeted billing/extraction/library surfaces over to shared small-query ownership.
2. Replace the AI settings model catalog live query with the explicit low-freshness read.
3. Add/update component tests.
4. Commit per logical unit.

COMMIT DISCIPLINE
- Use messages like `perf(settings): [plan-05] hoist shared subscription state`.
- One commit per green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.

WHEN TO STOP
- Stop only when the targeted duplicate small queries are hoisted/shared, AI settings no longer mounts a live whole-catalog models query, and tests are green.
- You may NOT stop for: uncertainty about provider scope that can be resolved by inspecting ownership trees, token pressure, urge to ask whether a root-global provider is “cleaner”.

DEVIATIONS
- Commit work first.
- Revise the plan file and rationale.
- Commit the docs change before dependent code.

START NOW
1. Read plans/convex-bandwidth-remediation/00-README.md.
2. Read plans/convex-bandwidth-remediation/05-shared-live-state-and-model-catalog.md.
3. Read convex/_generated/ai/guidelines.md.
4. Re-read lib/feature-flags/provider.tsx and app/layout.tsx as provider donors.
5. Run `git status --short`.
6. Begin Phase A with provider/query tests.

Go.
```

