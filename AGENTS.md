## Ultimate rules

1. **DRY first.** Before implementing anything, search the codebase for an existing component, helper, contract, test fixture, or workflow that can be extended or repurposed.
2. **Research before guessing.** Words such as "likely", "possible", "probably", and "I think" are a stop signal. Use the `find-skills` skill, the relevant installed skill, primary/current documentation, library source, and web research before deciding.
3. **No legacy compatibility.** This project is pre-testing. Prefer clean breaking changes, remove obsolete paths, and leave no dead code, compatibility shims, dual behavior, or feature-flag fallback unless the user explicitly changes this rule.
4. **Do not derail work over secrets.** The user accepts environment values appearing in agent history and terminal output. Do not rotate keys, lecture about exposure, or add redaction work unless requested.

## Product identity and repository boundary

This repository is **OpenScholar**, not merely an academic search engine. OpenScholar supports research discovery, literature reviews, screening, data extraction, source-grounded chat and synthesis, evidence organization, and publishing to public Evidence Libraries. It is also the intended subscription and control-plane surface through which users and organizations create, configure, provision, and operate those libraries.

The complementary Evidence Library runtime is developed in `OpenDevEd/new-el` on branch `openscholar`. That repository owns the public library, record-and-metadata `/admin`, canonical published records, files, runtime manifests, search projection, source synchronization, and Zotero writeback. Do not reimplement those runtime responsibilities here. Cross-repository publishing must use an explicit authenticated, versioned, idempotent contract.

Active development branch for this repository: `dev`.

## Outline knowledge base — required project context

The shared durable knowledge base is the **OpenScholar** collection in Outline.

- Collection ID: `16480726-288c-42f7-9912-5047444585c9`
- Start document: **00 — Start Here: OpenScholar Agent Map**
- Start document ID: `cc243a51-87ec-4137-869e-0e791f6161f4`
- OpenScholar current state: `6dcc7403-a39f-4922-8a6c-a5c7b2a900dd`
- Product boundaries: `ff5168e3-7289-42b2-a3e4-a07401fcfce1`
- Integration contract: `ff15f65c-bf85-48b3-baf5-e849f85cde41`
- Current decisions: `636ce019-6fe6-4a4e-918b-95e0912cc92d`
- Development runbooks: `30b7169b-1530-424a-a374-80478d1bee56`
- Knowledge-base protocol: `81d7111b-d75c-46d2-9229-e1eb44934195`

At the start of product, architecture, roadmap, or cross-repository work:

1. Confirm the Outline MCP server is connected.
2. Read the Start document by ID.
3. Read the OpenScholar current-state page.
4. Read only the additional pages relevant to the task.
5. Cross-check implementation and deployment claims against this branch, tests, pm2 logs, and the live runtime.

If Outline is unavailable, continue only when repository-local context is sufficient and explicitly report that the knowledge base could not be read or updated. Never claim an MCP write succeeded without re-reading it.

## Knowledge-base write requirement

Outline must track durable shared truth, not every commit. After an authorized change is verified and pushed, update the smallest canonical Outline page when the work changes:

- a product or architecture decision;
- repository ownership or a cross-repository contract;
- actual implementation status;
- a supported development or operational workflow;
- deployment topology; or
- roadmap interpretation.

Search before creating a page. Update the canonical document instead of creating duplicates. Record the date, repository, branch, commit, and verification evidence. Preserve superseded decisions and their rationale. Do not document uncommitted experiments or let Outline get ahead of Git.

## Authority and roadmap interpretation

When sources conflict, use this order:

1. the user's current explicit instruction;
2. active branch code, tests, committed history, and verified runtime;
3. current Outline decisions;
4. the applicable product roadmap;
5. delivery plans, prototypes, transcripts, historical audits, and superseded material.

The BeeWriter `roadmap.qmd` remains the Evidence Library/self-service product roadmap despite its obsolete callout; the user explicitly rejected that callout. In that roadmap, the “subscription website” is OpenScholar. `roadmap-v2.qmd` is a narrower Discover-to-Publish pilot programme and does not replace the broader product roadmap.

The rule that branch-only work “does not exist” applied only when constructing a clean GitHub milestone baseline from `main`. It does not apply to current engineering status. Report OpenScholar progress from `dev`; report Evidence Library progress from `new-el/openscholar`.

Zotero Sync and Zotero Writeback, including source collection-membership writeback, already exist in `new-el/openscholar`. Never plan them as untouched future work.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

The convex and next development servers are running in pm2: you can and SHOULD consistently check the logs there.

## `useEffect` is banned by default

`useEffect` is a code-review blocker in this repository. It is banned for every form of application-state work. The default presumption is that any new `useEffect` you reach for is wrong, and the burden of proof is on the author to show it is one of the narrow allowed cases below. The ban applies identically to `useLayoutEffect` and `useInsertionEffect`.

### Hard-forbidden — never ship these

These uses are rejected on sight, regardless of how clean the diff is, how short the effect is, or how confident the author feels:

- Synchronizing local state to the URL, query string, route params, or pathname.
- Synchronizing URL/query/route values back into local state.
- Mirroring props into local state. Derive on render or lift state.
- Deriving one piece of state from another piece of state. Compute it during render.
- Fetching application data after render. Use Convex queries, Server Components, or route loaders.
- Firing mutations because state, props, URL, or Convex data changed. Handle it in the event handler that caused the change.
- Mirroring form state into another store, store data into local state, or Convex data into local state.
- Initializing app state from props, server data, Convex data, or `nuqs`. Read directly.
- "Make it reactive" effect chains, "after-render fixups", "observable bridges", or anything whose only job is to keep two pieces of state in sync.
- Reaching for `useEffect` to coordinate a query, filter, tab, pagination, sort order, modal open/close, drawer state, or month/date window. That state belongs in `nuqs` or a parent.
- Toast/analytics/telemetry firing on state change. Fire it in the handler that triggered the change.
- Subscribing to a ref, a Convex query result, or a derived value. None of these need an effect.

If your `useEffect` is doing any of the above, delete it. There is always a non-effect solution in this stack — derived values during render, event handlers, Convex subscriptions, `nuqs`, Server Components, route loaders, Suspense, or React 19 `use()`.

### Narrowly allowed — only true external side effects

`useEffect` is permitted **only** for genuine outside-React side effects with setup/teardown that React cannot model declaratively:

- Browser-only subscriptions that require explicit `addEventListener` / `removeEventListener` pairing, and only when no higher-level abstraction or library hook already exists.
- Imperative third-party DOM integrations (charts, maps, editors, video players) that own a DOM node lifecycle React does not control.
- Timers, `IntersectionObserver`, `ResizeObserver`, `MutationObserver`, and similar platform APIs that are inherently side-effectful.
- Low-level focus, scroll restoration, or selection management with no declarative equivalent.

Even when allowed, the effect MUST:

1. Have a complete, correct cleanup function. No exceptions, including for "one-shot" subscriptions.
2. Have an exhaustive dependency array. **Never** add `// eslint-disable-next-line react-hooks/exhaustive-deps` or any equivalent suppression.
3. Live in the smallest leaf component or a dedicated custom hook — never in a page, layout, route segment, or feature root.
4. Carry a one-line comment naming the external system it is bridging and why no declarative alternative exists.
5. Not call a Convex mutation, a `nuqs` setter, a router push, or a setState that mirrors another reactive value.

### Review and enforcement

- Adding a new `useEffect` is a structural change. Justify it in the commit/PR body, name the external system being bridged, and cite the doc or library issue that proves no declarative alternative exists.
- Any `useEffect` a reviewer cannot map to one of the allowed external systems above is rejected. "Refactor is hard", "this is how the old code did it", "we'll clean it up later", and "it works" are not justifications. This project carries no legacy.
- Existing `useEffect` calls encountered during work in a file are fair game — and expected — to be removed in the same commit when they fall under the forbidden list. Do not preserve them out of caution.
- Plans must not prescribe `useEffect` for any of the forbidden cases. A plan that does is itself a deviation and must be revised in git before execution proceeds.

### What to use instead

- URL-backed filters, tabs, pagination, month windows, modal open/close, sort orders, anything shareable: **`nuqs`**.
- Anything derivable from props, server data, Convex data, or URL state: **derive it during render**. No effect, no `useMemo` unless measured.
- Reactive backend state: **Convex `useQuery`** subscriptions.
- Data loading: **Server Components**, **route loaders**, **Convex `useQuery`**, or React 19 **`use()`**.
- "After click" or "after submit" work: handle it in the **event handler** that triggered it, not in an effect that watches state change.
- Cross-component coordination: **lift state**, use **context**, or use a **Convex** mutation/query — never a `useEffect` watching a piece of state.
- Animations driven by state: CSS transitions, view transitions, or `useTransition` / `useDeferredValue` — not `useEffect` poking `requestAnimationFrame`.

If you cannot map your need to one of the answers above, stop and ask before writing the effect.

## Planning doctrine — exact structure, grounded execution, no guesswork

When work is large enough to justify a plan, create it under `plans/<kebab-case-topic>/` and make it match the repo's established structure exactly.

### Required folder structure

Every plan folder must contain:

1. `00-README.md`
2. One or more numbered execution plans: `01-<topic>.md`, `02-<topic>.md`, ...
3. `PROMPTS.md`

Add extra files only when the work genuinely needs them, for example `MEASUREMENT.md` for benchmark results or `01-BLOCKER.md` for an unresolved blocker that must be handed off explicitly.

### Required `00-README.md` contents

The README is the control document for the whole plan set. It must include, in substance:

1. Motivation or gap audit
2. Locked design decisions with dates when relevant
3. Plan-file inventory
4. Dependency graph
5. Reuse / DRY notes
6. Testing doctrine
7. Migration stance
8. Delegation policy when subagents are used
9. Grounding sources

### Required numbered-plan contents

Each numbered plan file must be execution-ready, concrete, and scoped to one coherent slice of work. Each file must include, in substance:

1. Goal
2. Scope
3. Design
4. TDD sequence
5. Files touched
6. Migration stance
7. Test plan
8. Deployability gate
9. Acceptance criteria
10. Known pitfalls

The **Deployability gate** section is mandatory whenever the plan touches `convex/`, `app/`, `components/`, or any other tree that pm2 actively pushes / compiles. Name the exact command and the exact log line that proves the change actually deployed — for convex changes that's `npx pm2 logs convex --lines 5 --nostream` showing `✔ Convex functions ready!`; for Next.js changes it's `npx pm2 logs next --lines 5 --nostream` showing a recent `✓ Compiled` with no `Module not found` / `Type error`. A plan that touches the backend without a deployability gate is incomplete (see § Deployability is mandatory).

Optional sections such as `Context`, `Why now`, `Deviations`, or post-execution notes are fine when they add real value, but the core sections above are not optional.

### Required `PROMPTS.md` contents

`PROMPTS.md` contains one copy-paste execution prompt per numbered plan so another agent can execute the work without re-deriving intent from scratch. If there are standing rules for that plan set, repeat them in the PROMPTS.md preamble so each per-plan prompt inherits them. Every per-plan prompt MUST be rendered as a single fenced Markdown code block (use an info string like `md`) so the whole prompt can be copied directly in one action. Do not leave the prompt as plain prose sections outside a fenced block.

Each per-plan prompt must follow this template, in this order:

1. **Header** — plan file path, context README path, any plan-dependency call-out ("Depends on plan 0N being merged").
2. **Autonomy framing** — one paragraph naming the expected duration and the autonomy contract. Example: "Long-running autonomous task. Expect X–Y hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns and document the choice in the commit message."
3. **`STANDING RULES` block** — numbered rules. At minimum: DRY with named donors, no legacy, Convex guidelines override training, testing doctrine, **deployability gate (pm2 logs check after every backend-touching commit — see § Deployability is mandatory)**, research before guessing, delegate to subagents. Add plan-specific rules (auth reuse, package reuse, i18n, etc.) as additional numbered entries.
4. **`EXECUTION RHYTHM` block** — split into Phase A (TDD, pure logic only, with module path and "commit per green") and Phase B (test-after, numbered units, "commit per logical unit").
5. **`COMMIT DISCIPLINE` block** — see § Commit discipline.
6. **`WHEN TO STOP` block** — explicit stop criteria and explicit "You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user". Stop criteria MUST include "the pm2 deployability gate is green for every tree the plan touches".
7. **`DEVIATIONS` block** — the deviation protocol (see § Blocker and deviation protocols).
8. **`START NOW` block** — numbered boot steps. At minimum: read plan, read README, read Convex guidelines if convex-touching, `git status` check, **`npx pm2 logs convex --lines 5 --nostream` to confirm the dev push is healthy at boot (a stuck push from prior work blocks every later commit)**, begin R1 / first unit.
9. Close with `Go.` on its own line.

The prompts must be self-contained: a fresh `/clear`'d session consuming only the prompt plus the files it references must be able to execute the plan without the prior conversation.

### Grounding is mandatory

Plans must be grounded in the actual codebase and current documentation, not in memory and not in vibes.

1. Read the relevant source first and document what is being reused so the plan stays DRY.
2. Use the relevant skill whenever the task matches one. Skills are not optional decoration; they are the fastest route to the repo's expected workflow and best practices.
3. If something is "likely", "probably", or "I think", stop and ground it. Use `find-skills` to see whether there is a better workflow, use `context7` or primary docs for library/framework behavior, and use web research when the information may have changed.
4. For Next.js work, read the relevant guide in `node_modules/next/dist/docs/` before planning or coding.
5. For Convex work, read `convex/_generated/ai/guidelines.md` before planning or coding.
6. Check pm2 logs (`npx pm2 logs <convex|next> --lines 5 --nostream`) before, during, and after any change that could affect runtime behavior. The pm2 logs are the only check that proves the dev deployment is actually accepting your code — see § Deployability is mandatory.

A plan that is not grounded in source, skills, and current docs is not an acceptable plan.

### TDD and passing tests are mandatory

TDD is not optional. Neither is a green test run.

1. Push pure logic into testable helpers and write the tests first or as the first implementation step.
2. Prefer behavioral assertions, ARIA, and `data-*` contracts over class-name assertions.
3. Every plan's `Test plan` section must name the exact unit, integration, benchmark, smoke, or e2e coverage that proves the work.
4. Do not call a plan complete until the relevant tests have been run and are passing.
5. If a test cannot be run, the plan or execution log must say so explicitly and explain why.
6. If the implementation changes behavior, update or add tests in the same slice of work rather than deferring them.

Passing tests are part of the deliverable, not follow-up polish.

### Deployability is mandatory

A green vitest run and a clean `tsc --noEmit` do **not** prove the dev deployment is healthy. The convex and next dev servers run in pm2 and can fail to accept your changes silently — the static checks pass, the unit tests pass, and the running app is broken. Every plan and every commit that touches a deployed tree must close the loop with the pm2 logs.

#### After any commit that touches `convex/`

1. Run `npx pm2 logs convex --lines 5 --nostream`.
2. Confirm the most recent line is `✔ Convex functions ready!` (or equivalent success). If the latest lines are `- Preparing Convex functions...` repeating, the push is stuck — fix before continuing.
3. Confirm there is no recent `✖ Error` line. Common silent failures:
   - **File-naming rule**: Convex module paths must contain only alphanumeric characters, underscores, or periods. **Hyphens are rejected.** This repo's convex convention is camelCase (`openrouterFetch.ts`, `sourceReadModel.ts`, `chatPapers/`, `messages.ts`). Match it. Never propose a kebab-case file under `convex/` in a plan or commit.
   - **Stale return validators**: adding a field to a returned object without adding it to the function's `returns` validator silently strips the field on every client call. The TS types still look correct because `_generated/api.d.ts` regenerates; the wire shape doesn't.
   - **Args/return validator changes** mid-deployment: bumping a query's args while clients hold an open `useQuery` will throw on the next reconnect. Plan for it (see § Migration stance).
4. If the convex push is broken, **stop**. Do not commit additional convex changes on top of a broken push — every later commit is a lie until the push recovers, and the failure mode compounds (one bad file blocks every later push, so the next plan inherits a stuck deployment without realising).

#### After any commit that touches `app/` or `components/`

1. Run `npx pm2 logs next --lines 5 --nostream`.
2. Confirm a recent `✓ Compiled` line.
3. Confirm there is no recent `Module not found` / `Type error in` / `Failed to compile` / unhandled-error stack.

#### Plan-level rule

Every plan whose `Files touched` includes `convex/`, `app/`, or `components/` must:

- Define a `Deployability gate` section naming the pm2 command(s) and the success line each is checking for.
- List the deployability check as part of `Acceptance criteria` ("`npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the final commit").
- For convex specifically: explicitly check the **deployed function spec** for any new public query/mutation — if you added a field to a `returns` validator, confirm the deployed validator includes it after push, not just the source.

#### Subagent rule

Any subagent (Executor, Plan, Explore) operating on `convex/` or `app/` files must close its task by running the pm2 check and reporting the result in its returned summary. "Tests pass" is not a complete report; "tests pass AND pm2 logs show `✔ Convex functions ready!` at <timestamp>" is.

A plan that ships green tests on top of a stuck pm2 push is a regression, not progress.

### Commit discipline

Atomic commits are non-negotiable. Every plan execution uses this cadence:

1. Conventional-commit prefix: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, `style`.
2. Scope every plan-related commit with `[plan-NN]`. Example: `feat(chat): [plan-04] add sources panel keyboard hook`.
3. **One commit per TDD green.** Red → Green → Refactor → Commit. Do not batch multiple tests into a single commit.
4. **One commit per logical unit in Phase B.** Schema change, consuming mutation, its test, locale keys — each is a separate commit. One concern per commit.
5. Never commit with tests red. If a pre-commit hook fails, fix the underlying issue. Never use `--no-verify`, `--no-gpg-sign`, or any hook-bypass flag.
6. Do not push to remote unless the user explicitly asks.
7. Plan-file edits (deviations, resume notes) ship as their own commits under `docs: [plan-NN] revise <section> — <reason>` and must land BEFORE any code change that depends on them.

### Blocker and deviation protocols

**Blocker** — when a required API truly does not exist, or a pre-existing bug blocks further progress:

1. Commit all in-progress work cleanly, even if partial.
2. Write `plans/<topic>/NN-BLOCKER.md` describing what is stuck, what was tried, and what would unblock.
3. Stop. Do not improvise a workaround that masks the blocker.

**Deviation** — when the plan itself is wrong or incomplete and a better approach is clear:

1. Commit any in-progress work first.
2. Edit the numbered plan file with the new approach and its rationale.
3. Commit the plan edit under `docs: [plan-NN] revise <section> — <reason>`.
4. Proceed against the revised plan.

Never silently depart from the plan. The plan is the source of truth; if it is wrong, fix the plan in git first, then execute against it.

### Delegation policy — protect the main session's context

Context rot is the silent enemy of long-running plans. Every file read, grep, and tool output pollutes the main session; after enough accumulation, quality degrades. Subagents absorb that pollution in their own context and return synthesized summaries.

**Rule of thumb: any investigation needing more than ~3 file reads or ~3 greps → spawn a subagent.**

#### Agent types

- **`Explore`** — fast codebase exploration: "where is X defined?", "map all callers of Y", "find every importer of Z". Always specify thoroughness: `"quick"`, `"medium"`, or `"very thorough"`.
- **`general-purpose`** — multi-step research, web doc reading, library-source inspection, skill discovery, cross-library synthesis.
- **`Plan`** — subsidiary planning for a non-trivial sub-problem.

#### What to delegate

- "Map every caller / importer / consumer of X."
- Reading a library's source or README to extract a contract.
- Cross-file synthesis ("read these 5 files and explain the data flow").
- External research on API behavior, current library versions, open issues.
- Isolated module implementation after its contract is locked.

#### What to keep in the main session

- The TDD red → green → refactor cycle — needs tight test-runner feedback.
- Commits — main session owns discipline.
- Plan-file edits (deviations, resume notes).
- Final acceptance-criteria verification.
- Trivial one-shot lookups where grep is faster than spawning an agent.

#### Parallelism

When spawning multiple subagents for **independent** questions, put them in a **single message with multiple Agent tool calls**. The harness runs them concurrently.

#### Prompting subagents

A subagent starts with **zero context**. Give it enough to succeed unattended:

- Repo root path.
- What has been tried / ruled out.
- The exact shape of the answer expected ("bulleted list, under 500 words, `file_path:line` citations").
- Whether it should write code or only research.

#### When the session grows stale

If the main session accumulates many tool calls and quality drifts, pause, commit progress, write a one-paragraph resume-note at the bottom of the plan file, `/clear` the session, and re-paste the plan's prompt from PROMPTS.md. Plans are designed to be resumable from any acceptance-criteria checkpoint.

### Migration stance — dev data is disposable

This project is pre-testing. The Convex deployment is a dev database with no production data to preserve. Every schema change is **breaking by default**.

1. Do not widen-then-narrow. Do not keep old fields as optional "just in case". Do not add compatibility shims, feature-flag fallbacks, or legacy read paths.
2. If the schema validator rejects existing rows after a change, wipe the affected tables via the Convex dashboard or a dev-gated admin helper mutation.
3. Do NOT write `@convex-dev/migrations` scripts. Do NOT write backfill scripts. Do NOT preserve old rows.
4. If a production deployment ever exists, re-open every plan's schema-change section and write a proper migration then. Until that day, go fast.

A specific plan's `Migration stance` section may narrow this (e.g. "none — additive only" when the plan ships no schema changes), but the project default is destructive.

## Testing philosophy — assert on behavior, not on source

**Never write tests that assert on CSS class strings, Tailwind utilities, or inline style values from source.** Class-name assertions are round-trip tests — the literal string in the `.tsx` flows through React → JSDOM → your regex, which tests nothing. They don't verify the browser actually clamped, colored, or sized anything. They break on cosmetic refactors while user-visible behavior is identical.

### Forbidden patterns

```tsx
// ❌ these are noise, not tests
expect(el.className).toMatch(/text-amber-600/);
expect(el).toHaveClass("flex-col", "h-6", "w-6");
expect(el.className).toContain("border-l-emerald-500");
expect(dot.style.backgroundColor).toBe(`var(${SOURCE_COLOR_VAR[source]})`);
expect(title.className).toMatch(/line-clamp-2/); // JSDOM can't measure layout
```

### Required approach

1. **Test the semantic state, not its CSS expression.** `screen.getByRole("status")` with `toHaveTextContent(/approaching/i)` beats asserting on a tint class.
2. **Expose behavioral contracts via `data-*` or ARIA.** `data-capacity-state="near"`, `data-color-role="green"`, `data-source="history"`, `aria-pressed={isSelected}` — then assert on the attribute. It becomes a real, refactor-stable contract.
3. **Push pure logic out of components and unit-test it in `lib/**.test.ts`.** Threshold → color-role mapping is a pure function; don't test it through a rendered component.
4. **Visual layout (clamping, truncation, alignment) is a visual-regression concern.** JSDOM has no layout engine. Use Playwright / screenshot tests, not `toMatch(/line-clamp-2/)`.
5. **Prefer `getByRole`, `getByText`, `getByLabelText`.** These query the accessibility tree — the same contract users and screen readers consume.

### When you can't avoid reaching for a class assertion

You're probably hiding a behavioral contract inside a CSS string. Fix the source — add `data-*` or ARIA — then test that. Do not write `.className.toMatch(...)` as a shortcut.

**Applies equally when writing plans.** Phase plans (under `.agents/audit/plans/`) must specify verification criteria in terms of observable behavior (text, role, ARIA, data-attributes, store state). Never prescribe "assert `line-clamp-2` class" or "check `text-destructive` is applied" — that's instructing the executor to write source-round-trip tests.
