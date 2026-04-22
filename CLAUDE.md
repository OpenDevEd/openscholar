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

`PROMPTS.md` must contain copy-paste execution prompts for each numbered plan so another agent can execute the work without re-deriving intent from scratch. If there are standing rules for that plan set, repeat them there explicitly.

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
