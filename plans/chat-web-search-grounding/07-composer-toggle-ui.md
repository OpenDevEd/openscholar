# 07 — Composer toggle UI

## Goal

Add a Globe-icon ghost-pill button next to the model picker in the chat composer footer that toggles per-thread web search on/off. Capability-gated by the active model. Tooltip explains cost. ARIA `aria-pressed` reflects state. No `useEffect` for state sync.

## Scope

In:
- New file `components/extraction/chat/web-search-toggle.tsx`: the new component.
- New file `tests/components/web-search-toggle.test.tsx`: vitest + Testing Library.
- `components/extraction/chat/message-composer.tsx:274-339`: insert `<WebSearchToggle ... />` between the model picker and the keyboard-hint span (left side of the toolbar).

Out:
- The mutation itself (plan 03).
- Parts rendering (plan 08).
- Cost-on-step UI (plan 08).

## Design

The component reads the chat thread's job row via the existing query (the same one the chat header / composer already use to know `chatModelId`, `isGenerating`, etc. — confirm exact name during implementation; if it requires an extension, prefer extending the existing query over adding a new one). It also reads `models.supportedParameters` to capability-gate.

Visual chrome: ghost pill matching the model picker. Globe icon (`lucide-react`'s `Globe`). Active state via `data-state="on"` and `aria-pressed`.

```tsx
// components/extraction/chat/web-search-toggle.tsx
"use client";

import { Globe } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { modelSupportsWebSearch } from "@/lib/chat/web-search-capability";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

interface WebSearchToggleProps {
  threadId: string;
  jobId: Id<"extractionJobs">;
  enabled: boolean;          // from parent — already read by composer
  modelSupportedParameters: string[] | undefined;
  isGenerating: boolean;
}

export function WebSearchToggle({
  threadId,
  enabled,
  modelSupportedParameters,
  isGenerating,
}: WebSearchToggleProps) {
  const setWebSearch = useMutation(api.chat.messages.setChatWebSearchEnabled);
  const supported = modelSupportsWebSearch({ supportedParameters: modelSupportedParameters });
  const disabled = !supported || isGenerating;

  const tooltipText = !supported
    ? "Selected model does not support web search."
    : enabled
    ? "Web search on. Click to disable."
    : "Search the web for current info (~$0.02 per search).";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={enabled}
          aria-label={enabled ? "Disable web search" : "Enable web search"}
          disabled={disabled}
          data-web-search-enabled={String(enabled)}
          data-web-search-supported={String(supported)}
          className={cn(
            "h-7 gap-1.5 rounded-full px-2 text-xs font-medium",
            enabled ? "text-foreground bg-accent" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          onClick={() => {
            void setWebSearch({ threadId, enabled: !enabled });
          }}
        >
          <Globe className="size-3.5" />
          <span className="hidden sm:inline">Web</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
```

### Composition into `message-composer.tsx`

Read the parent's job state once. The composer already has access to `chatModelId`, `isGenerating`, etc. — pass those plus the new `webSearchEnabled` flag (already on the job row after plan 01) and the model row's `supportedParameters` (resolve via the existing model query the composer uses for the model-picker label).

Insertion point: between line 280 and the keyboard-hint span at line 282 of `components/extraction/chat/message-composer.tsx`. The exact diff:

```tsx
<ComposerModelPicker ... />
+ <WebSearchToggle
+   threadId={threadId}
+   jobId={jobId}
+   enabled={Boolean(job.webSearchEnabled)}
+   modelSupportedParameters={selectedModel?.supportedParameters}
+   isGenerating={jobIsGenerating}
+ />
<span className="hidden sm:inline ...">⏎ send · Shift+⏎ new line</span>
```

If the composer does not yet receive `selectedModel` (with `supportedParameters`), extend its props or its data-fetching path to include it. Prefer extending the existing query result rather than firing a second query.

### CLAUDE.md compliance

- **No `useEffect`**: state derives from the Convex query result (`enabled` is a prop, `supported` is computed from prop, `disabled` is computed). The mutation runs in the click handler; nothing watches state for side-effects.
- **No URL state**: per `00-README.md` §5, the toggle is a thread-scope persistence concern, not a URL-shareable filter. Convex mutation is the right path.
- **Test stance**: assertions on `aria-pressed`, `data-web-search-enabled`, `data-web-search-supported`, role/text — never on Tailwind classes.

### A11y

- `aria-pressed={enabled}` on the button — communicates toggle state to assistive tech.
- `aria-label` switches between "Enable" and "Disable" so screen readers don't announce an ambiguous "Web" button.
- Tooltip surfaces the cost and unsupported-model reason.
- Disabled state via the native `disabled` attribute. Avoid pointer-events:none-only-CSS.

## TDD sequence

Phase A — pure logic: there is no new pure helper here (capability helper lives in plan 01). Skip Phase A.

Phase B — test-after, one commit per logical unit:

U1 — Build the component with stubs for `useMutation`/`useQuery`. Commit `feat(chat): [plan-07] WebSearchToggle component`.

U2 — Wire into `message-composer.tsx`. Commit `feat(chat): [plan-07] mount WebSearchToggle in composer toolbar`.

U3 — Tests. Each scenario is a separate commit:
- `test(chat): [plan-07] WebSearchToggle reflects enabled state via aria-pressed`
- `test(chat): [plan-07] WebSearchToggle disabled when model lacks tools support`
- `test(chat): [plan-07] WebSearchToggle calls setChatWebSearchEnabled on click`
- `test(chat): [plan-07] WebSearchToggle disabled while generating`
- `test(chat): [plan-07] WebSearchToggle tooltip text changes by state`

## Files touched

- `components/extraction/chat/web-search-toggle.tsx` (new, ~ 70 LOC)
- `tests/components/web-search-toggle.test.tsx` (new, ~ 130 LOC)
- `components/extraction/chat/message-composer.tsx` (~ 10 LOC additions for the new prop wiring + the JSX insertion)
- Possibly `components/extraction/chat/chat-job-view.tsx` if it owns the data fetching for the composer — extend with `selectedModel` resolution.

## Migration stance

None — UI-only addition. Existing rows display the toggle as off/disabled correctly because `webSearchEnabled` is `undefined` and `enabled` falls back to `false`.

## Test plan

- All component test cases above pass.
- Manual smoke: open chat in dev, observe the toggle next to the model picker; click; observe optimistic-pending UI followed by Convex query refetch settling the visual state; confirm the chat job row updates in the dashboard; switch model to one without tool support and confirm the toggle visibly disables.
- A11y smoke: toggle keyboard nav with Tab, observe focus ring; press Space/Enter to flip; screen-reader narration via VoiceOver — should hear "Web, button, pressed" / "Web, button, not pressed".

## Acceptance criteria

- [ ] `WebSearchToggle` exists and renders a button with `aria-pressed` matching `enabled`.
- [ ] When `modelSupportedParameters` lacks `"tools"`, the button is `disabled` and the tooltip explains why.
- [ ] When `isGenerating` is true, the button is `disabled` regardless of capability.
- [ ] Click handler calls `setChatWebSearchEnabled` with the negated current value.
- [ ] `data-web-search-enabled`, `data-web-search-supported` attributes track state for tests.
- [ ] No `useEffect` is used in the new component.
- [ ] No Tailwind class assertion appears in any test.
- [ ] `tsc --noEmit` clean. All new and existing tests pass.
- [ ] Mobile renders the icon-only variant (`hidden sm:inline` on the label).

## Known pitfalls

- **Do not** pass `supported` as a prop. Compute it inside the component from `modelSupportedParameters` so a single-source-of-truth helper applies. If you compute it in the parent and pass the boolean, future changes to the helper require touching every caller.
- **Do not** introduce a `useState` for the toggle. State lives on the server (via the Convex query); the prop IS the truth. Optimistic updates are the Convex `useMutation().withOptimisticUpdate(...)` path if needed for snappier UX — but avoid until proven needed; the mutation is single-row and Convex's reactivity is fast.
- **Do not** put the toggle inside the model picker popover. It belongs at the toolbar level, parallel to the picker.
- **Do not** swap `Tooltip` for a custom popover; the project already uses shadcn `Tooltip`.
- **Avoid** adding the cost number dynamically per-model. Use the static "~$0.02 per search" tooltip text. Real per-call cost is rendered on the tool-step component (plan 08), where the actual number is known.
- **Globe icon variants**: `Globe` (network globe) is correct. Avoid `GlobeLock` (privacy) or `Search` (search lens) — wrong semantic.
- **Disabled button must NOT trigger the tooltip's pointer events** to be lost. shadcn `Tooltip` handles this correctly when the trigger is wrapped in `asChild`. Test the disabled-state tooltip explicitly.
