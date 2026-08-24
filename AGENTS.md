## Rule zero: write for normal people

This is the most important rule in this file. Use plain, everyday language in every reply, plan, pull request, issue, document, commit message, code comment, error message, and piece of interface text. Write so that someone without a technical background can understand it on the first read.

1. Start with the answer or the next action. Do not start with a preamble.
2. Use short sentences and common words. If a technical term is necessary, explain it in plain language.
3. If there is more than one step, use a numbered list with no more than five items. Keep each step to one clear action.
4. Say what is done, what is happening now, and the one next action. Use concrete time estimates when time matters.
5. Remove tangents, repeated summaries, vague wording, corporate language, academic language, metaphors, and unnecessary detail. For errors, say what failed, why it failed, and how to fix it.

### Examples

| Bad | Good |
|---|---|
| “The provider-neutral transactional ingestion foundation has been implemented.” | “The library can now import records from different sources without creating duplicates.” |
| “The operation failed because of an upstream provider conflict.” | “Zotero changed after we loaded the record. Reload it, compare the changes, and try again.” |
| “This milestone is materially complete based on the implementation evidence.” | “This milestone is done. All three issues are closed and tested.” |
| “We should operationalize the remaining deployment concerns.” | “Next: test creating a new library on the development server.” |
| “The system persists canonical state while asynchronously projecting derived search documents.” | “PostgreSQL stores the real record. Meilisearch receives a searchable copy in the background.” |

Before sending or publishing anything, reread it once and simplify it. These rules are always active, even when the `i-have-adhd` skill was not explicitly requested.

## Four rules that always apply

1. **Reuse before building.** Search the repository first. Extend an existing component, helper, API contract, fixture, or workflow when it already solves part of the problem.
2. **Check facts instead of guessing.** Words such as “likely,” “possible,” “probably,” and “I think” mean you need to stop and check. Use `find-skills`, the right installed skill, current official docs, library source, and web research.
3. **Do not keep old behavior.** This project is still in testing. Make clean breaking changes, delete replaced code, and do not add compatibility layers or fallback paths unless the user asks for them.
4. **Do not interrupt work over secrets.** The user accepts environment values appearing in terminal output and agent history. Do not rotate keys, lecture about exposure, or add redaction work unless asked.

## What this repository owns

This repository is **OpenScholar**. It is more than academic search. It covers research discovery, literature reviews, screening, data extraction, source-based chat and synthesis, evidence organization, and publishing to public Evidence Libraries.

OpenScholar is also where people and organizations will pay for, create, configure, and manage their Evidence Libraries.

The Evidence Library runtime lives in `OpenDevEd/new-el` on branch `main`. It owns the public library, the `/admin` record editor, published records, files, runtime configuration, search indexing, source imports, and Zotero writeback.

Do not rebuild Evidence Library runtime features here. The repositories must talk through a clear API that is authenticated, versioned, and safe to retry.

The active branch in this repository is `dev`.

## Read Outline before product or roadmap work

The shared knowledge base is the **OpenScholar** collection in Outline.

### Main pages

- Collection: `16480726-288c-42f7-9912-5047444585c9`
- Start here: `cc243a51-87ec-4137-869e-0e791f6161f4`
- OpenScholar current state: `6dcc7403-a39f-4922-8a6c-a5c7b2a900dd`
- Product boundaries: `ff5168e3-7289-42b2-a3e4-a07401fcfce1`
- Integration contract: `ff15f65c-bf85-48b3-baf5-e849f85cde41`

### More pages

- Current decisions: `636ce019-6fe6-4a4e-918b-95e0912cc92d`
- Development runbooks: `30b7169b-1530-424a-a374-80478d1bee56`
- Knowledge-base rules: `81d7111b-d75c-46d2-9229-e1eb44934195`

For product, architecture, roadmap, or cross-repository work:

1. Check that the Outline MCP server works.
2. Read the Start page.
3. Read the OpenScholar current-state page.
4. Read only the other pages needed for the task.
5. Check claims about current behavior against this branch, tests, remote Convex logs, and the running app.

If Outline is down, continue only when the repository gives you enough information. Say clearly that Outline could not be read. Never claim an Outline update worked until you read the page again.

## Keep Outline accurate

Outline stores shared facts, not a copy of every commit. After a verified change is pushed, update the smallest existing Outline page when the change affects:

- a product or architecture decision;
- which repository owns something;
- what is actually built;
- a supported development or support process; or
- deployment setup or roadmap meaning.

Search before creating a page. Update the existing main page instead of making a duplicate. Include the date, repository, branch, commit, and proof. Keep old decisions and explain why they changed. Do not document work that is still uncommitted.

## Which source wins

When two sources disagree, use this order:

1. The user’s latest instruction.
2. Current branch code, tests, commit history, and verified runtime behavior.
3. Current Outline decisions.
4. The relevant product roadmap.
5. Old plans, prototypes, transcripts, and audits.

The BeeWriter `roadmap.qmd` is still the main Evidence Library and self-service roadmap. Ignore its obsolete warning. In that roadmap, the “subscription website” means OpenScholar. `roadmap-v2.qmd` is a smaller Discover-to-Publish pilot, not a replacement for the full roadmap.

The old rule that branch-only work “does not exist” was only used to rebuild a clean GitHub milestone list from `main`. It is not a general progress rule. Read OpenScholar progress from `dev` and Evidence Library progress from `new-el/main`.

Zotero sync and writeback already work in `new-el/main`. This includes source collection membership writeback. Never plan them as untouched future work.

<!-- BEGIN:nextjs-agent-rules -->
## Check the installed Next.js docs

This Next.js version has breaking changes. Do not rely on memory. Before changing a Next.js API, route, cache rule, request rule, or file layout, read the matching guide under `node_modules/next/dist/docs/`.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->
## Read the Convex rules first

Convex is the backend. Before changing Convex code, read `convex/_generated/ai/guidelines.md`. Those rules override anything remembered from training.

Install extra Convex agent files with:

```sh
npx convex ai-files install
```
<!-- convex-ai-end -->

## Development uses hosted Convex services

Convex and Clerk stay hosted. Never start a local Convex backend or use PM2 for this repository.

### Merged integration work

`/Users/mcharrad/Documents/Github/openscholar/dev-self` is the integration checkout. It is the only checkout allowed to upload to the shared self-hosted development deployment.

The integration owner uses these commands:

```sh
npm run dev          # remote Convex watcher and logs, plus local Next.js
npm run dev:web      # local Next.js only
npm run convex:push  # upload Convex functions once, then exit
npm run logs:convex  # stream remote function logs; stop with Ctrl-C
```

The wrapper refuses any Convex URL except `https://convex.opendev.space` and requires the `openscholar-dev` admin key. The matching HTTP-actions URL is `https://convex-site.opendev.space`. The remote dashboard is `https://convex-dashboard.opendev.space`.

Use the Convex log command or dashboard for function errors, data, schedules, and deployed functions. Use Coolify service `m6kbbm36nkb9anjt5vfc6e4e`, sub-service `backend`, only for container, network, disk, or startup failures. Other Coolify services have similar names. Do not use them.

Read the last 200 backend container lines through the supported Coolify API:

```sh
coolify_token_for_logs="$(coolify context list --format json 2>/dev/null | jq -r '.[] | select(.default == true) | .token')"
curl -sS -H "Authorization: Bearer $coolify_token_for_logs" "https://coolify.opendeved.net/api/v1/services/m6kbbm36nkb9anjt5vfc6e4e/logs?sub_service_name=backend&lines=200&show_timestamps=true" | jq -r '.logs'
```

Tests passing does not prove that the remote deployment or running app accepted the change.

### Parallel agent work

An implementation agent works from a stable Git worktree and receives one named Convex Cloud development deployment. The agent may upload only to that deployment. It must not select or change the shared self-hosted deployment, another agent's deployment, the Convex production deployment, or another Coolify application.

Each agent worktree has its own `.env.local` with its assigned `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and `NEXT_PUBLIC_CONVEX_SITE_URL`. Clerk remains hosted and uses the same development Clerk instance. Do not copy `CONVEX_SELF_HOSTED_URL` or `CONVEX_SELF_HOSTED_ADMIN_KEY` into an agent worktree.

Use these commands in an agent worktree:

```sh
npx convex dev --once      # upload once to the assigned cloud deployment
npx convex logs --history 200
npm run dev:web            # run the local Next.js app
```

The integration owner creates agent deployments, gives each one an expiry date and usage limit, and removes it after the workstream is merged. Only the runtime workstream may create uniquely named test libraries in the development Coolify environment. Other workstreams test the Evidence Library locally and must not change Coolify.

After a PR merges, the integration owner uploads merged `dev` through `npm run convex:push` from `dev-self` and checks the shared deployment. Agents do not upload their feature branches to the shared deployment.

Any PM2 command or conflicting deployment instruction in an older plan is stale. Update that plan before executing it.

## Do not use `useEffect` for app state

`useEffect`, `useLayoutEffect`, and `useInsertionEffect` are blocked by default.

### Never use an effect for these

Do not use an effect to sync state with the URL, route, query string, or pathname. Do not use one to copy props or server data into local state, calculate one state value from another, fetch app data, or fire a mutation after state changes.

Do not use an effect to copy form data into another store, copy Convex data into local state, or initialize state from props, server data, Convex, or `nuqs`.

Do not build chains whose only job is to “make state reactive.” Do not use effects to manage filters, tabs, pages, sorting, dates, modals, or drawers.

Do not fire toasts, analytics, or telemetry because watched state changed. Fire them in the action that caused the change.

Do not subscribe to a ref, a Convex query result, or a value you can calculate during render.

### Effects are allowed only for outside systems

An effect may be used for:

- browser event subscriptions with matching cleanup;
- third-party widgets that control a DOM element;
- timers and browser observers; or
- focus, scrolling, or text selection when React has no direct option.

Even then:

1. Add complete cleanup.
2. Use a complete dependency list. Never disable the dependency lint rule.
3. Put the effect in the smallest component or custom hook.
4. Add one short comment naming the outside system and why an effect is needed.
5. Never use it to call a Convex mutation, update `nuqs`, navigate, or mirror another value into state.

### Use these instead

- Put URL-backed filters, tabs, pages, date ranges, modals, and sort order in `nuqs`.
- Calculate values from props, server data, Convex data, or URL state during render. Do not add `useMemo` unless measurements show that it is needed.
- Use Convex `useQuery` for live backend data.
- Load data with Server Components, route loaders, Convex `useQuery`, or React 19 `use()`.
- Run submit and click work in the handler that received the submit or click.

For shared state, lift it, use context, or use a Convex query or mutation. For animations, use CSS, view transitions, `useTransition`, or `useDeferredValue`.

### Review rules for effects

Every new effect is a design change. Explain it in the commit or pull request. Name the outside system and link to the doc or library issue that proves an effect is needed.

Reject any effect that does not clearly match the allowed list. “The refactor is hard,” “the old code did it,” “we can clean it later,” and “it works” are not reasons.

When editing a file, remove old effects that break these rules. Plans must follow the same rule. If you cannot find a no-effect solution after reading the code and docs, stop and ask.

## How to write a large plan

Put a large plan in `plans/<kebab-case-topic>/`.

Every plan folder needs:

1. `00-README.md`
2. Numbered plans such as `01-topic.md`
3. `PROMPTS.md`

Add another file only when it has a clear job, such as `MEASUREMENT.md` or `01-BLOCKER.md`.

### What goes in `00-README.md`

Explain the problem, fixed decisions, plan list, dependencies, existing code to reuse, test rules, migration choice, agent use, and sources.

### What goes in each numbered plan

Explain the goal, scope, design, test-first steps, and files that will change.

Also include the migration choice, exact tests, deployment check, completion rules, and known risks.

If the plan touches `convex/`, `app/`, or `components/`, add a **Deployability gate**. Name the exact remote or browser check and the success result.

For Convex, use:

```sh
npm run convex:push
```

The success line is `✔ Convex functions ready!`.

For Next.js, start the web app in the foreground:

```sh
npm run dev:web
```

Open the changed page in a browser. The terminal must show a successful compile with no module, type, compile, or unhandled errors. Stop the process when the check is done.

### What goes in `PROMPTS.md`

Write one complete copyable prompt for each numbered plan. Put each prompt in one fenced Markdown block. A fresh session must be able to run it using only the prompt and the files it names.

Start each prompt with:

1. The plan path, README path, and any plan it depends on.
2. A clear time estimate and instructions to keep working without asking unnecessary questions.
3. A numbered `STANDING RULES` block covering reuse, no legacy code, Convex rules, tests, remote deployment checks, research, and agent use.
4. An `EXECUTION RHYTHM` block: test-first pure logic, then test-after integration work, with a commit after every working unit.

Finish each prompt with:

1. A `COMMIT DISCIPLINE` block using the rules below.
2. A `WHEN TO STOP` block. Do not stop for an answer that is already in the plan, token worry, or the urge to ask the user. The remote deployment and browser checks must pass before stopping.
3. A `DEVIATIONS` block using the change-of-plan rules below.
4. A `START NOW` block that reads the plan and README, reads Convex rules when needed, checks `git status`, confirms no other Convex uploader is running, and starts the first unit.
5. `Go.` on its own line.

## Plans must use real evidence

Read the code before writing the plan. Name the exact files, helpers, and components that should be reused.

Use the right skill when the task matches one. If you write “likely,” “probably,” or “I think,” stop and check. Use `find-skills`, `context7`, official docs, library source, and web research.

For Next.js work, read `node_modules/next/dist/docs/`. For Convex work, read `convex/_generated/ai/guidelines.md`.

Check the remote Convex logs and the local Next.js terminal before, during, and after work that can affect the running app. A plan based on memory or guesses is not ready.

## Decide whether tests are required

Before creating, changing, deleting, or reviewing any test or assertion, use
the `test-decision` skill and read
[`docs/test-quality.md`](docs/test-quality.md).

Do not add or change tests for copy-only, style-only, comment-only,
documentation-only, or behavior-preserving refactor changes. Run the existing
checks and inspect the real result instead. Exact wording needs a test only when
the wording is itself a lasting legal, security, accessibility, or protocol
contract.

When behavior, data, authentication, an API, accessibility, or plain logic
changes, add or update the smallest honest behavior test in the same change.
For new plain logic, use red → green → clean up. Put logic in testable helpers.

Tests should check behavior, visible text, roles, labels, ARIA, `data-*` values, database state, API responses, or real service state. Do not test CSS class names.

Every plan must name the exact unit, integration, benchmark, smoke, or browser tests that prove it works.

Do not call work complete until the right checks pass. If a required test cannot
run, say which test and why.

## Check that the running app accepted the change

Passing Vitest and TypeScript does not prove that the remote Convex deployment or local browser accepted the code.

### After a Convex commit

1. Run `npm run convex:push` from `dev-self`.
2. Confirm it ends with `✔ Convex functions ready!` or the same clear success.
3. Run the changed function or browser flow against the remote deployment.
4. Use `npm run logs:convex` during that check and confirm there is no matching failure. Stop the log stream with `Ctrl-C`.

Common Convex failures:

- Convex file paths may contain only letters, numbers, underscores, and periods. Hyphens fail. Use names such as `openrouterFetch.ts` and `sourceReadModel.ts`.
- When a function returns a new field, add that field to its `returns` validator. Type generation can pass while Convex silently removes the field from real responses.
- Changing function arguments or return validators can break clients with an open `useQuery`. Plan the change before deploying it.

### After an `app/` or `components/` commit

1. Run `npm run dev:web` from `dev-self`.
2. Open the changed page and test the real browser behavior.
3. Confirm the terminal has no `Module not found`, type error, compile failure, or unhandled error. Stop the process afterward.

### Every matching plan must include this

- Add a `Deployability gate` with the exact remote or browser command and expected result.
- Put the same check in the plan’s completion rules.
- For a new public Convex function, check the deployed function definition and its real validator.

Any agent that changes `convex/` or `app/` must run the matching remote or browser check before reporting success. “Tests pass” is not enough.

## Git rules

- Use one of these commit prefixes: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, or `style`.
- Add `[plan-NN]` to every plan commit. Example: `feat(chat): [plan-04] add sources panel keyboard hook`.
- For test-first work, commit after each green test step.
- For integration work, commit each clear unit separately.
- Never commit while relevant tests are failing.

Never use `--no-verify`, `--no-gpg-sign`, or another hook bypass. Do not push unless the user clearly asks.

Commit a plan change before any code that depends on it. Use: `docs: [plan-NN] revise <section> — <reason>`.

## When work is blocked or the plan is wrong

### A real blocker

If a required API does not exist, or an existing bug makes safe work impossible:

1. Commit the safe work already done.
2. Write `plans/<topic>/NN-BLOCKER.md` with the problem, what was tried, and what would unblock it.
3. Stop. Do not hide the problem with a workaround.

### The plan is wrong

If the plan is wrong but the better path is clear:

1. Commit safe work already done.
2. Update the numbered plan and explain why.
3. Commit the plan change with `docs: [plan-NN] revise <section> — <reason>`.
4. Continue from the corrected plan.

Never change direction silently. Fix the plan in Git first.

## Use other agents to protect the main session

If an investigation needs more than about three file reads or three searches, use another agent. This keeps large search output out of the main session.

Use:

- `Explore` for finding definitions, callers, and imports. Say whether the search should be quick, medium, or very thorough;
- `general-purpose` for several-step research, docs, library source, or isolated implementation; and
- `Plan` for a difficult planning subproblem.

Good work to hand off includes mapping callers, reading a library contract, comparing several files, checking current external docs, and building an isolated module after its contract is clear.

Keep the test-first coding loop, commits, plan edits, final checks, and tiny searches in the main session.

Start independent agents together in one message so they can run at the same time. A new agent has no context, so give it:

1. The repository path.
2. What has already been tried.
3. The exact answer format, including file and line references when needed.
4. Whether it may edit code or must only research.

An agent that changes `convex/` or `app/` must finish by running the matching remote or browser check and reporting the exact result.

If the main session becomes too full and quality drops, pause. Commit safe work, add a short resume note to the plan, run `/clear`, and restart from the matching prompt in `PROMPTS.md`.

## Development data can be deleted

This project is still in testing. The Convex database is a development database. Treat schema changes as breaking by default.

1. Do not keep old fields, optional fallbacks, compatibility reads, or widen-then-narrow migrations.
2. If new validation rejects development rows, wipe the affected tables through the Convex dashboard or a development-only admin function.
3. Do not add `@convex-dev/migrations`, backfill scripts, or code that preserves old development rows.
4. If a production database is added later, write a real migration then.

A plan may say “no migration” for an additive change. The default remains: clean breaking change, disposable development data.

## Test behavior, not CSS text

Never write a test that checks Tailwind classes, CSS class strings, or inline style text. That only proves the source string reached JSDOM. It does not prove the browser looks right.

### Bad tests

```tsx
expect(el.className).toMatch(/text-amber-600/);
expect(el).toHaveClass("flex-col", "h-6", "w-6");
expect(title.className).toMatch(/line-clamp-2/);
```

### Good tests

1. Check the meaning: `getByRole("status")` and visible text.
2. Add a stable ARIA or `data-*` value when the UI has a real state.
3. Move plain logic into a helper and unit-test the helper.
4. Use Playwright or screenshots for layout, clipping, spacing, and color.
5. Prefer `getByRole`, `getByText`, and `getByLabelText`.

If you feel forced to check a class name, the component is probably hiding a real state. Expose that state through ARIA or `data-*` and test it instead.

These rules also apply to plans, including plans under `.agents/audit/plans/`. Plans must describe visible behavior, accessibility, data, or real service checks. They must never ask an agent to assert a Tailwind class.
