# Plan 05 — Citation Pill Tri-State with Live Inclusion Awareness

**Depends on:** 02 (prompt uses `P${position}` IDs, resolver must match), 03 (query to read live `chatPapers`). **Blocks:** 06 (polish/E2E).

## Goal

Make chat-text citation pills honest about current inclusion state. Every `[P3]` in a past or streaming assistant message resolves to its paper via **stable position** (not array index); the rendered pill reflects one of three states:

1. **included** — primary-tinted pill (current styling).
2. **excluded** — muted with dashed border, still clickable (metadata + links still resolve); hover card gains a **Re-include for future turns** action.
3. **unresolved** — existing `[N?]` muted-grey pill (paper index not in source list at all; rare data-integrity case).

Implements decisions **D16** (tri-state + re-include action) and the live-read rule from **D2**.

## Scope

**In scope**

- Refactor `lib/chat/resolve-paper.ts` — resolve `[P<n>]` by `position` match, not `papers[index-1]`. Gap-tolerant: `[P4]` in a 5-source chat where source-at-position-3-is-excluded still resolves correctly to the source at position 4.
- Extend `ResolvablePaper` shape to include `included: boolean` (pulled from `chatPapers` live state).
- New pure module `lib/chat/citation-state.ts` — `classifyCitationState(paper) → "included" | "excluded" | "unresolved"`. TDD.
- Update `components/extraction/chat/paper-citation.tsx`:
  - Accept `included` as a prop on the resolved paper.
  - Apply `data-citation-state` attribute (`included` | `excluded` | `unresolved`).
  - Apply dashed-border + muted style for excluded (via className; the test surface is `data-citation-state`).
  - Hover card: add `Re-include for future turns` action button when state is `excluded`.
- Update `components/extraction/chat/message-list.tsx` — pass `chatPapers` inclusion state through to every rendered `PaperCitation`. The existing `getJobSources()` call is replaced by `listChatSourcesWithInclusion()` (plan 03's query).
- Tests: pure (`classifyCitationState`, updated resolver). Test-after for the pill component.

**Out of scope**

- Sources panel UI (plan 04).
- Message-history editing behavior (no changes — regenerate/edit-resend semantics already covered by plan 02's live-read rule).
- Snapshot-based "in context for this turn" — deliberately abandoned per D2 revision.

## Design

### 1. Resolver — `lib/chat/resolve-paper.ts`

Current (per research brief, line 57-91): regex extracts `[P<n>]` tokens, maps `n → papers[n-1]`.

New: resolver receives `ChatSourceRow[]` (which already carries `position`). Match by position.

```ts
export type ResolvablePaper = {
  sourceId: Id<"extractionJobSources">;
  chatPaperId: Id<"chatPapers">;
  position: number;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  pdfUrl: string | null;
  openalexId: string | null;
  included: boolean;              // NEW — from chatPapers live read
};

export function resolvePaperReferences(
  text: string,
  papers: ResolvablePaper[],
): Array<{ raw: string; index: number; paper: ResolvablePaper | null }> {
  const positionIndex = new Map(papers.map((p) => [p.position, p]));
  // existing regex extraction...
  return tokens.map(({ raw, index }) => ({
    raw,
    index,                               // the number inside [P<index>]
    paper: positionIndex.get(index) ?? null,  // null = unresolved (gap or out-of-range)
  }));
}
```

**Positional gaps are first-class.** If a paper at position 3 is excluded and the LLM still cites `[P3]` in a past message (because that message was sent BEFORE exclusion — legitimate), `positionIndex.get(3)` still returns it. The `included: false` flag lets the pill render as excluded. The paper **still resolves** — we never break the link.

### 2. Pure state classifier — `lib/chat/citation-state.ts`

```ts
export type CitationState = "included" | "excluded" | "unresolved";

export function classifyCitationState(
  paper: ResolvablePaper | null,
): CitationState {
  if (paper === null) return "unresolved";
  return paper.included ? "included" : "excluded";
}
```

Trivially pure. One test per branch. Keeps the rendering code dumb (no ternaries on props in JSX).

### 3. Pill component — `components/extraction/chat/paper-citation.tsx`

Current (per research brief, line 91-226): PaperCitation takes `{index, paper: ResolvablePaper | null}`, renders primary-link pill or unresolved `[N?]`.

Refactor:

```tsx
type Props = {
  index: number;
  paper: ResolvablePaper | null;
  jobId: Id<"extractionJobs">;
};

export function PaperCitation({ index, paper, jobId }: Props) {
  const state = classifyCitationState(paper);

  const reinclude = useMutation(api.chat.chatPapers.toggleChatPaper)
    .withOptimisticUpdate(/* same pattern as plan 04 */);

  const onReinclude = () => {
    if (!paper) return;
    reinclude({ chatPaperId: paper.chatPaperId, included: true });
  };

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a
          href={primaryLink(paper)}
          data-citation-state={state}
          data-citation-index={index}
          aria-label={pillAriaLabel(state, paper, index)}
          className={cn(
            state === "included" && "pill-included-classes",
            state === "excluded" && "pill-excluded-classes",  // muted + dashed border
            state === "unresolved" && "pill-unresolved-classes",
          )}
        >
          {state === "unresolved" ? `[${index}?]` : `[${index}]`}
        </a>
      </HoverCardTrigger>
      {paper && (
        <HoverCardContent>
          <p className="font-medium">{paper.title}</p>
          <p className="text-xs text-muted-foreground">
            {paper.authors.slice(0, 3).join(", ")}
            {paper.authors.length > 3 && " et al."}
            {paper.year && ` · ${paper.year}`}
          </p>
          <div className="flex gap-2 mt-2">
            {paper.openalexId && <LinkButton href={openalexUrl(paper.openalexId)}>OpenAlex</LinkButton>}
            {paper.doi && <LinkButton href={doiUrl(paper.doi)}>DOI</LinkButton>}
            {paper.pdfUrl && <LinkButton href={paper.pdfUrl}>PDF</LinkButton>}
          </div>
          {state === "excluded" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onReinclude}
              data-reinclude-action
            >
              {t("citation.reincludeForFutureTurns")}
            </Button>
          )}
        </HoverCardContent>
      )}
    </HoverCard>
  );
}
```

**Key invariants:**
- `data-citation-state` is the test surface (one of three values).
- Excluded pills are **still clickable** — they open the paper's primary source. Citations never become dead.
- The re-include button **only appears on excluded state**. Included pills don't need it; unresolved pills can't re-include (no chatPaperId).
- Styling is via Tailwind classes, but tests never assert on classes — only `data-citation-state`.

**Styling guidance (not a test surface, for reference):**
- `included` → `bg-primary/10 text-primary border-transparent` (existing).
- `excluded` → `bg-muted/40 text-muted-foreground border border-dashed border-muted-foreground/40`.
- `unresolved` → existing `PILL_UNRESOLVED_CLASS`.

### 4. `message-list.tsx` update

Current (per research brief, line 293-323): runs `getJobSources()` once per chat session to fetch frozen sources, passes to resolver.

New:

```ts
const rows = useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId });
// Map ChatSourceRow[] → ResolvablePaper[] (same data, carry `included`).
const papers = useMemo(() => rows?.map(toResolvablePaper) ?? [], [rows]);
```

The `listChatSourcesWithInclusion` query is reactive — when a user toggles a paper, every rendered citation pill re-renders with the new state without any manual coordination. The existing resolver call stays the same (the `papers` array shape only gained `included`).

### 5. Streaming-text citation state

Per D11, toggles during streaming affect the visual state of citation pills in the streaming text **live**. Because `message-list.tsx` subscribes to `listChatSourcesWithInclusion`, and because the streaming text's citations resolve through the same `papers` array, this is automatic: toggle a paper off mid-stream, every rendered `[P3]` pill to that paper re-renders as excluded. No extra code needed.

**Test coverage for this:** plan 06's E2E includes a "toggle mid-stream, assert pill dims" scenario. Don't attempt it in this plan's unit tests.

## TDD sequence (pure logic)

### `lib/chat/citation-state.test.ts`

```
R1 → G1   test: classifyCitationState(null) → "unresolved"
R2 → G2   test: classifyCitationState({...,included:true}) → "included"
R3 → G3   test: classifyCitationState({...,included:false}) → "excluded"
R4 → G4   test: pure — paper object not mutated
```

Four cases. Tiny function, full coverage in four reds.

### Updated `lib/chat/resolve-paper.test.ts`

```
R1 → G1   test: resolves "[P1]" against papers=[{position:1,...}] → resolved
R2 → G2   test: resolves "[P3]" against papers=[{position:1},{position:3}] → resolved to pos-3 paper
          (gap at position 2 does not confuse the resolver)
R3 → G3   test: resolves "[P2]" against papers=[{position:1},{position:3}] → unresolved (null)
          (position 2 excluded → legitimately missing from the live array)
R4 → G4   test: resolves "[P5]" when max position is 3 → unresolved
R5 → G5   test: resolves "[P1, P3, P5]" — extracts three tokens, each resolves independently
R6 → G6   test: resolves "[p3]" case-insensitive
R7 → G7   test: pure — papers array not mutated
R8 → G8   test: carries `included` flag through to resolved paper
          input paper has included:false → output.paper.included === false
```

**Phase A:** TDD above. Red → green → commit per green.

**Phase B (test-after):** pill component, message-list wiring, i18n.

## Files touched

- `lib/chat/resolve-paper.ts` — switch from array-index to position-based resolution; extend `ResolvablePaper` with `included` field.
- `lib/chat/resolve-paper.test.ts` — extended per TDD above.
- `lib/chat/citation-state.ts` (new) — pure classifier.
- `lib/chat/citation-state.test.ts` (new).
- `components/extraction/chat/paper-citation.tsx` — tri-state rendering, `data-citation-state`, re-include hover action.
- `components/extraction/chat/message-list.tsx` — swap `getJobSources` for `listChatSourcesWithInclusion`; map rows to `ResolvablePaper`.
- `messages/*.json` — new key `citation.reincludeForFutureTurns`.
- `tests/chat/paper-citation.test.tsx` (new or extended) — behavior tests for tri-state and re-include action.

## Migration stance — **none**

No schema changes. No Convex function changes either (plan 03 provided the query and mutation we consume). Pure front-end + resolver logic.

## Test plan

### Unit (pure — covered in TDD)
- `classifyCitationState` — 4 cases.
- Updated `resolvePaperReferences` — 8 cases.

### Behavior (React Testing Library — `tests/chat/paper-citation.test.tsx`)

- **renders included pill with data-citation-state="included"**: pass `paper.included = true`, assert element has `data-citation-state="included"`.
- **renders excluded pill with data-citation-state="excluded"**: pass `paper.included = false`, assert attribute AND assert pill is still clickable (`getByRole("link")` resolves).
- **renders unresolved pill with data-citation-state="unresolved"**: pass `paper = null`, assert attribute AND rendered text contains `[N?]` (not `[N]`).
- **excluded hover card shows Re-include action**: hover (or force-open hovercard), assert button with `data-reinclude-action` is present; assert a button with `data-reinclude-action` is NOT present for included state.
- **clicking Re-include fires toggleChatPaper(included=true)**: mock the mutation, click the action, assert spy called with `{chatPaperId: paper.chatPaperId, included: true}`.
- **primary link resolves for all three states**: included/excluded → href points to OpenAlex > DOI > PDF fallback chain; unresolved → no link or `#` (existing behavior preserved).
- **aria-label is state-aware**: included: `"Source [3] — included"`; excluded: `"Source [3] — excluded from context"`; unresolved: `"Source [3] — unresolved"`.
- **position-based resolution via message-list integration**: render a chat with 5 sources, exclude source at position 2, inject assistant message with `[P2, P4]` — assert rendered pills: one `data-citation-state="excluded"` (P2) and one `"included"` (P4), NOT an off-by-one shift.

### Live-inclusion reactivity

- **toggling changes pill state across all messages**: render a chat with multiple past messages each citing the same paper → toggle that paper off → assert every rendered pill for that paper now has `data-citation-state="excluded"`.
- **re-include from hover card flips back**: open excluded pill's hover card, click Re-include, assert pill now `included` and the Re-include button is gone.

## Acceptance criteria

- [ ] `resolvePaperReferences` resolves by `position`, not array index; positional gaps honored.
- [ ] `classifyCitationState` is pure, fully tested, exported from `lib/chat/citation-state.ts`.
- [ ] `PaperCitation` renders three distinct states via `data-citation-state`.
- [ ] Excluded pill remains clickable and shows re-include action in hover card.
- [ ] `message-list.tsx` subscribes to `listChatSourcesWithInclusion` (not `getJobSources`).
- [ ] Toggling a paper in the Sources panel immediately updates every citation pill across all rendered messages.
- [ ] All 6 locales have `citation.reincludeForFutureTurns` key.
- [ ] Behavior tests green.
- [ ] `rg -n "papers\[\s*.+-\s*1\s*\]" lib/chat/` returns zero matches (no surviving array-index resolution).

## Known pitfalls

- **Citation parser regex already extracts `P<n>` as a plain integer** — make sure the new position-based resolver interprets that integer as `position`, not `index`. This is semantic, not syntactic: the regex is unchanged, only the `Map<number, paper>` lookup changes.
- **Grouped citations like `[P1, P3, P7]`** — the existing parser handles these. Keep coverage in the TDD R5 test; each grouped reference resolves independently, and a mix of included/excluded states in a single group must render as a mix of pills, not collapse.
- **`message-list.tsx` query migration** — swapping `getJobSources` → `listChatSourcesWithInclusion` changes the subscription, which changes what causes `message-list` to re-render. Verify no useEffect dependencies silently break. The shape is a superset (adds `included`), so existing consumers keep working; the new consumers (PaperCitation) opt into the new field.
- **Hover card and mobile** — hover cards don't work on touch. The re-include action must also be reachable via tap. shadcn `HoverCard` supports `openDelay={0}` + treating tap as open, but test on actual mobile. Fall back: if the spec becomes "no hover cards on mobile", render the re-include as a compact inline button inside the pill for mobile. Plan 06 confirms.
- **Tri-state ≠ three classes; tri-state = one `data-citation-state` attribute** — the classes are implementation detail. Every test assertion must go through `data-citation-state`, per CLAUDE.md's testing philosophy.
- **Re-include mutation optimistic patch** — reuse the `applyInclusionPatch` helper from plan 03's `lib/chat/chat-papers-selection.ts`. Do not duplicate the optimistic logic inside `paper-citation.tsx`.
- **Gap resolver and the static list** — before excluding, if the server already rendered an assistant message with `[P1, P2, P3]` and now P2 is excluded, the pill-for-P2 becomes `excluded`. This is correct. If the user edits a past user message (plan 02 semantics: re-snapshot / live-read), the new assistant reply won't cite P2. The two behaviors are consistent — old text still references P2 as excluded, new text doesn't reference it at all.
