# 08 — MessageRow parts rendering: tool steps, source URLs, step boundaries

## Goal

Refactor the existing single-blob `MessageRow` (`components/extraction/chat/message-list.tsx:383-516`) to iterate `parts[]` and render the AI SDK v6 discriminated union. Add the new `<ToolStep>` component for `tool-${name}` parts (with the live cost annotation) and the new `<WebSourceChip>` component for `source-url` parts. Keep `Streamdown` markdown rendering for `text` parts intact, including `[Pn]` paper-citation rewrites.

## Scope

In:
- New file `components/ai-elements/tool-step.tsx`: `<ToolStep>` component for `tool-${name}` parts. State machine, shimmer during `input-streaming`, success/error variants, cost annotation.
- New file `components/ai-elements/web-source-chip.tsx`: `<WebSourceChip>` for a single `source-url` part — favicon + title + host.
- New file `components/ai-elements/web-source-chips.tsx`: container that groups all `source-url` parts of a message into a footer row.
- New file `lib/chat/format-search-cost.ts`: pure helper `formatSearchCostLabel({ creditsUsed?, creditsPerSearchEstimate, costUsdEstimate })` returning the cost string for the tool step.
- New file `lib/chat/favicon-url.ts`: pure helper `faviconUrl(host: string): string` (Google primary + DuckDuckGo fallback hint).
- `components/extraction/chat/message-list.tsx:383-516`: refactor `MessageRow` to iterate `parts[]`.
- Tests for each new component and each helper.

Out:
- Reasoning rendering (out of scope per `00-README.md` §11). Reasoning parts pass through to `text` rendering or are silently swallowed for V1.
- Step-start visibility heuristics: V1 renders all `step-start` parts as a thin invisible separator (semantic only) and an explicit visible `<hr data-step-boundary>` only in the case described in `00-README.md` §6.
- Sources panel changes (per locked decision: web sources do not appear in the side panel).

## Design

### Parts iteration

```tsx
function MessageRow({ message }: { message: ChatUIMessage }) {
  const isAssistant = message.role === "assistant";
  return (
    <div className="..." data-message-role={message.role}>
      {message.parts.map((part, idx) => {
        switch (part.type) {
          case "text":
            return <TextPart key={idx} part={part} message={message} />;
          case "step-start":
            return <StepBoundary key={idx} prevPart={message.parts[idx - 1]} nextPart={message.parts[idx + 1]} />;
          case "source-url":
            // Source-url parts are accumulated and rendered in WebSourceChips at the message footer
            return null;
          case "reasoning":
            return null; // V1: ignore
          default:
            // tool-${name} parts handled here
            if (part.type.startsWith("tool-")) {
              return <ToolStep key={idx} part={part as ToolUIPart<...>} />;
            }
            return null;
        }
      })}
      <WebSourceChips parts={message.parts} />
    </div>
  );
}
```

`source-url` parts intentionally render at the bottom of the message (per locked decision §8 of README), not interleaved.

### `<ToolStep>` component

```tsx
// components/ai-elements/tool-step.tsx
"use client";

import { Globe, Check, AlertCircle, CircleSlash } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import { formatSearchCostLabel } from "@/lib/chat/format-search-cost";

export function ToolStep({ part }: { part: ToolWebSearchPart | ... }) {
  const isAborted = /* derived from outer message status */;
  const state = part.state;
  const query = part.input?.query ?? "";

  return (
    <div
      className="my-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
      data-tool-name={getToolName(part)}
      data-tool-state={isAborted && (state === "input-streaming" || state === "input-available") ? "aborted" : state}
      role={state === "input-streaming" || state === "input-available" ? "status" : undefined}
      aria-live={state === "input-streaming" ? "polite" : undefined}
      aria-atomic="true"
    >
      <div className="flex items-center gap-2">
        <Icon state={state} aborted={isAborted} />
        <span className="font-medium">
          {state === "input-streaming" ? <Shimmer>Searching the web…</Shimmer> : null}
          {state === "input-available" ? <>Searching: <em>{query}</em></> : null}
          {state === "output-available" ? <>Found {(part.output?.sources ?? []).length} results for: <em>{query}</em></> : null}
          {state === "output-error" ? "Web search failed" : null}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {formatSearchCostLabel({
            creditsUsed: part.output?.creditsUsed,
            creditsPerSearchEstimate: 3,    // tuneable
            costUsdEstimate: 0.02,           // tuneable
          })}
        </span>
      </div>
      {state === "output-error" && (
        <p className="mt-2 text-destructive text-xs" role="alert">{part.errorText}</p>
      )}
    </div>
  );
}
```

`Shimmer` already exists at `components/ai-elements/shimmer.tsx` (verified via codebase scan). Use it for `input-streaming`. The state-icon table follows the AI Elements `tool.tsx` pattern (research agent 7):

| state | icon | tone |
|---|---|---|
| `input-streaming` | `Globe` (or `Loader2` spinning) | neutral, shimmered |
| `input-available` | `Globe` + `animate-pulse` | neutral |
| `output-available` | `Check` | success (`text-emerald-600`) |
| `output-error` | `AlertCircle` | destructive |
| `output-denied` / aborted | `CircleSlash` | muted |

### `<WebSourceChip>` and `<WebSourceChips>`

```tsx
// components/ai-elements/web-source-chip.tsx
import { faviconUrl } from "@/lib/chat/favicon-url";

export function WebSourceChip({ url, title, idx }: { url: string; title?: string; idx: number }) {
  const host = new URL(url).hostname;
  const display = title?.trim() || host;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="..."
      data-source-type="web"
      data-source-host={host}
      title={url}
    >
      <img
        src={faviconUrl(host)}
        onError={(e) => (e.currentTarget.style.opacity = "0")}
        alt=""
        className="size-3.5 rounded-sm"
        loading="lazy"
      />
      <span className="truncate max-w-[16ch]">{display}</span>
      <span className="text-muted-foreground/70">[{idx + 1}]</span>
    </a>
  );
}
```

Container groups all `source-url` parts of the message and renders them in a single row at the bottom:

```tsx
// components/ai-elements/web-source-chips.tsx
export function WebSourceChips({ parts }: { parts: UIMessagePart<...>[] }) {
  const sources = parts.filter((p): p is SourceUrlUIPart => p.type === "source-url");
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-web-sources-count={sources.length}>
      {sources.map((s, i) => (
        <WebSourceChip key={s.sourceId + i} url={s.url} title={s.title} idx={i} />
      ))}
    </div>
  );
}
```

### `<StepBoundary>` (visible `step-start` heuristic)

Render visible only when previous part was a `tool-*` in `output-available` state AND next part is `text`. Otherwise return null. This matches the §6 heuristic in `00-README.md` and avoids visual noise on single-step turns.

### Helpers

```ts
// lib/chat/format-search-cost.ts
export function formatSearchCostLabel(args: {
  creditsUsed?: number;
  creditsPerSearchEstimate: number;
  costUsdEstimate: number;
}): string {
  if (args.creditsUsed != null) return `${args.creditsUsed} credit${args.creditsUsed === 1 ? "" : "s"}`;
  return `~$${args.costUsdEstimate.toFixed(2)} / ~${args.creditsPerSearchEstimate} credits`;
}

// lib/chat/favicon-url.ts
export function faviconUrl(host: string, size: number = 32): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}
```

### Streaming behavior preservation

The existing `MessageRow` passes `parseIncompleteMarkdown={isGenerating || isAborted || isFailed}` to `<MessageResponse>` (`message-list.tsx:419`). Preserve that on the `text` part renderer. Only one `text` part is expected per assistant turn pre-tool; multiple `text` parts are allowed when the model emits text → tool-call → text pattern.

### Citation chips coexistence

`[Pn]` rewrite happens inside the `text` part renderer (`splitTextForChips` at `message-list.tsx:132-187`). Web URL chips live separately at the message footer. No collision.

## TDD sequence

Phase A — pure logic (one commit per green):

R1 — RED: `format-search-cost.test.ts`:
- known `creditsUsed: 1` → `"1 credit"`
- known `creditsUsed: 2` → `"2 credits"`
- unknown: returns the estimate string `"~$0.02 / ~3 credits"`
- `creditsUsed: 0` → `"0 credits"` (deliberate — show free Tavily search)

R2 — RED: `favicon-url.test.ts`:
- `faviconUrl("arxiv.org")` → exact URL
- `faviconUrl("foo.bar.com", 64)` → respects size
- handles host with port → encodes correctly

G1, G2 — GREEN: implement helpers. Commits per pair.

Phase B — components (test-after, one commit per logical unit):

U1 — `<WebSourceChip>` + tests. Test: renders anchor with `target="_blank" rel="noreferrer noopener"`, `data-source-type="web"`, host derived from URL, falls back to host when title missing, has favicon `<img>`. Commit pair.

U2 — `<WebSourceChips>` + tests. Test: renders nothing for zero sources; renders N chips with `data-web-sources-count`. Commit pair.

U3 — `<ToolStep>` + tests. Test each state (`input-streaming`, `input-available`, `output-available`, `output-error`) renders the right `data-tool-state` attribute and the right text. Test cost label. Test ARIA `role="status"` during in-progress states and `role="alert"` on error. Test aborted-state heuristic when message status is aborted and tool state is incomplete. Commit per state test.

U4 — `<StepBoundary>` + tests. Test: renders `<hr data-step-boundary>` when sandwiched between `tool-*` `output-available` and `text`; renders null otherwise. Commit pair.

U5 — `MessageRow` refactor + tests. Test: text-only message renders text only; message with `[step-start, tool-web_search:input-streaming]` renders ToolStep; message with `[text, step-start, tool-web_search:output-available, source-url, source-url, step-start, text]` renders text → tool step → text → footer chips (chips at bottom regardless of part position). Commit per scenario.

## Files touched

- `components/ai-elements/tool-step.tsx` (new, ~ 130 LOC)
- `components/ai-elements/web-source-chip.tsx` (new, ~ 50 LOC)
- `components/ai-elements/web-source-chips.tsx` (new, ~ 30 LOC)
- `components/ai-elements/step-boundary.tsx` (new, ~ 30 LOC)
- `lib/chat/format-search-cost.ts` (new, ~ 20 LOC)
- `lib/chat/format-search-cost.test.ts` (new, ~ 40 LOC)
- `lib/chat/favicon-url.ts` (new, ~ 10 LOC)
- `lib/chat/favicon-url.test.ts` (new, ~ 30 LOC)
- `components/extraction/chat/message-list.tsx:383-516` (refactor of `MessageRow`, ~ 80 LOC modified)
- `tests/components/tool-step.test.tsx` (new, ~ 200 LOC)
- `tests/components/web-source-chips.test.tsx` (new, ~ 80 LOC)
- `tests/components/message-row-parts.test.tsx` (new, ~ 200 LOC)

## Migration stance

None — UI rendering refactor. Existing messages have `parts: [{type: "text", text}]` (or pure text via `joinText` per `node_modules/@convex-dev/agent/src/UIMessages.ts:774`); the new switch handles them identically. No data migration.

## Test plan

- All vitest unit tests above pass.
- Visual smoke: enable web search, ask a corpus-out-of-scope question, observe:
  1. The shimmer "Searching the web…" line appears with the live query streaming in.
  2. Transitions to "Searching: *<query>*" with a pulse on the icon.
  3. Resolves to "Found N results for: …" with a green checkmark and the actual cost annotation.
  4. The model's text streams below it.
  5. URL chips appear at the bottom of the assistant message.
- A11y smoke: VoiceOver announces "Status: Searching the web" during streaming and "Found N results" when complete; error path announces "Alert: Web search failed".

## Acceptance criteria

- [ ] `MessageRow` iterates `parts[]` instead of using a single text blob.
- [ ] `<ToolStep>` renders every `ToolUIPart` state with the right `data-tool-state` and the right copy.
- [ ] Cost annotation appears via `formatSearchCostLabel`, falling back to estimate when `creditsUsed` is absent.
- [ ] `<WebSourceChip>` carries `data-source-type="web"` and uses Google's favicon endpoint.
- [ ] `<WebSourceChips>` renders all web sources at the message footer regardless of their position in `parts`.
- [ ] `<StepBoundary>` is visible only between a completed tool-call and following text.
- [ ] Existing `[Pn]` citation rewrites still work inside `text` parts.
- [ ] Streaming text still streams (no regression).
- [ ] All tests pass; `tsc --noEmit` clean.
- [ ] No test asserts on Tailwind class strings.

## Known pitfalls

- **`source-url` parts can arrive interleaved with text deltas** depending on provider — research agent 7 documented this. The renderer must handle "text part received → source-url part received → more text" without re-rendering text from scratch. Filtering source-urls into a footer collection sidesteps this entirely; do not attempt inline-link-rewriting at this stage.
- **`step-start` parts duplicate** when @convex-dev/agent's `toUIMessages` reconstructs synthetic `step-start` before each `tool-call` (`UIMessages.ts:504-506`). Render boundary heuristic must dedupe or it'll render visible separators twice — once for the persisted `step-start` and once for the synthetic.
- **Aborted tool parts** stay in `state: "input-streaming"` because no terminating chunk arrives. The renderer reads the outer message's `status` (`message.status === "failed"` after abort or error) to flip the visual to the aborted variant. Do not invent a new tool state.
- **Favicon IMG fallback**: Google's endpoint returns a default globe even on miss, so `onError` rarely fires. The DuckDuckGo fallback hint is documented but unused in V1; keep the helper simple. If a host has no favicon at all, the globe placeholder is acceptable.
- **`Streamdown` parses incomplete markdown only when the bool is true**. Confirm `parseIncompleteMarkdown` toggles correctly per part-streaming-state (which differs from message-level `isGenerating`). If a `text` part has its own `state: "streaming"` field (per AI SDK `TextUIPart`), prefer that.
- **Multiple text parts per assistant turn**: when the model emits text → tool-call → more text (typical for "Let me search… [tool] Based on this, …"), there will be 2+ `text` parts. Render each one in order. Do NOT join them into one — that breaks the natural rhythm of tool-step boundaries.
- **`message.text` shortcut**: `@convex-dev/agent`'s UIMessage has a convenience `text: string` joining all text parts (`UIMessages.ts:774`). DO NOT use it once you switch to `parts` rendering — it would double-render text alongside the loop. Iterate `parts` and ignore `text`.
- **Mobile**: cap chip count visually with truncation; render all chips but compress to a single line via `flex-wrap` and clip overflow with the existing `text-ellipsis` pattern. Don't introduce a "+N more" disclosure — the agent 7 best practices recommended it but this codebase favors flat layouts; defer until UX feedback demands it.
- **Reasoning parts** sneak in if the model emits chain-of-thought. V1 ignores them silently. If the user notices the dropped content, plan a follow-up; do not add reasoning rendering here.
