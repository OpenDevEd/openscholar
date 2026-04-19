# Chat Sources Toggle — Plan Set

Six-plan rework of the extraction-chat's paper-in-context layer: turn the static "papers locked at job creation" list into a dynamic, per-chat **Sources panel** where every paper can be included or excluded from the LLM context, with search, sort, bulk operations, and proper keyboard/a11y UX. Sliced so each plan ships (and reverts) independently, with explicit dependency arrows.

---

## Motivation

Today the set of papers in an extraction chat is **frozen at `ensureThreadForJob` time**. Every turn sends the entire corpus to the model. There is no way for the user to narrow context mid-chat, which hurts:

- **Answer quality** — a user who has 50 papers but only wants the LLM to ground this question on 3 can't; they must start a new chat and re-upload.
- **Cost / tokens** — every turn pays for the full corpus even when the user knows a subset is sufficient.
- **Workflow** — users naturally progress from "let me pool everything I might need" to "now I want to narrow". The product doesn't support the narrowing.

This plan set makes papers toggleable, adds a first-class **Sources panel** surface, and wires the LLM prompt to honor live inclusion state.

## Design decisions (locked via grill-me dialogue, 2026-04-19)

| # | Decision | Source |
|---|---|---|
| **D1** | Toggle is **forward-only**. Positional IDs `P1..PN` assigned once at source-lock and never renumber; excluded papers are omitted from the prompt but their IDs stay reserved (holes allowed in `<papers>` block). | Q1 |
| **D2** | No per-message snapshot of `includedSourceIds[]`. `chatPapers` is always read **live** at stream-start; regenerate/edit-and-resend use current state. | Q4 revision |
| **D3** | State shape: **bridge table** `chatPapers(jobId, sourceId, included)`. Keeps `extractionJobSources` immutable; isolates toggle writes from the `extractionJobs` hot path. | Q3 |
| **D4** | UI lives in a **renamed, repurposed Sources panel** (rail on desktop, `Sheet` on mobile). Always lists all chat papers; checkbox state ≡ included. Single source of truth. | Q5 |
| **D5** | Bulk ops on current filter view: `Include all`, `Exclude all`, `Invert`. No group-by-source-type buttons (covered by source chips + filter + bulk). Gmail-style "visible-only + extension banner" when header toggles with filter active. | Q6 |
| **D6** | Search over **title + authors + year + abstract + DOI + OpenAlex ID**. Custom weighted cmdk scorer (DOI×5, title×3, authors×2, year×1, abstract×0.5). Inline match-snippet when match is not in title/authors/year. | Q7 |
| **D7** | Source-type chips above search. Single-select. `All · OpenAlex (N) · Uploads (N) · Zotero (N) · History (N)`. | Q7c |
| **D8** | Sort pills: `Added · Title · Year · Source · In-context`. Click pill to activate, click again to reverse. URL-persisted via `nuqs`, per-chat. Sort scopes to current filter view. | Q8 |
| **D9** | Empty-state: **block send** when 0 included. Banner + `[Include all]` CTA. Live composer hint `"14 of 50 sources in context for next message"` always visible. | Q9 |
| **D10** | Regenerate/edit-resend: uses live `chatPapers` state (no snapshot). May materially change the answer, not just retry. | Q10 revision |
| **D11** | Toggle is **allowed during streaming**. Next turn sees new state; current stream already snapshotted at its start. Citations in streaming text re-render to muted as papers toggle off — honest live rendering. | Q11 |
| **D12** | Excluded row styling: `opacity-60` (rest) / `opacity-100` (hover/focus), unchecked box, **no strikethrough**. `data-paper-included` for test targeting. Left-edge checkbox. | Q12 |
| **D13** | Single toggle: optimistic, no undo UI, toast on failure. Bulk op: optimistic, **5s toast with Undo** button, destructive toast on failure. No debounce on rapid clicks. | Q13 |
| **D14** | Seed 1:1 `chatPapers(included=true)` at `ensureThreadForJob`. Cascade on delete. **Duplicate-job carries toggles over** (not a reset). | Q14 |
| **D15** | Row layout: left checkbox / line-clamp-2 title / `First-author et al. · Year · Source chip` / optional match-snippet line. Hover reveals `↗ OpenAlex` / `↗ DOI` icon buttons. No hover card (save those for chat-text citation pills). `data-paper-source` + `data-paper-included` attributes. | Q15 |
| **D16** | Citation pill: tri-state `included / excluded (muted dashed) / unresolved`. Excluded pills stay clickable (metadata + links still resolve); hover card gains a **"Re-include for future turns"** action. Never strikethrough. | Q10 / grill revision |

## Plan files

```
plans/chat-sources-toggle/
├── 00-README.md                       (this file)
├── 01-bridge-table-lifecycle.md       (foundation — schema + seed + cascade + dup)
├── 02-prompt-filter-and-send-guard.md (filter included from prompt, reject empty sends)
├── 03-toggle-mutations-queries.md     (toggle + bulk + list-with-inclusion)
├── 04-sources-panel-ui.md             (search/sort/chips/bulk/keyboard/mobile + composer)
├── 05-citation-tri-state.md           (chat-text citation pill reflects live state)
├── 06-polish-and-tests.md             (animations, a11y audit, E2E, perf at 500)
└── PROMPTS.md                         (one copy-paste execution prompt per plan)
```

## Dependency graph

```
01 bridge-table ─┬─► 02 prompt-filter ─┐
                 │                     ├─► 05 citation-tri-state ─┐
                 ├─► 03 mutations ─────┤                          │
                 │                     └─► 04 sources-panel ──────┼─► 06 polish
                 │                                                │
                 └────────────────────────────────────────────────┘
```

Ship order recommendation: **01 → 02 → 03 → 04 → 05 → 06**. Can parallelize 02 and 03 after 01 lands. 04 needs both 02 (for live-prompt behavior) and 03 (for mutations). 05 needs 03 (reads chatPapers for live citation state). 06 is last.

## Reuse (DRY)

These plans lean hard on primitives the codebase already ships. Primary donors:

- **`components/extraction/bucket/selectable-list.tsx`** — shift-click range, indeterminate header checkbox, `aria-pressed` rows, Space/Enter activation, "select across pages" banner. Plan 04 reuses this as the list primitive; it does **not** re-implement multi-select.
- **`components/extraction/bucket/bucket-paper-row.tsx`** — row chrome with `data-paper-status`, motion layout. Extend with `data-paper-included` + source chip.
- **`cmdk@1.1.1`** — already a dep. Plan 04 uses it for the weighted fuzzy search; no Fuse.js added.
- **`nuqs`** — already used in `components/extraction/source-selector.tsx` for URL-persisted filter state. Plan 04 follows the same pattern for sort/chip/search params.
- **`convex/extraction/mutations/jobs.ts::deleteExtraction`** — existing batched cascade via `ctx.scheduler.runAfter`. Plan 01 adds `chatPapers` as one more step in that cascade.
- **`components/extraction/review-queue.tsx`** — `.withOptimisticUpdate` pattern for patching a row inside a cached query payload. Plans 03/04 follow the same pattern verbatim.
- **`components/extraction/chat/paper-citation.tsx`** — existing pill + hover-card structure. Plan 05 extends with tri-state semantics, not rewrites.
- **`lib/chat/render-corpus.ts`** — existing `<papers>` XML renderer. Plan 02 adds a filter step while preserving positional IDs (currently position is stable; we just need to honor gaps).
- **`lib/chat/resolve-paper.ts`** — existing `[P3]` parser. Plan 05 extends the `ResolvablePaper` shape; parser untouched.

## Testing doctrine

All plans follow the project's testing philosophy (project `CLAUDE.md`):

- **Assert on behavior, ARIA roles, `data-*` attributes, and semantic state — not CSS classes.**
- Expose internal contracts via `data-paper-included`, `data-paper-source`, `aria-multiselectable`, `aria-activedescendant`, `role="listbox"`, `role="status"`.
- Pure logic (weighted-scorer, match-snippet extractor, position-preserving filter, in-context count classifier) is tested in `lib/**.test.ts`.

### TDD policy — **pure logic only**

Each plan carries an explicit **TDD sequence** section listing Red → Green → Refactor steps for its pure-logic module(s). These modules must be fully green before any Convex wiring or UI work begins. Commit after each green.

- **Plan 01** — `convex/chat/chatPapersSeed.ts` (pure seed-row-builder helper) + `convex/chat/chatPapersDuplicate.ts` (clone helper)
- **Plan 02** — `lib/chat/render-corpus.ts` (`filterAndPreservePositions`, gap-tolerant renderer)
- **Plan 03** — `lib/chat/chat-papers-selection.ts` (optimistic patch helper used by both single toggle and bulk ops)
- **Plan 04** — `lib/chat/search/source-scorer.ts` (weighted cmdk scorer) + `lib/chat/search/match-snippet.ts` (extract 60-char context around match)
- **Plan 05** — `lib/chat/citation-state.ts` (pure: `classifyCitationState(paper, chatPapers) → "included" | "excluded" | "unresolved"`)
- **Plan 06** — no pure logic; test-after for all wiring and a11y assertions

Convex mutations, query functions, React components, and URL-state wiring are **test-after**. The Test plan section in each plan enumerates the specific behavior assertions (one per contract), written after green-lit implementation.

## Migration stance — **dev data is disposable**

Per the existing project doctrine (`extraction-recovery/00-README.md` § Migration stance):

- The Convex deployment is a **dev database** with no production data to preserve.
- Every schema change in these plans is **breaking**.
- **No `@convex-dev/migrations` scripts. No backfill.** If the schema validator rejects existing rows, **wipe the affected tables** via the Convex dashboard.
- Do **not** preserve old rows. Do **not** keep legacy fields as optional. Do **not** add compat shims.

**Chat-specific wrinkle:** `chatPapers` rows do not exist for any current chat. Plan 01 ships a one-shot admin mutation `backfillChatPapersForExistingChats` that walks every chat-mode job and seeds `chatPapers` with `included=true` for each of its frozen sources. This is **not a migration** (no schema-shape change for existing data — it's filling a new table from existing truth). Gate it to `NODE_ENV === "development"`, run it once from the dashboard, done.

If a production deployment ever exists, re-open every plan's schema change section and write a proper migration then. Until that day, go fast.

## Delegation policy — protect the main session's context

Context rot is the silent enemy of long-running plans. Every file read, grep, and tool output pollutes the main session's context. Subagents absorb that pollution in their own context and return only synthesized summaries.

**The executing session MUST delegate broadly** via the Agent tool. Rule of thumb: **any investigation needing more than ~3 file reads or ~3 greps → spawn a subagent**.

### Agent types to prefer

- **`Explore`** — fast codebase exploration. Use for "where is X defined?", "map all callers of Y", "find every file that imports Z". Always specify thoroughness: `"quick"` | `"medium"` | `"very thorough"`.
- **`general-purpose`** — multi-step research, web doc reading, skill discovery, cross-library synthesis.
- **`Plan`** — subsidiary planning for a non-trivial sub-problem.

### What to delegate (high value)

- "Map every caller of `buildSystemPromptForJob` and summarize its consumers."
- "Read the `cmdk` README and show me the `filter` prop contract + what `score` means."
- "Find every file that imports `papers-in-context-sidebar` and summarize what each needs."
- "Research the WAI-ARIA listbox pattern for multi-select with `aria-activedescendant`; give me a minimal React skeleton."
- "Read `nuqs` README and show me the pattern for per-chat namespaced URL state."

### What to keep in the main session

- The TDD red → green → refactor cycle. Needs tight test-runner feedback.
- Commits. Main session owns discipline.
- Plan-file edits (deviations, updates).
- Final acceptance-criteria verification.
- Trivial one-shot lookups (faster to grep directly than spawn an agent).

### Parallelism

When spawning multiple subagents for **independent** questions, put them in a **single message with multiple Agent tool calls**. The harness runs them concurrently. Example: three independent research questions → one message, three parallel `Agent` tool calls.

### Prompting subagents

A subagent starts with **zero context**. Give it enough to succeed unattended:

- Repo root path (`/Users/mcharrad/Documents/Github/openalex-count`).
- What you've already tried / ruled out.
- Exact shape of the answer you want ("bulleted list, under 500 words, `file_path:line` citations").
- Clearly state whether it should write code or just research.

### When the session grows stale

If the main session accumulates many tool calls and you feel quality drifting, **pause, commit progress, write a one-paragraph state summary into the plan file or a commit message, then restart in a fresh `/clear`'d session** by pasting the plan's prompt from `PROMPTS.md`. The plan files are designed to be resumable from any acceptance-criteria checkpoint.

## Convex patterns referenced across plans

- **`@convex-dev/aggregate`** — NOT used by this plan set. The 500-paper cap makes a direct index scan plenty fast; aggregate overhead isn't justified.
- **`useMutation(...).withOptimisticUpdate`** — the `localStore.setQuery` pattern from `components/extraction/review-queue.tsx` is the template for every toggle mutation in plans 03/04.
- **`ctx.scheduler.runAfter(0, internal.foo.continue, { cursor })`** — guidelines.md:245 pattern. Used by plan 01's cascade-delete addition.
- **`ctx.db.patch` batching** — Convex allows ~16k writes per mutation (guidelines.md). 500-row bulk toggle fits in a single transaction; no scheduler chaining needed.

## Sources

- Grill-me dialogue transcript (in-session, 2026-04-19) — canonical source for decisions D1–D16.
- [Convex guidelines.md](convex/_generated/ai/guidelines.md) — overrides training-data assumptions.
- [cmdk filter contract](https://cmdk.paco.me/) — weighted scorer uses the `filter` prop.
- [WAI-ARIA APG — Listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) — keyboard semantics.
- [nuqs — URL state for Next.js](https://nuqs.47ng.com/) — per-chat URL-persisted filter/sort/search.
- [shadcn Sheet](https://ui.shadcn.com/docs/components/sheet) — mobile packaging.
- [Gmail multi-select + select-all-matching UX](https://mailmeteor.com/blog/how-to-select-all-in-gmail) — industry reference for visible-only + extension banner.
- [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction) — referenced as deferred optimization; not installed for v1.
