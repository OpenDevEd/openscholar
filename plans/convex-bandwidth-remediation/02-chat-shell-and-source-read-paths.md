# Plan 02 — Chat Shell And Source Read Paths

## Goal

Stop chat-mode extraction pages from paying for extraction-detail reads they do not render, and dedupe the source/inclusion read model so the UI and system prompt do not re-read the same corpus separately.

## Scope

In scope:

- add a dedicated lightweight job-shell query for chat-mode routing/bootstrap,
- cut chat-mode pages over from `getJobDetails` to the lighter shell path,
- extract a shared pure helper for the chat source/inclusion read model,
- reuse that helper in `chatPapers.listChatSourcesWithInclusion` and `chat/context.buildSystemPromptForJob`,
- remove the `getJobSources` count-only dependency from suggestion chips in favor of `PapersContext.totalCount`.

Out of scope:

- message-stream query changes,
- schema changes for snapshot tables,
- new packages.

## Design

1. **Split shell from extraction-detail.**
   Add a public query returning only the job fields needed to decide whether the page is chat or extraction and to render the chat shell. `getJobDetails` remains extraction-specific.

2. **Unify source/inclusion joining in one helper.**
   Extract a helper under `convex/chat/` that reads `extractionJobSources` plus `chatPapers` once and returns the joined inclusion-aware rows. The UI query and prompt builder both consume the same helper.

3. **Do not add a snapshot table.**
   The bridge-table + frozen-source-table model is already correct; the waste is duplicated reads, not missing persisted state.

4. **Remove count-only broad reads from the client.**
   `SuggestionChips` should read `PapersContext.totalCount`, not mount a second source query.

## TDD sequence

1. Add red tests for the new shell query proving chat-mode callers do not need questions/papers.
2. Add red tests for the shared source-read helper proving parity between the UI row shape and prompt inclusion behavior.
3. Green the query/helper changes.
4. Add red page/component tests proving chat-mode pages no longer mount the extraction-detail path and suggestion chips still show the same paper count.
5. Green the client cutover.

## Files touched

- `convex/extraction/queries/jobs.ts`
- new helper under `convex/chat/`
- `convex/chat/chatPapers.ts`
- `convex/chat/context.ts`
- `components/extraction/chat/papers-context.tsx` if needed
- `components/extraction/chat/suggestion-chips.tsx`
- `app/extraction/[jobId]/page.tsx`
- relevant query/component tests

## Migration stance

None.

- No schema changes.
- Remove the broad mounted chat-mode path after cutover; do not keep both mounted.

## Test plan

- Convex query/helper tests for shell shape and source-read parity.
- Page/component tests for chat-mode routing and suggestion-chip count rendering.
- Manual smoke:
  - open a chat-mode job,
  - verify chat page renders correctly,
  - toggle included papers and verify the next send uses the updated inclusion set,
  - confirm no extra count-only query is mounted for suggestion chips.

## Acceptance criteria

- Chat-mode pages no longer mount `getJobDetails` on first render.
- UI source rows and prompt inclusion derive from one shared read-model helper.
- `SuggestionChips` no longer calls `getJobSources`.
- No snapshot table or extra mutable state is introduced.

## Known pitfalls

- Keep ownership checks identical between the old and new paths.
- Preserve source ordering and inclusion semantics used by citations and prompt rendering.
- Do not accidentally make the prompt builder depend on client-only context.

