# Evidence Library configuration interface — execution prompts

Use one prompt at a time in plan order. Each prompt is self-contained, but the numbered plan and `00-README.md` remain the source of truth. Never push unless the user separately and explicitly asks.

## Plan 01 — Ownership and generated configuration contract

```md
# Execute Plan 01

Plan file: `plans/evidence-library-configuration-interface/01-ownership-and-generated-config-contract.md`
Context README: `plans/evidence-library-configuration-interface/00-README.md`
Dependencies: none. This plan must merge before Plans 02–07.
OpenScholar root: `/Users/mcharrad/Documents/Github/openscholar/dev-self`.
Evidence Library root: `/Users/mcharrad/Documents/Github/new-el-optimize` (remote `OpenDevEd/new-el`, grounded branch `openscholar`).

Long-running autonomous task. Expect 3–5 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with the source schema, existing repository patterns, and current primary documentation, then document the choice in the commit message.

## STANDING RULES

1. DRY first: reuse the Evidence Library donors under `/Users/mcharrad/Documents/Github/new-el-optimize`: `src/config/library-config/schema.ts`, `public/library-config.schema.json`, `public/library-config.catalogs.json`, and `src/config/library-config/artifacts.ts`; do not hand-copy a second schema.
2. No legacy or compatibility code. This is pre-testing software; replace incorrect assumptions cleanly and remove dead code.
3. If Convex enters scope, read `convex/_generated/ai/guidelines.md`; it overrides training knowledge.
4. Use TDD for pure contract, provenance, path, digest, and registry logic. Test observable behavior, never CSS strings or implementation text.
5. After every commit touching `convex/`, run `npx pm2 logs convex --lines 5 --nostream` and require `✔ Convex functions ready!`. After every commit touching `app/` or `components/`, run `npx pm2 logs next --lines 5 --nostream` and require a recent `✓ Compiled` with no compile error.
6. Research before guessing: inspect installed package source and relevant skills; use primary current documentation for Ajv or framework behavior.
7. Delegate investigations exceeding about three reads or greps, but keep TDD cycles, commits, plan revisions, and acceptance verification in the main session.
8. Do not introduce application-state `useEffect`, compatibility shims, duplicated config literals, or a second configuration schema.
9. Never push. Local atomic commits only.

## EXECUTION RHYTHM

### Phase A — TDD pure logic

Work in `lib/evidence-libraries/configuration/` for pure sync/provenance/digest/registry logic and tests—Vitest includes `lib/**`, `tests/**`, and `convex/**`, not `scripts/**`. Keep `scripts/sync-evidence-library-config-contract.mjs` as a thin CLI shell. Write one failing behavioral test for artifact generation, provenance/digest verification, JSON-pointer resolution, or path safety; make it green; refactor; commit each green separately.

### Phase B — test after integration units

1. Implement the pinned upstream artifact directory and provenance manifest.
2. Implement the deterministic sync/check command.
3. Add the OpenScholar section presentation registry keyed only by generated section-root JSON pointers; leave per-field widgets and authority metadata to Plans 04–05.
4. Wire package scripts and documentation.

Run targeted tests after each unit and commit each logical unit separately.

## COMMIT DISCIPLINE

Use conventional commits scoped with `[plan-01]`. One Red → Green → Refactor cycle per commit in Phase A; one concern per commit in Phase B. Never commit red tests. Never bypass hooks with `--no-verify`, `--no-gpg-sign`, or equivalents. Commit plan deviations before code that depends on them. Never push.

## WHEN TO STOP

Stop only when every Plan 01 acceptance criterion is satisfied, targeted and repository checks are green, generated artifacts reproduce deterministically, and every touched deployed tree has a green pm2 gate. If an authoritative required source or API does not exist, follow the blocker protocol. You may NOT stop for ambiguity resolvable by re-reading the plan, worry about token usage, or an impulse to check with the user.

## DEVIATIONS

If the plan is wrong or incomplete: commit clean in-progress work, edit the numbered plan with the corrected approach and rationale, commit that edit as `docs: [plan-01] revise <section> — <reason>`, then proceed. If a required API truly does not exist or a pre-existing bug blocks progress: commit clean partial work, create `plans/evidence-library-configuration-interface/01-BLOCKER.md`, and stop without inventing a workaround.

## START NOW

1. Read the complete Plan 01 and `00-README.md`.
2. At `/Users/mcharrad/Documents/Github/new-el-optimize` on branch `openscholar`, read the authoritative schema, catalogs, artifact generator, and tests, then pin the exact source SHA.
3. Run `git status --short --branch` and protect unrelated work.
4. Run `npx pm2 logs convex --lines 5 --nostream` to ensure the existing dev push is healthy before any commit; also inspect Next logs if scope expands into a deployed frontend tree.
5. Begin the first failing test for deterministic artifact provenance.

Go.
```

## Plan 02 — Drafts, revisions, and authorization

```md
# Execute Plan 02

Plan file: `plans/evidence-library-configuration-interface/02-drafts-revisions-and-authorization.md`
Context README: `plans/evidence-library-configuration-interface/00-README.md`
Dependency: Plan 01 must be merged and its generated contract checks green.
OpenScholar root: `/Users/mcharrad/Documents/Github/openscholar/dev-self`.
Evidence Library root: `/Users/mcharrad/Documents/Github/new-el-optimize` (remote `OpenDevEd/new-el`, grounded branch `openscholar`).

Long-running autonomous task. Expect 6–9 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, follow the existing Clerk identity, Convex access-helper, encrypted-key, and revision patterns, verify current documentation, and record the choice in the commit message.

## STANDING RULES

1. DRY first: reuse `components/auth/auth-route-gate.tsx`, `convex/extraction/access.ts`, the current user projection, and `convex/apiKeys/actions.ts`; extend shared authorization and encryption concepts instead of cloning them.
2. No legacy or compatibility paths. Dev data is disposable; use the destructive migration stance in the plan.
3. Read `convex/_generated/ai/guidelines.md` before touching Convex. Its guidance overrides training knowledge.
4. Use TDD for organization role mapping, authorization decisions, revision transitions, optimistic-concurrency conflicts, and credential metadata. Assert results and errors, not source text.
5. After every Convex-touching commit, run `npx pm2 logs convex --lines 5 --nostream`; require the newest deployment to show `✔ Convex functions ready!` with no recent `✖ Error`. Check `npx convex function-spec | rg 'evidenceLibraries'` for every new public function and validator.
6. Use the live-grounded Clerk contract in `02-PREREQUISITES.md`: Convex receives `identity.o.id` and `identity.o.rol`, with roles exactly `org:admin` / `org:member`. Preserve the signed Clerk body `timestamp` and `instance_id`; never order events by `svix-timestamp`, add Clerk v1 fallbacks, or guess a payload.
7. Delegate broad caller mapping and documentation research, but retain TDD cycles, commits, plan edits, and final deployed-spec verification in the main session.
8. Do not use `useEffect` for auth, query, draft, save, or revision synchronization. Use Convex subscriptions, derived render state, and triggering event handlers.
9. Never push. Local atomic commits only.

## EXECUTION RHYTHM

### Phase A — TDD pure logic

Work first in the authorization and revision helpers named by the plan under `convex/evidenceLibraries/`. Write one failing test at a time for role normalization, permission decisions, revision-state transitions, and conflict detection. Make it green, refactor, and commit per green.

### Phase B — test after integration units

1. Verify Clerk Organizations, the exact Convex JWT organization claims, and the admin/member development fixture before schema work.
2. Add the clean organization/membership, Evidence Library, and runtime-binding schema.
3. Add verified Clerk webhook projection handling and the dev-gated isolated-runtime provisioning seed.
4. Add library, draft, immutable revision, section, operation, and credential functions.
5. Add public function validators, indexes, authorization integration, and focused integration tests.

Commit each logical unit separately and close every Convex commit with the pm2 and function-spec gates.

## COMMIT DISCIPLINE

Use conventional commits scoped with `[plan-02]`. Commit each TDD green separately and each Phase B concern separately. Never commit with red tests or a broken Convex push. Never bypass hooks. A plan deviation is its own preceding docs commit. Never push.

## WHEN TO STOP

Stop only when Plan 02 acceptance criteria pass, unauthorized users are rejected server-side, revisions are immutable, draft conflicts are observable, tests pass, public validators match source, and pm2 shows `✔ Convex functions ready!` for the final state. Use the blocker protocol for a truly absent required Clerk or Convex capability. You may NOT stop for ambiguity resolvable by re-reading the plan, worry about token usage, or an impulse to check with the user.

## DEVIATIONS

For a clear correction, commit clean work, revise Plan 02 with rationale, commit `docs: [plan-02] revise <section> — <reason>`, then continue. For a true missing API or pre-existing blocker, commit partial work, write `plans/evidence-library-configuration-interface/02-BLOCKER.md`, and stop without a compatibility workaround.

## START NOW

1. Read Plan 02 and `00-README.md` completely.
2. Read `convex/_generated/ai/guidelines.md`, the named auth/access/encryption donors, and current installed Clerk organization documentation.
3. Verify Organizations are enabled, inspect and record the exact JWT claim names, and verify one development org with `org:admin` and `org:member` test identities; if any prerequisite is unavailable, follow the Plan 02 blocker protocol before schema work.
4. Run `git status --short --branch`; preserve unrelated changes.
5. Run `npx pm2 logs convex --lines 5 --nostream` and require a healthy boot deployment, then begin the first authorization-policy failing test.

Go.
```

## Plan 03 — Route shell and Anchor rail

```md
# Execute Plan 03

Plan file: `plans/evidence-library-configuration-interface/03-route-shell-and-anchor-rail.md`
Context README: `plans/evidence-library-configuration-interface/00-README.md`
Dependencies: Plans 01 and 02 must be merged.
OpenScholar root: `/Users/mcharrad/Documents/Github/openscholar/dev-self`.
Evidence Library root: `/Users/mcharrad/Documents/Github/new-el-optimize` (remote `OpenDevEd/new-el`, grounded branch `openscholar`).

Long-running autonomous task. Expect 5–8 hours. Do not stop mid-plan to ask for confirmation. When ambiguity remains, follow the established settings-shell, sidebar, route-gate, generated-contract, and current Next.js patterns and document the decision in the commit message.

## STANDING RULES

1. DRY first: reuse `app/settings/layout.tsx`, `components/settings/sidebar-nav.tsx`, `components/auth/auth-route-gate.tsx`, and existing `components/ui/` primitives; do not transplant prototype HTML or build a second component system.
2. No legacy or compatibility behavior. Delete obsolete scaffolding encountered in the owned slice instead of preserving two shells.
3. Read `convex/_generated/ai/guidelines.md` before using Convex and the relevant guide under `node_modules/next/dist/docs/` before writing routes, layouts, loading, errors, or navigation.
4. Use TDD for section/rail derivation and behavioral component tests for roles, landmarks, hash targets, active state, permission state, and focus behavior. Never assert Tailwind classes.
5. After every commit touching `app/` or `components/`, run `npx pm2 logs next --lines 5 --nostream` and require a recent `✓ Compiled` with no `Module not found`, type error, or failed compile. Run the Convex gate after any backend commit.
6. Research installed Next.js APIs and browser behavior before choosing a pattern; do not guess from older Next.js knowledge.
7. Delegate broad route/donor mapping, but keep TDD cycles, commits, plan revisions, and browser acceptance verification in the main session.
8. No application-state `useEffect`. Use native anchor behavior and derived state. Only a smallest-leaf, fully cleaned-up IntersectionObserver bridge is eligible if the plan's evidence proves it necessary.
9. Never push. Local atomic commits only.

## EXECUTION RHYTHM

### Phase A — TDD pure logic

Start in `lib/evidence-libraries/configuration/` with section grouping, ordered rail derivation, editability, completion, and issue-count helpers. Write one failing behavioral test, make it green, refactor, and commit per green.

### Phase B — test after integration units

1. Add the library configuration route, layout, loading, error, and permission boundary.
2. Build the responsive shell and generated-contract-driven Anchor rail.
3. Add section framing, issue summary, draft/revision header, and save-status semantics.
4. Add component tests and a focused browser smoke for navigation, focus, and read-only behavior.

Commit each logical unit separately and run the Next pm2 gate after every frontend commit.

## COMMIT DISCIPLINE

Use conventional commits scoped with `[plan-03]`. One TDD green per Phase A commit, one concern per Phase B commit, no red commits, no hook bypasses, and no code depending on an uncommitted plan deviation. Never push.

## WHEN TO STOP

Stop only when Plan 03 acceptance criteria pass, the route uses the real 24-section generated contract, browser navigation and permissions behave correctly, tests are green, and the last Next log has a recent `✓ Compiled` with no compile failure. You may NOT stop for ambiguity resolvable by re-reading the plan, worry about token usage, or an impulse to check with the user.

## DEVIATIONS

Commit clean work, revise Plan 03 with the corrected design and rationale, commit `docs: [plan-03] revise <section> — <reason>`, then continue. For a truly absent required API or blocking pre-existing bug, commit partial work, create `plans/evidence-library-configuration-interface/03-BLOCKER.md`, and stop rather than masking it.

## START NOW

1. Read Plan 03 and `00-README.md` completely.
2. Read the relevant installed Next.js guides plus the named shell, sidebar, gate, and UI donors.
3. Run `git status --short --branch`; protect unrelated work.
4. Run `npx pm2 logs convex --lines 5 --nostream` to confirm the backend push is healthy, then `npx pm2 logs next --lines 5 --nostream` to confirm the frontend baseline.
5. Begin the first failing section-grouping test.

Go.
```

## Plan 04 — Brand, content, and collection editors

```md
# Execute Plan 04

Plan file: `plans/evidence-library-configuration-interface/04-brand-content-and-collection-editors.md`
Context README: `plans/evidence-library-configuration-interface/00-README.md`
Dependencies: Plans 01–03 must be merged.
OpenScholar root: `/Users/mcharrad/Documents/Github/openscholar/dev-self`.
Evidence Library root: `/Users/mcharrad/Documents/Github/new-el-optimize` (remote `OpenDevEd/new-el`, grounded branch `openscholar`).

Long-running autonomous task. Expect 8–12 hours. Do not stop mid-plan to ask for confirmation. When details are ambiguous, derive field behavior from the generated schema/catalogs, then follow existing form, repeater, validation, and draft-mutation donors and record the choice in the commit message.

## STANDING RULES

1. DRY first: reuse generated JSON-pointer contracts, `components/extraction/question-builder.tsx` repeater patterns, existing `components/ui/` fields, and Plan 02 draft mutations; no field catalog or save stack duplication.
2. No legacy or prototype compatibility. Correct invalid Anchor rail values instead of accepting aliases such as `boxed`.
3. Read `convex/_generated/ai/guidelines.md` before backend work and relevant installed Next.js docs before route/component behavior.
4. Use TDD for pointer transforms, field coercion, collection ordering, validation mapping, and dirty-patch creation. Test semantic state through roles, labels, ARIA, data attributes, and stored values, never class strings.
5. Run `npx pm2 logs convex --lines 5 --nostream` after every backend commit and `npx pm2 logs next --lines 5 --nostream` after every frontend commit. Require `✔ Convex functions ready!` and a recent `✓ Compiled` respectively.
6. Research schema formats and installed form/control APIs before guessing; generated constraints are authoritative.
7. Delegate broad field/donor mapping and isolated editor implementation only after contracts are locked. Main session owns TDD, commits, deviations, and final acceptance.
8. No autosave or mirroring `useEffect`. Create patches in user event handlers; derive values and validation summaries during render.
9. Never push. Local atomic commits only.

## EXECUTION RHYTHM

### Phase A — TDD pure logic

Work in the plan-named `lib/evidence-libraries/configuration/` helpers. Write failing tests one at a time for pointer reads/writes, schema constraint projection, repeater operations, validation-path mapping, and minimal dirty patches. Make each green, refactor, and commit per green.

### Phase B — test after integration units

1. Build shared schema-aware fields and collection editors.
2. Implement identity, institutions, theme, navigation, and footer sections.
3. Implement contact, legal, localization, content, collections, and gap-map sections.
4. Connect explicit save events, inline validation, read-only states, and focused component/browser tests.

Commit per logical unit and close every deployed-tree commit with its pm2 gate.

## COMMIT DISCIPLINE

Use conventional commits scoped with `[plan-04]`. One green per pure-logic commit and one editor/concern per integration commit. Never commit red tests or a broken pm2 deployment. Never bypass hooks. Commit deviations before dependent code. Never push.

## WHEN TO STOP

Stop only when all eleven Plan 04 sections round-trip through the authoritative pointers, explicit saves persist minimal patches, invalid values are accessible and blocked, read-only users cannot mutate, all tests pass, and pm2 is green for every touched tree. You may NOT stop for ambiguity resolvable by re-reading the plan, worry about token usage, or an impulse to check with the user.

## DEVIATIONS

Commit clean work, update Plan 04 with the corrected approach and rationale, commit `docs: [plan-04] revise <section> — <reason>`, then continue. If an essential generated constraint or API is genuinely missing, commit partial work, write `plans/evidence-library-configuration-interface/04-BLOCKER.md`, and stop without inventing a legacy fallback.

## START NOW

1. Read Plan 04 and `00-README.md` completely.
2. Read the generated schema/catalog artifacts and the named field/repeater/draft donors.
3. Read `convex/_generated/ai/guidelines.md` and the relevant installed Next.js form/rendering guide.
4. Run `git status --short --branch`, `npx pm2 logs convex --lines 5 --nostream`, and `npx pm2 logs next --lines 5 --nostream`; require healthy baselines.
5. Begin the first failing JSON-pointer patch test.

Go.
```

## Plan 05 — Discovery and platform editors

```md
# Execute Plan 05

Plan file: `plans/evidence-library-configuration-interface/05-discovery-and-platform-editors.md`
Context README: `plans/evidence-library-configuration-interface/00-README.md`
Dependencies: Plans 01–04 must be merged.
OpenScholar root: `/Users/mcharrad/Documents/Github/openscholar/dev-self`.
Evidence Library root: `/Users/mcharrad/Documents/Github/new-el-optimize` (remote `OpenDevEd/new-el`, grounded branch `openscholar`).

Long-running autonomous task. Expect 9–14 hours. Do not stop mid-plan to ask for confirmation. When details are ambiguous, let the generated schema and catalogs decide valid values, follow existing catalog-rendering and encrypted-secret donors, and document the decision in the commit message.

## STANDING RULES

1. DRY first: reuse Plan 04 shared fields, `components/settings/server-model-section.tsx` catalog derivation, `convex/apiKeys/actions.ts` encryption concepts, and Plan 02 library-scoped credentials. Never duplicate catalog options or expose stored secret values.
2. No legacy/prototype aliases. Reject `fulltext`, `openrouter`, `no-pdf`, processing actions `append` and `replace-system-instruction` (the valid action is `append-system-instruction`), path-bearing base URLs, braced CSS, and non-HTML gap-map URLs.
3. Read `convex/_generated/ai/guidelines.md` before backend work and relevant installed Next.js docs before UI work.
4. Use TDD for catalog filtering, origin-only URL checks, CSS-declaration validation, source/secret state, and patch generation. Assert semantic outcomes, ARIA, and data contracts—not CSS classes.
5. After each backend commit require `npx pm2 logs convex --lines 5 --nostream` → `✔ Convex functions ready!`, and verify new public validators with `npx convex function-spec | rg 'evidenceLibraries'`. After each frontend commit require a recent `✓ Compiled` from `npx pm2 logs next --lines 5 --nostream`.
6. Research catalog/provider and validation behavior in current source or primary docs before guessing.
7. Delegate broad provider/source mapping and isolated editor units after the shared contract is fixed. Main session owns TDD, commits, deviations, and acceptance.
8. No secret/query/form synchronization through `useEffect`. Submit credential changes from explicit events and derive status from Convex query results.
9. Never push. Local atomic commits only.

## EXECUTION RHYTHM

### Phase A — TDD pure logic

Start with pure helpers under `lib/evidence-libraries/configuration/` for origin-only URLs, declarations-only CSS, catalog membership, source-state projection, secret-status projection, and minimal patches. Write one failing test, make it green, refactor, and commit per green.

### Phase B — test after integration units

1. Implement search, filters, citations, and features.
2. Implement exports, sources, services, and AI using generated catalogs; source connection identifiers receive local format/duplicate validation because no listing endpoint exists.
3. Implement analytics, authentication, email, generation, and processing.
4. Wire separate credential commands/status, explicit saves, read-only behavior, and component/browser tests.

Commit each concern separately and run the correct pm2/function-spec gate after every deployed-tree commit.

## COMMIT DISCIPLINE

Use conventional commits scoped with `[plan-05]`. One TDD green per Phase A commit and one logical editor/credential unit per Phase B commit. Never commit red tests, broken deployment logs, or secret plaintext. Never bypass hooks. Commit plan deviations first. Never push.

## WHEN TO STOP

Stop only when all thirteen Plan 05 sections use authoritative catalogs and constraints, `sources` exists, synthetic Meta does not, credentials are separate from config payloads, all behavioral tests pass, deployed validators match, and both relevant pm2 gates are green. You may NOT stop for ambiguity resolvable by re-reading the plan, worry about token usage, or an impulse to check with the user.

## DEVIATIONS

Commit clean work, revise Plan 05 with rationale, commit `docs: [plan-05] revise <section> — <reason>`, then continue. If an essential source/provider API is absent, commit partial work, create `plans/evidence-library-configuration-interface/05-BLOCKER.md`, and stop without a guessed option or compatibility shim.

## START NOW

1. Read Plan 05 and `00-README.md` completely.
2. Read generated catalogs/schema plus the named catalog, credential, and shared-editor donors.
3. Read `convex/_generated/ai/guidelines.md` and relevant installed Next.js docs.
4. Run `git status --short --branch`, then confirm healthy Convex and Next baselines with the required pm2 log commands.
5. Begin the first failing origin-only URL test.

Go.
```

## Plan 06 — Validation, publish, rollback, and handoff

```md
# Execute Plan 06

Plan file: `plans/evidence-library-configuration-interface/06-validation-publish-rollback-handoff.md`
Context README: `plans/evidence-library-configuration-interface/00-README.md`
Dependencies: Plans 01–05 must be merged. Coordinate with the separate Evidence Library integration agent; do not overlap its Crossref/Zenodo work.
OpenScholar root: `/Users/mcharrad/Documents/Github/openscholar/dev-self`.
Evidence Library root: `/Users/mcharrad/Documents/Github/new-el-optimize` (remote `OpenDevEd/new-el`, grounded branch `openscholar`).

Long-running autonomous task. Expect 6–10 hours if the remote activation contract exists. Do not stop mid-plan to ask for confirmation. Follow the authoritative Evidence Library validator/activation contract, immutable revision model, and operation-state design; document any resolvable ambiguity in the commit message.

## STANDING RULES

1. DRY first: in `/Users/mcharrad/Documents/Github/new-el-optimize`, reuse `src/config/library-config/source.ts` (`validateLibraryConfigFile`, `digestLibraryConfig`, `assertLibraryConfigRevisionAdvances`, `LibraryConfigHealth`), `src/config/library-config/activation.ts`, and CLI wrappers `tools/validateLibraryConfig.ts` / `tools/activateLibraryConfig.ts` (`npm run config:validate`, `npm run config:activate`), plus Plan 02 operations/revisions. Do not recreate authoritative validation in OpenScholar.
2. No legacy or fake-success path. If the required remote validation/activation/receipt-and-digest-bearing-health contract does not exist, invoke the explicit blocker protocol; never simulate publication.
3. Read `convex/_generated/ai/guidelines.md` before Convex changes and relevant installed Next.js docs before UI/route changes.
4. Use TDD for canonical serialization, validation-error mapping, publish-state transitions, idempotency, revision matching, rejection, and rollback selection.
5. After every Convex commit require `✔ Convex functions ready!` via `npx pm2 logs convex --lines 5 --nostream` and inspect public validators with `npx convex function-spec | rg 'evidenceLibraries'`. After every frontend commit require a recent error-free `✓ Compiled` via the Next pm2 logs.
6. Inspect the actual Evidence Library checkout, current health contract, and current transport/API before assuming an endpoint, authentication method, or retry behavior.
7. Delegate cross-repository contract auditing, but keep protocol decisions, TDD, commits, plan revisions, and final end-to-end verification in the main session.
8. No publish-on-state-change `useEffect`. Validate and publish only from explicit authorized event handlers/actions; derive operation UI from queries.
9. Never push. Local atomic commits only. Do not edit the Evidence Library repository without separate explicit authorization.

## EXECUTION RHYTHM

### Phase A — TDD pure logic

Work in the plan-named serializer, validation-mapper, and operation-state helpers under `lib/evidence-libraries/configuration/`. Write one failing test at a time for canonical payloads, authoritative issue mapping, idempotency, active-revision confirmation, rejection, and rollback choice. Make each green, refactor, and commit per green.

### Phase B — test after integration units

1. Verify and document the real remote validation/activation/receipt-and-digest-bearing-health transport; block if absent.
2. Implement server-side credential resolution, post-resolution structural/authoritative validation, canonical resolved-manifest digesting, and issue persistence without logging or storing secret material.
3. Implement receipt-first replay handling, publish request/idempotency/operation tracking, and revision+digest active confirmation.
4. Implement rejection, retry, rollback, authorized UI commands, and end-to-end tests using Plan 02's isolated-runtime seed.

Commit each logical unit separately and close each deployed-tree commit with its exact pm2/function-spec gate.

## COMMIT DISCIPLINE

Use conventional commits scoped with `[plan-06]`. Commit each pure-logic green and each transport/state/UI concern separately. Never commit red tests, a broken push to the dev runtime, or fabricated success. Never bypass hooks. Commit deviations before dependent code. Never push.

## WHEN TO STOP

Stop successfully only when every Plan 06 acceptance criterion passes, authoritative validation and activation are real, operation states are recoverable, the active health revision matches the published immutable revision, rollback is proven, tests pass, and all touched-tree pm2 gates are green. Stop blocked only under the documented missing-API protocol. You may NOT stop for ambiguity resolvable by re-reading the plan, worry about token usage, or an impulse to check with the user.

## DEVIATIONS

For a correctable plan issue, commit clean work, revise Plan 06 with rationale, commit `docs: [plan-06] revise <section> — <reason>`, then continue. If the required remote validation/activation/receipt-and-digest-bearing-health contract truly does not exist, commit clean partial work, create `plans/evidence-library-configuration-interface/06-BLOCKER.md` with evidence, attempted paths, and the exact required contract, then stop. Do not add a local-file or fake-publish workaround.

## START NOW

1. Read Plan 06 and `00-README.md` completely.
2. Read `convex/_generated/ai/guidelines.md`, relevant installed Next.js docs, and at `/Users/mcharrad/Documents/Github/new-el-optimize` read `source.ts`, `activation.ts`, the validation/activation CLI wrappers, and the current revision-only health route.
3. Run `git status --short --branch` in OpenScholar and read-only status in Evidence Library; protect both repositories' unrelated work.
4. Run `npx pm2 logs convex --lines 5 --nostream` and `npx pm2 logs next --lines 5 --nostream`; require healthy baselines.
5. Begin by proving whether the remote validation/activation transport exists, then write the first canonical-serialization failing test if it does.

Go.
```

## Plan 07 — Accessibility, browser, and release gates

```md
# Execute Plan 07

Plan file: `plans/evidence-library-configuration-interface/07-accessibility-browser-and-release-gates.md`
Context README: `plans/evidence-library-configuration-interface/00-README.md`
Dependencies: Plans 01–06 must be merged, including a resolved Plan 06 transport rather than a blocker.
OpenScholar root: `/Users/mcharrad/Documents/Github/openscholar/dev-self`.
Evidence Library root: `/Users/mcharrad/Documents/Github/new-el-optimize` (remote `OpenDevEd/new-el`, grounded branch `openscholar`).

Long-running autonomous task. Expect 5–8 hours. Do not stop mid-plan to ask for confirmation. Resolve ambiguities using the actual rendered product, existing Playwright setup, accessibility semantics, current primary documentation, and the plan's acceptance criteria; document the choice in the commit message.

## STANDING RULES

1. DRY first: reuse the repository's Playwright configuration, test helpers, route/auth fixtures, generated contract, and accessible `components/ui/` primitives; do not create a parallel test harness.
2. No legacy acceptance path or knowingly deferred critical defect. Remove dead prototype assumptions and fix owned accessibility failures cleanly.
3. Read `convex/_generated/ai/guidelines.md` for backend fixes and relevant installed Next.js docs before route/render fixes.
4. Use behavioral tests and real browser assertions for keyboard flow, landmarks, errors, focus, responsive layout, permissions, save, publish, rejection, and rollback. Never assert CSS classes; use screenshots only for real visual contracts.
5. After every backend fix require `✔ Convex functions ready!`; after every frontend fix require a recent error-free `✓ Compiled`. The final gate includes build, focused Playwright, pm2 logs, and deployed function spec.
6. Research current accessibility/browser/library behavior before guessing. Reproduce defects in the real interface.
7. Delegate independent browser matrices or accessibility audits, but the main session owns triage, code fixes, commits, deviations, and final acceptance.
8. Do not add application-state `useEffect` while repairing interaction behavior. Prefer native semantics, derived state, events, CSS, and declarative React patterns.
9. Never push. Local atomic commits only.

## EXECUTION RHYTHM

### Phase A — TDD pure logic

For any newly exposed pure behavior defect, add the failing test in the closest `lib/**.test.ts` or state-machine test, make it green, refactor, and commit per green. Do not force browser-only layout behavior into JSDOM.

### Phase B — test after integration units

1. Add the focused configuration Playwright journey and stable semantic selectors.
2. Audit and fix keyboard, focus, landmarks, validation announcements, and read-only semantics.
3. Validate responsive behavior and permitted visual-regression snapshots.
4. Run build, targeted/unit/integration/e2e suites, pm2 gates, deployed function spec, and produce the release evidence.

Commit each logical test/fix unit separately and rerun the appropriate deployed-tree gate after every commit.

## COMMIT DISCIPLINE

Use conventional commits scoped with `[plan-07]`. One reproduced defect and green fix per commit; keep test and behavior change in the same slice. Never commit red tests, broken pm2 state, or hook bypasses. Commit any plan deviation first. Never push.

## WHEN TO STOP

Stop only when every Plan 07 acceptance criterion is evidenced, the complete keyboard and role matrix passes, `npm run build` is green, `npx playwright test e2e/evidence-library-configuration.spec.ts --config=playwright.config.ts` passes, public validators are correct, and both final pm2 gates are green. You may NOT stop for ambiguity resolvable by re-reading the plan, worry about token usage, or an impulse to check with the user.

## DEVIATIONS

Commit clean work, revise Plan 07 with the changed acceptance strategy and rationale, commit `docs: [plan-07] revise <section> — <reason>`, then continue. For a true external or pre-existing blocker, commit clean partial work, create `plans/evidence-library-configuration-interface/07-BLOCKER.md`, and stop without weakening the release gate.

## START NOW

1. Read Plan 07 and `00-README.md` completely.
2. Read the current Playwright config/helpers, relevant installed Next.js docs, Convex guidelines if backend fixes are possible, and every prior plan's acceptance criteria.
3. Run `git status --short --branch`; preserve unrelated work.
4. Run `npx pm2 logs convex --lines 5 --nostream` and `npx pm2 logs next --lines 5 --nostream`; a stuck baseline blocks all later commits.
5. Begin the real browser happy-path test from authorized route entry through draft validation and publish confirmation.

Go.
```
