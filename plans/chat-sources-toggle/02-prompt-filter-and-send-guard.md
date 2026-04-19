# Plan 02 — Prompt Builder Filters Included Sources; Send-Time Empty Guard

**Depends on:** 01 (needs `chatPapers` table to read from). **Blocks:** 05 (citation-state needs live prompt truth to match).

## Goal

Make the LLM context honest: `buildSystemPromptForJob` reads live `chatPapers`, filters out excluded rows, and renders the remaining papers with **stable positional IDs preserved even across gaps** (excluded papers keep their position reserved — they simply aren't emitted). At the send-message boundary, reject with a typed error when zero papers are included.

No UI work. No mutations for toggling (that's plan 03). This plan is entirely about the server-side contract that makes the toggle actually *do something* to the LLM, while honoring decisions **D1** (positional IDs stable), **D2** (live read, no snapshot), and **D9** (block empty sends).

Implements decisions D1, D2, D9. Unblocks plan 05 (citation pill can now trust that `included=false` → the paper truly wasn't in the last prompt).

## Scope

**In scope**

- `lib/chat/render-corpus.ts` — refactor `renderPaperCorpus` to accept a `filterPredicate` or (more likely) to accept a pre-filtered list; add a new pure helper `filterAndPreservePositions(sourcesWithPosition, includedSet) → gappedSources[]` that emits only included rows while keeping the original `position` field on each as the basis for the `[P<n>]` ID.
- `convex/chat/context.ts::buildSystemPromptForJob` — join `extractionJobSources` with `chatPapers` on `sourceId`, filter `included === true`, pass through the pure helper, render.
- `convex/chat/messages.ts::sendMessage` — insert a pre-check: count included `chatPapers`; if zero, throw `ConvexError({ code: "no_sources_included", ... })`.
- `lib/errors/taxonomy.ts` (if present per extraction-recovery plan 01) — add `no_sources_included` error code; otherwise use a plain string code and revisit when taxonomy lands.
- Tests for the pure filter helper (TDD).
- Test-after Convex tests for prompt filtering and send-guard rejection.

**Out of scope**

- The toggle mutations themselves (plan 03).
- UI surfacing of the empty-state (plan 04 — composer live-hint and banner).
- Citation pill rendering (plan 05).
- Prompt-cache prefix stability concerns — toggling will invalidate the prompt cache by design; we accept the cache miss on the next turn.

## Design

### 1. Positional ID semantics (critical — reread before coding)

Current renderer (`lib/chat/render-corpus.ts:32-49`) sorts by `openalexId` and emits `<paper id="P1">`, `<paper id="P2">`, ... based on **array index + 1**. This is the bug we're avoiding: under this scheme, filtering out paper #2 would shift `[P3]` to point to what was previously `[P4]`, and every past message's citations would break.

**Fix:** the `id` attribute in the XML must derive from a **stable anchor**, not array index. Use the `position` field on `extractionJobSources` (a 1-indexed, stable-for-lifetime integer already in the schema per `convex/schema.ts:404-436`). After filtering, the emitted XML has holes:

```xml
<papers count="3">
  <paper id="P1" openalex="W1">...</paper>
  <!-- P2 omitted because excluded -->
  <paper id="P3" openalex="W3">...</paper>
  <paper id="P4" openalex="W4">...</paper>
</papers>
```

The `count` attribute reflects the **included** count (3), not the original source count. The IDs keep their original values. The LLM is told, in the system prompt, that IDs are stable and may contain gaps — see prompt rules.

**Client-side citation resolver** (`lib/chat/resolve-paper.ts:57-91`): currently uses `papers[index-1]`. Plan 05 updates this to resolve by `position` match instead of array index, which removes the off-by-one fragility entirely.

### 2. Pure helper — `lib/chat/render-corpus.ts`

Add a pure helper that takes the raw source rows (with `position`) and the set of included sourceIds, and returns a gap-tolerant list ready for XML emission:

```ts
export type CorpusSource = {
  sourceId: Id<"extractionJobSources">;
  position: number;                // stable 1-indexed ID anchor
  openalexId?: string | null;
  title: string;
  authors: string[];
  year: number | null;
  abstract?: string | null;
  doi?: string | null;
  pdfUrl?: string | null;
};

export type CorpusSourceForPrompt = CorpusSource & {
  promptId: `P${number}`;          // `P${position}`
};

export function filterAndPreservePositions(
  sources: CorpusSource[],
  includedSourceIds: Set<Id<"extractionJobSources">>,
): CorpusSourceForPrompt[] {
  return sources
    .filter((s) => includedSourceIds.has(s.sourceId))
    .sort((a, b) => a.position - b.position)   // deterministic for prompt cache
    .map((s) => ({ ...s, promptId: `P${s.position}` as const }));
}
```

Then the existing `renderPaperCorpus` consumes `CorpusSourceForPrompt[]`, using `promptId` for the XML `id` attribute instead of `P${index+1}`.

**Also update the system-prompt header** (the static XML-envelope text) to warn the model about gaps:

```
Papers are identified by stable IDs (e.g. [P1], [P4], [P7]). These IDs are
permanent and may contain gaps when papers are excluded from context by
the user. Always cite the ID you see in the <paper id="..."> attribute.
Never invent IDs outside the visible set.
```

Place this exactly once in `convex/chat/agent.ts:46-50` (the system-prompt assembly site per research brief), alongside the existing citation rules. Translate per locale — keys `chat.system.citationRules.positionalIds` etc.

### 3. `buildSystemPromptForJob` change — `convex/chat/context.ts`

Current (line 19-62): reads `extractionJobSources` directly via `readJobSources`.

New flow:

```ts
export const buildSystemPromptForJob = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    const sources = await readJobSources(ctx, jobId, PAPER_LIMIT_MAX);

    // Live-read the inclusion layer.
    const includedRows = await ctx.db
      .query("chatPapers")
      .withIndex("by_job_included", (q) => q.eq("jobId", jobId).eq("included", true))
      .collect();
    const includedSet = new Set(includedRows.map((r) => r.sourceId));

    const corpusSources = sources.map(toCorpusSource);   // shape adapter
    const filtered = filterAndPreservePositions(corpusSources, includedSet);

    return renderPaperCorpus(filtered);
  },
});
```

Empty case: `filtered.length === 0` → `renderPaperCorpus([])` emits `<papers count="0"></papers>`. This is **never hit in practice** because plan 02 also blocks `sendMessage` on empty (§ 4), but the renderer should handle it cleanly if an internal path ever reaches it. Do not throw here — throwing in the query would break non-send reads (like an inspector UI, if one ever exists).

### 4. Send-time empty guard — `convex/chat/messages.ts::sendMessage`

Insert at the top of the handler, right after auth:

```ts
const includedCount = (await ctx.db
  .query("chatPapers")
  .withIndex("by_job_included", (q) => q.eq("jobId", jobId).eq("included", true))
  .take(1)
).length;

if (includedCount === 0) {
  throw new ConvexError({
    code: "no_sources_included",
    message: "At least one source must be included before sending a message.",
  });
}
```

Using `.take(1)` (not `.collect()`) because we only need to know *whether* any row exists. Short-circuit, O(1) work.

**Error surface:** plan 04's composer catches this `ConvexError`, inspects `.data.code === "no_sources_included"`, and renders the inline banner with `[Include all]` CTA. Do not re-render in the composer based on the error alone — the composer already has a live `includedCount` from its reactive subscription and should be in the disabled state before Send is even clickable. The throw is a **defensive second gate** for the race where a paper is excluded in the millisecond between client-side Send click and server-side handler entry.

### 5. Stream start semantics (document, do not change yet)

Decision D2 says "anything streaming reads live at stream-start." Agent actions (`generateResponse` in `convex/chat/agent.ts`) call `buildSystemPromptForJob` at the moment they begin. That call produces the filtered XML. Mid-stream toggles do not re-enter `buildSystemPromptForJob`. The stream has its own frozen context for its lifetime.

This is already the behavior after this plan — no additional code. Just confirm in a test (§ Test plan, "toggle during streaming doesn't mutate the current stream") and document in commit message.

## TDD sequence (pure logic only — `lib/chat/render-corpus.ts`)

### `lib/chat/render-corpus.test.ts`

```
R1 → G1   test: filterAndPreservePositions([], new Set()) → []
R2 → G2   test: all sources included, positions 1,2,3 → returns 3 rows, promptIds P1,P2,P3
R3 → G3   test: sourceId s2 excluded, positions 1,2,3 → returns rows with positions 1 and 3
          promptIds are P1, P3 (not P1, P2 — preservation is the whole point)
R4 → G4   test: unsorted input {s3,pos3}, {s1,pos1}, {s2,pos2} with all included
          → output sorted by position ascending
R5 → G5   test: duplicate positions in input (data bug) — output still filters correctly
          (we accept both; the caller is responsible for uniqueness)
R6 → G6   test: sourceId not in includedSet → dropped; included sourceIds kept
R7 → G7   test: promptId format is literally `P${position}` (not `P${index+1}`)
          input pos 7 alone → output promptId "P7"
R8 → G8   test: function is pure — calling twice with same input returns equivalent output,
          input array not mutated (Object.isFrozen check after the call)
REFACTOR  extract promptId construction into a tiny util `toPromptId(position)`;
          re-run full suite green.
```

Also update `renderPaperCorpus` tests (if present; check `lib/chat/render-corpus.test.ts` for existing coverage):

```
R9 → G9   test: renderPaperCorpus([{promptId:"P1",...},{promptId:"P3",...}])
          emits <papers count="2"> with P1 and P3 (gap between is NOT filled)
R10→ G10  test: renderPaperCorpus([]) emits <papers count="0"></papers> (no-throw)
R11→ G11  test: XML escaping of title/authors still works after the shape change
```

**Phase A (TDD):** write the above. Watch red, implement, watch green. Commit per green.

**Phase B (test-after):** `buildSystemPromptForJob` refactor, `sendMessage` guard, agent-prompt rule addition. One commit per logical unit.

## Files touched

- `lib/chat/render-corpus.ts` — new `filterAndPreservePositions`; `renderPaperCorpus` signature change to accept `CorpusSourceForPrompt[]`.
- `lib/chat/render-corpus.test.ts` — extended per TDD above.
- `convex/chat/context.ts` — `buildSystemPromptForJob` joins with `chatPapers`, filters.
- `convex/chat/messages.ts` — `sendMessage` empty-guard pre-check.
- `convex/chat/agent.ts` — system-prompt rule addition ("IDs may contain gaps").
- `messages/*.json` — localized citation rules (append; keep keys short and documented).
- `convex/chat/context.test.ts` (new or extended) — Convex-level tests for the query behavior.
- `convex/chat/messages.test.ts` (new or extended) — empty-guard rejection test.

## Migration stance — **none**

No schema changes in this plan. Plan 01 already added the `chatPapers` table. This plan only reads it.

If plan 01 has not landed, this plan is blocked. Do not try to run this plan's Convex code paths against a schema without `chatPapers` — the `withIndex("by_job_included", ...)` call will fail at runtime with an "index not found" error.

## Test plan

### Unit (pure helpers — covered in TDD sequence)
- `filterAndPreservePositions` — 8 cases.
- `renderPaperCorpus` gap handling — 3 cases.

### Convex integration

- **prompt excludes excluded papers**: seed a 3-source chat, mark source #2 `included: false` via direct `ctx.db.patch`, call `buildSystemPromptForJob`. Assert returned XML contains `<paper id="P1">` and `<paper id="P3">` and **not** `<paper id="P2">`. Assert `count="2"` attribute.
- **all-included case unchanged**: 3-source chat, all included, `buildSystemPromptForJob` returns 3 papers with ids P1/P2/P3 (no gaps). This guards against regression where the "gap" logic breaks the happy path.
- **all-excluded case**: `buildSystemPromptForJob` returns `<papers count="0"></papers>` and does not throw. (Belt-and-braces — send-guard prevents this from reaching the LLM, but the renderer stays clean.)
- **positional stability across toggles**: 5-source chat, exclude source #3, call prompt builder → get P1,P2,P4,P5. Re-include source #3, exclude #4 → get P1,P2,P3,P5. IDs for previously-included sources are unchanged across the toggle.

### Send-guard rejection

- **zero-included sendMessage throws**: 3-source chat, set all three to `included: false`, call `sendMessage({ threadId, prompt: "hi" })` → expect `ConvexError` with `data.code === "no_sources_included"`. Assert no new message rows were inserted (rollback cleanly).
- **one-included sendMessage succeeds**: 3-source chat, 1 included / 2 excluded, `sendMessage` succeeds, `chat/messages.by_thread` count increments by one user message.

### Stream snapshot (documenting existing behavior, not new code)

- **mid-stream toggle doesn't mutate current stream**: send a message, start the stream, in a parallel call patch `chatPapers` to exclude one paper while the stream is still in progress. Wait for stream to complete. Assert the streamed assistant reply's citations (scraped from its text) reference the paper that *was* included at stream-start, not the post-toggle state. This may require a test-harness timing hack — if awkward, skip this test but document in a comment that plan 06's E2E covers it.

## Acceptance criteria

- [ ] `filterAndPreservePositions` is pure, tested, and exported from `lib/chat/render-corpus.ts`.
- [ ] `renderPaperCorpus` emits stable `P<position>` IDs with gaps honored; no array-index fallback remains.
- [ ] `buildSystemPromptForJob` returns only included papers, in position order, with stable IDs.
- [ ] `sendMessage` throws `ConvexError({code:"no_sources_included"})` when zero included.
- [ ] System prompt text warns the model about ID gaps; translation keys shipped in all locales.
- [ ] All Convex tests green.
- [ ] `rg -n "papers\[index" lib/chat/` returns zero matches (no array-index-based ID generation survived).

## Known pitfalls

- **Prompt cache invalidation** — toggling a paper changes the system prompt prefix, forcing a cache miss on the next turn. Accepted tradeoff (see D1 discussion). Do not try to stabilize the prefix by emitting excluded papers with an `excluded="true"` attribute; the model will treat them as in-context and cite them.
- **Position as ID anchor requires `position` to be present on every `extractionJobSources` row** — confirm in research that `position` is always set (it should be per `convex/schema.ts:404-436`, but grep for `position:` at every insertion site to be sure). If any insertion site writes rows without `position`, patch those first or the `P${position}` output will be `Pundefined`.
- **`renderPaperCorpus` signature is a breaking change** — callers currently pass `extractionJobSources`-shaped rows and get indexed IDs. After this plan, callers pass `CorpusSourceForPrompt[]` with `promptId` already computed. Grep all callers. Expect ~1–3 sites (agent.ts, possibly a context-debug query). Update all in one commit.
- **`ConvexError` `.data` shape convention** — extraction-recovery plan 01 standardizes on `{ code, message, context? }`. If that plan has shipped, consume its `errorCodeValidator` and add `no_sources_included` to the taxonomy. If it hasn't shipped, use an ad-hoc `{ code, message }` shape here and leave a TODO-comment for taxonomy reconciliation.
- **`sendMessage` optimistic UI** — the composer (plan 04) will optimistically add the user message to the cached query on Send click. If the server throws `no_sources_included`, the optimistic row must be rolled back. Convex's `withOptimisticUpdate` handles this automatically (rollback on mutation rejection). Confirm by test in plan 04, not here.
