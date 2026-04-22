<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

The convex and next development servers are running in pm2: you can and SHOULD consistently check the logs there.

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
8. Acceptance criteria
9. Known pitfalls

Optional sections such as `Context`, `Why now`, `Deviations`, or post-execution notes are fine when they add real value, but the core sections above are not optional.

### Required `PROMPTS.md` contents

`PROMPTS.md` contains one copy-paste execution prompt per numbered plan so another agent can execute the work without re-deriving intent from scratch. If there are standing rules for that plan set, repeat them in the PROMPTS.md preamble so each per-plan prompt inherits them. Every per-plan prompt MUST be rendered as a single fenced Markdown code block (use an info string like `md`) so the whole prompt can be copied directly in one action. Do not leave the prompt as plain prose sections outside a fenced block.

Each per-plan prompt must follow this template, in this order:

1. **Header** — plan file path, context README path, any plan-dependency call-out ("Depends on plan 0N being merged").
2. **Autonomy framing** — one paragraph naming the expected duration and the autonomy contract. Example: "Long-running autonomous task. Expect X–Y hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns and document the choice in the commit message."
3. **`STANDING RULES` block** — numbered rules. At minimum: DRY with named donors, no legacy, Convex guidelines override training, testing doctrine, research before guessing, delegate to subagents. Add plan-specific rules (auth reuse, package reuse, i18n, etc.) as additional numbered entries.
4. **`EXECUTION RHYTHM` block** — split into Phase A (TDD, pure logic only, with module path and "commit per green") and Phase B (test-after, numbered units, "commit per logical unit").
5. **`COMMIT DISCIPLINE` block** — see § Commit discipline.
6. **`WHEN TO STOP` block** — explicit stop criteria and explicit "You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user".
7. **`DEVIATIONS` block** — the deviation protocol (see § Blocker and deviation protocols).
8. **`START NOW` block** — numbered boot steps (read plan, read README, read Convex guidelines, `git status` check, begin R1 / first unit).
9. Close with `Go.` on its own line.

The prompts must be self-contained: a fresh `/clear`'d session consuming only the prompt plus the files it references must be able to execute the plan without the prior conversation.

### Grounding is mandatory

Plans must be grounded in the actual codebase and current documentation, not in memory and not in vibes.

1. Read the relevant source first and document what is being reused so the plan stays DRY.
2. Use the relevant skill whenever the task matches one. Skills are not optional decoration; they are the fastest route to the repo's expected workflow and best practices.
3. If something is "likely", "probably", or "I think", stop and ground it. Use `find-skills` to see whether there is a better workflow, use `context7` or primary docs for library/framework behavior, and use web research when the information may have changed.
4. For Next.js work, read the relevant guide in `node_modules/next/dist/docs/` before planning or coding.
5. For Convex work, read `convex/_generated/ai/guidelines.md` before planning or coding.
6. Check pm2 logs when they can confirm real runtime behavior.

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

**Never write tests that assert on CSS class strings, Tailwind utilities, or inline style values from source.** These are round-trip tests: the literal string in the `.tsx` flows through React → JSDOM → your regex, which tests nothing. They don't verify the browser actually clamped, colored, or sized anything — only that the string you pasted into the component is the string React rendered. They break on any cosmetic refactor (`text-destructive` → `text-red-600`) while the user-visible behavior is identical.

### Concretely, do not do this

```tsx
// ❌ asserting on Tailwind strings
expect(el.className).toMatch(/text-amber-600/);
expect(el).toHaveClass("flex-col", "h-6", "w-6");
expect(el.className).toContain("border-l-emerald-500");

// ❌ asserting on inline-style round-trips of your own constants
expect(dot.style.backgroundColor).toBe(`var(${SOURCE_COLOR_VAR[source]})`);

// ❌ asserting on layout classes that JSDOM cannot actually measure
expect(title.className).toMatch(/line-clamp-2/);
```

### Do this instead

1. **Test the semantic state**, not its CSS expression. If the component's behavior is "warn the user when at 90% of capacity", assert on the *warning message text* (`screen.getByRole("status")` + `toHaveTextContent(/approaching/i)`), not on the tint color class.
2. **Expose behavioral contracts via `data-*` or ARIA.** When a component's state is internally meaningful but only surfaces visually, add `data-capacity-state="near"`, `data-color-role="green"`, `data-source="history"`, or `aria-pressed={isSelected}` to the element — then assert on those attributes. The attribute becomes a real, refactor-stable contract.
3. **Push pure logic out of the render tree and unit-test it directly.** Threshold → color-role is a pure function; test it in a `lib/**.test.ts` file. The component's job is just to apply the resulting role; the class mapping is implementation.
4. **Visual layout (clamping, truncation, alignment) goes in visual-regression tests**, not JSDOM unit tests. JSDOM has no layout engine — asserting `toMatch(/line-clamp-2/)` doesn't prove the text wraps.
5. **Prefer `getByRole`, `getByText`, `getByLabelText`.** These are the accessibility tree — the same contract your users (and screen readers) actually consume.

### When a test is unavoidably about a class, something is wrong upstream

If you find yourself reaching for `.className.toMatch(...)` it usually means the source component is hiding a behavioral contract inside a CSS string. Fix the source — add a `data-*` or ARIA attribute that expresses the state — then test that attribute. The test becomes stable and the component becomes more scriptable.
