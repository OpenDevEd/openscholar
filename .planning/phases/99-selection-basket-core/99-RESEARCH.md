# Phase 99: Selection Basket Core - Research

**Researched:** 2026-04-15
**Domain:** Client-side state management (Zustand + sessionStorage), UI drawer component, OpenAlex ID normalization
**Confidence:** HIGH

## Summary

Phase 99 is a purely client-side phase with zero backend dependency. It creates three net-new artifacts: (1) a Zustand store persisted to sessionStorage that holds a Map of basket entries keyed by normalized OpenAlex ID, (2) a `normalizeOpenAlexId` utility for deduplication, and (3) a Sheet-based drawer showing basket contents with per-source breakdown. The phase also introduces a `useAddToBasket` hook as the public API surface for downstream phases (102, 103).

The codebase already has all required primitives installed: Zustand v5.0.12 with `persist`/`createJSONStorage` middleware, shadcn Sheet component backed by Radix Dialog, Accordion for collapsible sections, Badge for source tags, and `motion/react` v12 for animations. No new npm dependencies are required. The primary technical challenge is Map serialization for sessionStorage (Zustand's `createJSONStorage` does not natively handle `Map`), which requires a custom `PersistStorage` implementation or `partialize` + `onRehydrateStorage` to convert Map entries to/from arrays.

**Primary recommendation:** Use `partialize` to serialize the Map as an array of `[key, value]` tuples and reconstruct the Map in `onRehydrateStorage`, following Zustand's official Map persistence pattern. This avoids adding `superjson` as a dependency.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Create a dedicated basket store in `lib/store/extraction-basket.ts` -- NOT inside the existing `lib/store.ts` (42KB monolith). Follow the `createSidebarStore` factory pattern from `lib/store.ts:1070` as a structural template. Use Zustand `persist` middleware with `createJSONStorage(() => sessionStorage)` -- the first sessionStorage-backed store in the codebase. Export as `useExtractionBasketStore`.
- **D-02:** The store is cleared only on successful job creation (not on page refresh, not on sign-out). sessionStorage naturally scopes to the browser tab -- different tabs get independent baskets.
- **D-03:** Each basket entry stores rich metadata: `{ openAlexId: string, title: string, doi: string | null, source: BasketSource, addedAt: number }` where `BasketSource = "library" | "collection" | "search" | "manual" | "zotero"`. The `openAlexId` is the normalized canonical form (always `W\d+`). Title and DOI are stored at add-time to avoid re-fetch when displaying the drawer. The `source` field enables the per-source breakdown required by SEL-09.
- **D-04:** The store's internal data structure is a `Map<string, BasketEntry>` keyed by normalized OpenAlex ID. Dedupe is enforced at the Map level -- `add` is idempotent (adding an already-present ID is a no-op that preserves the original entry). Expose `count`, `entries`, `entriesBySource`, `has(id)`, `add(entry | entry[])`, `remove(id)`, `clear()`.
- **D-05:** Create a `normalizeOpenAlexId(input: string): string | null` utility in `lib/openalex/normalize.ts`. It handles three formats: bare `W123`, full URL `https://openalex.org/W123`, and prefixed `openalex:W123`. Returns the canonical `W\d+` form or `null` for unparseable input. All basket add-paths MUST normalize before inserting.
- **D-06:** The basket drawer uses shadcn `Sheet` (side="right") from `components/ui/sheet.tsx`. Layout: sticky header with global count ("X papers"), collapsible per-source sections (Library, Search, Manual, etc.) each showing section count and paper list, and a sticky footer with "Review & start extraction" CTA button that navigates to `/extraction/new`.
- **D-07:** Each paper row in the drawer shows title (truncated), DOI (if available), source badge, and a remove button (X icon). No inline editing, no reordering.
- **D-08:** Papers already in the basket show a muted/checked checkbox state with an "In basket" label in any source list. This reuses the same visual pattern that Phase 102 will use for cap-disabled checkboxes (LIM-05), maintaining consistency. The indicator is driven by `useExtractionBasketStore(s => s.has(normalizedId))`.
- **D-09:** Create a `useAddToBasket` hook in `lib/hooks/use-add-to-basket.ts` that wraps `normalizeOpenAlexId` + `useExtractionBasketStore.add()` with validation and returns `{ addToBasket, removeFromBasket, isInBasket, basketCount }`. This is the public API consumed by Phase 102's `<AddToExtractionButton>` and Phase 103's selector tabs.

### Claude's Discretion
- Internal naming for helper functions within the store
- Exact truncation length for paper titles in the drawer
- Animation spring config for drawer open/close (use existing `lib/animation-config.ts` presets)
- Whether to use a Zustand selector pattern or direct subscription for the `has(id)` check
- Test file organization for the normalizeOpenAlexId utility

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEL-07 | Selection basket persists across tab switches and client-side navigation within the same browser session via a Zustand store backed by `sessionStorage` (cleared only on successful job creation) | Zustand v5.0.12 `persist` middleware with `createJSONStorage(() => sessionStorage)` -- verified pattern in official docs. Custom storage needed for Map serialization. See Architecture Patterns section. |
| SEL-08 | Basket dedupes papers across sources using `normalizeOpenAlexId` utility (handles `W123`, `https://openalex.org/W123`, `openalex:W123`) so the same paper added from two sources counts exactly once | Pure regex utility in `lib/openalex/normalize.ts`. Map-key-based O(1) dedupe. See Don't Hand-Roll and Code Examples sections. |
| SEL-09 | User can open a persistent basket drawer (shadcn `Sheet`) from anywhere in the app showing the total count, per-source breakdown, and a "Review & start extraction" CTA | shadcn Sheet (radix-ui v1.4.3, already installed) with `side="right"`. Accordion component exists for collapsible per-source sections. See Architecture Patterns section. |
| SEL-10 | User can remove individual papers from the basket before submitting, and sees a visual "already in basket" indicator next to papers that are already staged when browsing any source tab | `has(id)` as Zustand selector for O(1) lookup; `remove(id)` mutates the Map. Badge component exists for "In basket" indicator. See Common Pitfalls (render storms). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Backend:** Convex. Must read `convex/_generated/ai/guidelines.md` before writing any Convex code. However, Phase 99 has ZERO Convex dependency -- purely client-side.
- **Styling:** TailwindCSS v4 with OKLCH color space, `cn()` utility from `lib/utils.ts`.
- **Components:** shadcn/ui primitives in `components/ui/`. CVA for variants.
- **State:** Zustand for global state, `nuqs` for URL state.
- **Motion:** `motion/react` v12 with spring presets from `lib/animation-config.ts`.
- **Accessibility:** WCAG AAA target (7:1 contrast, enhanced focus indicators, full reduced-motion support).
- **i18n:** `next-intl` with 6 locales (en-US, en-GB, fr, ja, zh, hi). All new UI strings MUST be added to all locales.
- **Naming:** kebab-case files, `useXxxStore` for Zustand stores, `SCREAMING_SNAKE_CASE` for constants.
- **No legacy code:** Destructive cleanup preferred; no dead code.
- **TypeScript strict mode:** `strict: true`, no `any` types (enforced by `scripts/verify-no-any.sh`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Basket state (add/remove/clear/has) | Browser / Client | -- | Pure client-side Zustand store; no backend needed for staging papers |
| Session persistence | Browser / Client | -- | sessionStorage is browser-only; scoped to tab by design |
| OpenAlex ID normalization | Browser / Client | -- | Pure function; runs at add-time on the client |
| Basket drawer UI | Browser / Client | -- | Sheet component rendered on client; reads from Zustand store |
| "Already in basket" indicator | Browser / Client | -- | Selector-driven from Zustand store; no server round-trip |
| Basket clear on job creation | Browser / Client | API / Backend | Client clears store after `createExtractionJob` mutation succeeds (Phase 103 wires this) |

## Standard Stack

### Core (Already Installed -- No New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | 5.0.12 | Client state management with persistence | [VERIFIED: npm view] Already in use across 10+ stores in `lib/store.ts` |
| radix-ui | 1.4.3 | Sheet (Dialog) primitive for drawer | [VERIFIED: npm view] Powers shadcn Sheet component already in `components/ui/sheet.tsx` |
| motion/react | ^12.23.12 | Spring animations for drawer open/close | [VERIFIED: package.json] Used in sidebar, command centers, card entrances |
| lucide-react | ^0.487.0 | Icons (X for remove, Package for basket) | [VERIFIED: package.json] Standard icon set across entire app |
| class-variance-authority | (installed) | Badge variants for source tags | [VERIFIED: components/ui/badge.tsx] Used for all variant-based components |

### Supporting (Already Available)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next-intl | (installed) | i18n for drawer labels, basket count text | All user-facing strings in drawer and indicators |
| @testing-library/react | (installed) | Hook/component testing | Unit tests for `normalizeOpenAlexId`, integration tests for `useAddToBasket` |
| vitest | ^3.2.4 | Test runner | All unit tests for this phase |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom Map storage | superjson | Adds 7KB dependency for Map/Set serialization; overkill when `partialize` + array conversion is 10 lines of code |
| Sheet (side drawer) | Vaul Drawer (already in `components/ui/drawer.tsx`) | Vaul is bottom-sheet oriented (mobile-first pull gesture); Sheet with `side="right"` is the correct desktop side-panel pattern |
| Accordion for per-source sections | Collapsible primitive | Accordion already installed and styled; Collapsible is NOT installed and would need to be added |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### System Architecture Diagram

```
User Action (click "Add to basket")
    |
    v
useAddToBasket hook (lib/hooks/use-add-to-basket.ts)
    |
    +--> normalizeOpenAlexId(rawId) --> canonical "W\d+" or null
    |
    +--> useExtractionBasketStore.add(entry)
         |
         +--> Map.has(key) check (dedupe gate)
         |    |
         |    +--> Already exists: no-op (idempotent)
         |    +--> New: Map.set(key, entry)
         |
         +--> Zustand persist middleware
              |
              +--> partialize: Map --> [key, value][] array
              +--> sessionStorage.setItem("extraction-basket", JSON.stringify(...))
              
Sheet Drawer (any page)
    |
    +--> useExtractionBasketStore selectors
    |    |
    |    +--> count: Map.size
    |    +--> entries: Array.from(Map.values())
    |    +--> entriesBySource: group entries by source field
    |    +--> has(id): Map.has(normalizeOpenAlexId(id))
    |
    +--> Accordion per source --> paper rows
    |
    +--> Footer CTA --> router.push("/extraction/new")

Page Refresh / Tab Navigation
    |
    +--> onRehydrateStorage
         |
         +--> JSON.parse from sessionStorage
         +--> [key, value][] array --> new Map(entries)
         +--> _hasHydrated = true
```

### Recommended Project Structure

```
lib/
  store/
    extraction-basket.ts       # Zustand store (useExtractionBasketStore)
  openalex/
    normalize.ts               # normalizeOpenAlexId utility (NEW)
    reconstruct-abstract.ts    # (existing)
  hooks/
    use-add-to-basket.ts       # Public hook API (NEW)
    use-cooldown.ts            # (existing)
    use-debounced-value.ts     # (existing)
    use-selection.ts           # (existing)
    use-url-state.ts           # (existing)

components/
  extraction/
    extraction-basket-drawer.tsx  # Sheet drawer component (NEW)

tests/
  normalize-openalex-id.test.ts  # Unit tests for normalizer (NEW)
  extraction-basket-store.test.ts # Store tests (NEW)
```

### Pattern 1: Zustand Store with sessionStorage and Map Serialization

**What:** A Zustand store using `persist` middleware with a custom storage adapter that serializes/deserializes a Map to/from sessionStorage.

**When to use:** When the store's internal state uses a Map (for O(1) key-based lookup) but needs JSON-serializable persistence.

**Example:**
```typescript
// Source: https://github.com/pmndrs/zustand/blob/main/docs/reference/integrations/persisting-store-data.md
// "How do I use it with Map and Set" section [VERIFIED: Context7 /pmndrs/zustand]

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

interface BasketEntry {
  openAlexId: string;
  title: string;
  doi: string | null;
  source: BasketSource;
  addedAt: number;
}

type BasketSource = "library" | "collection" | "search" | "manual" | "zotero";

interface ExtractionBasketState {
  papers: Map<string, BasketEntry>;
  _hasHydrated: boolean;
  // Derived / computed
  count: number;
  // Actions
  add: (entry: BasketEntry | BasketEntry[]) => void;
  remove: (id: string) => void;
  has: (id: string) => boolean;
  clear: () => void;
  setHasHydrated: (state: boolean) => void;
}

// Custom storage that handles Map <-> Array serialization
const basketStorage: PersistStorage<Pick<ExtractionBasketState, "papers">> = {
  getItem: (name) => {
    const str = sessionStorage.getItem(name);
    if (!str) return null;
    const parsed = JSON.parse(str);
    return {
      ...parsed,
      state: {
        ...parsed.state,
        papers: new Map(parsed.state.papers),
      },
    };
  },
  setItem: (name, value: StorageValue<Pick<ExtractionBasketState, "papers">>) => {
    const serializable = {
      ...value,
      state: {
        ...value.state,
        papers: Array.from(value.state.papers.entries()),
      },
    };
    sessionStorage.setItem(name, JSON.stringify(serializable));
  },
  removeItem: (name) => sessionStorage.removeItem(name),
};
```

### Pattern 2: Hydration-Safe Rendering

**What:** Zustand stores persisted to storage have a hydration delay on first render. Components must gate on `_hasHydrated` to avoid flash of empty state.

**When to use:** Any component that reads from the persisted basket store.

**Example:**
```typescript
// Source: Zustand persist docs "Check Hydration Status" [VERIFIED: Context7]
// Matches existing pattern from lib/store.ts:1070 (createSidebarStore)

const hasHydrated = useExtractionBasketStore((s) => s._hasHydrated);
const count = useExtractionBasketStore((s) => s.count);

if (!hasHydrated) return null; // or skeleton
```

### Pattern 3: Zustand Selector for O(1) Membership Check

**What:** Using a Zustand selector to check if a specific paper is in the basket, with minimal re-renders.

**When to use:** "Already in basket" indicators in paper lists (SEL-10).

**Example:**
```typescript
// Selector pattern -- only re-renders when this specific paper's membership changes
// React 19 + Zustand v5 uses useSyncExternalStore internally [ASSUMED]
const isInBasket = useExtractionBasketStore((s) => s.has(normalizedId));
```

**Important:** The `has(id)` method reads from `Map.has()` which is O(1). However, Zustand's default equality check is `Object.is`, so the selector `s => s.has(id)` returns a boolean -- this will only trigger re-render when the boolean value actually changes (paper added or removed). This is optimal for lists of 100+ papers.

### Anti-Patterns to Avoid

- **Anti-pattern: Storing the entire Map as a dependency in `useEffect`:** Maps are reference-equal only to themselves. Use `store.count` or `store.has(id)` as selectors, never `store.papers` directly in a dependency array.
- **Anti-pattern: Normalizing IDs inside the store:** Normalization should happen BEFORE calling `store.add()`. The store should only accept pre-normalized IDs. The `useAddToBasket` hook enforces this boundary.
- **Anti-pattern: Using `createJSONStorage(() => sessionStorage)` directly with Map:** `JSON.stringify` turns a Map into `{}`. The custom `PersistStorage` implementation is mandatory.
- **Anti-pattern: Putting basket state in a React Context:** Context re-renders all consumers on any state change. Zustand with selectors gives fine-grained subscriptions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON storage for Map | Custom JSON.parse/stringify wrapper | Zustand `PersistStorage<T>` interface | Official contract handles versioning, migration, error recovery |
| Collapsible sections in drawer | Custom useState toggle per section | shadcn Accordion (`components/ui/accordion.tsx`) | Already installed, accessible (ARIA), animated, handles keyboard nav |
| Source badges in drawer | Custom colored spans | shadcn Badge (`components/ui/badge.tsx`) with CVA variants | Consistent styling, variant system, accessible |
| Side panel overlay | Custom portal + backdrop | shadcn Sheet (`components/ui/sheet.tsx`) | Focus trap, escape-to-close, overlay click-to-close, animated, accessible |
| OpenAlex ID parsing | Complex URL parser library | Single regex: `/^(?:https?:\/\/openalex\.org\/)?(openalex:)?(W\d+)/i` | Three formats only; regex is complete and testable |

**Key insight:** This phase creates infrastructure (store + hook + normalizer) that Phase 102 and 103 consume. The public API surface (`useAddToBasket` hook) must be stable and well-typed because 4+ downstream files will import it.

## Common Pitfalls

### Pitfall 1: Map Serialization to sessionStorage (PITFALL 3 from phase description)

**What goes wrong:** `JSON.stringify(new Map([["a", 1]]))` produces `"{}"`. The basket appears empty after page navigation.
**Why it happens:** JavaScript's `JSON.stringify` does not serialize Map or Set natively.
**How to avoid:** Implement a custom `PersistStorage<T>` that converts Map to `Array.from(map.entries())` on write and `new Map(entries)` on read. Do NOT use `createJSONStorage(() => sessionStorage)` -- use the custom storage object directly. [VERIFIED: Context7 /pmndrs/zustand "How do I use it with Map and Set"]
**Warning signs:** Basket count resets to 0 on client-side navigation; sessionStorage key exists but `papers` is `{}`.

### Pitfall 2: Hydration Flash (PITFALL 5 from phase description)

**What goes wrong:** Components reading basket count show 0 for one render frame before sessionStorage is parsed.
**Why it happens:** Zustand persist rehydrates asynchronously. The initial state has an empty Map.
**How to avoid:** Track `_hasHydrated` boolean (same pattern as `createSidebarStore` at `lib/store.ts:1070`). Gate UI on hydration completion. [VERIFIED: codebase grep]
**Warning signs:** Badge flashes "0" then jumps to actual count; drawer shows "empty basket" before populating.

### Pitfall 3: Render Storms from Map Reference Equality (PITFALL 7 from phase description)

**What goes wrong:** Every paper row in a 100+ item list re-renders on every basket change.
**Why it happens:** Selecting `s => s.papers` returns a new Map reference on every store update. All subscribers re-render.
**How to avoid:** Use fine-grained selectors: `s => s.has(id)` returns a boolean (stable unless that specific paper's membership changes). Never subscribe to the entire Map. For the count, use `s => s.count` (a number, stable reference). [ASSUMED]
**Warning signs:** Sluggish UI when adding papers in bulk; React DevTools shows excessive re-renders.

### Pitfall 4: sessionStorage Size Limits

**What goes wrong:** At 1000 papers with rich metadata, the serialized basket could approach sessionStorage limits.
**Why it happens:** sessionStorage has a ~5 MB limit per origin. Each entry has openAlexId (~10 chars), title (~200 chars), doi (~40 chars), source (~10 chars), addedAt (~13 chars). Rough estimate: 1000 entries x 300 bytes = 300 KB. Well within limits.
**How to avoid:** No action needed -- 300 KB is far under 5 MB. But `partialize` should exclude functions and `_hasHydrated` from persistence (only `papers` Map). [VERIFIED: arithmetic estimate]
**Warning signs:** `QuotaExceededError` in console.

### Pitfall 5: URL Query Parameter Stripping in Normalization

**What goes wrong:** `normalizeOpenAlexId("https://openalex.org/W123?source=api")` fails to extract `W123`.
**Why it happens:** Naive regex may include `?source=api` in the match.
**How to avoid:** The regex should match `W\d+` specifically, not the remainder of the URL. Test with URLs containing query params, fragments, and trailing slashes. [ASSUMED]
**Warning signs:** Duplicate entries for the same paper added from different URL formats.

### Pitfall 6: Store File Path -- `lib/store/` Directory Does Not Exist

**What goes wrong:** Creating `lib/store/extraction-basket.ts` fails because `lib/store/` directory was deleted in a prior teardown phase.
**Why it happens:** Phase 88 (scorched-earth teardown) deleted `lib/store/extraction.ts` and the directory is now empty/absent.
**How to avoid:** Plan must include creating the `lib/store/` directory. [VERIFIED: `ls` shows directory does not exist]
**Warning signs:** File creation error or module resolution failure.

## Code Examples

### normalizeOpenAlexId Utility

```typescript
// lib/openalex/normalize.ts
// Source: D-05 decision, regex covers all three specified formats [ASSUMED]

/**
 * Normalize an OpenAlex work ID to its canonical W\d+ form.
 *
 * Handles:
 *   - Bare ID: "W123456789"
 *   - Full URL: "https://openalex.org/W123456789" (with optional query params)
 *   - Prefixed: "openalex:W123456789"
 *
 * @returns Canonical "W\d+" string, or null if input is not a valid OpenAlex work ID.
 */
export function normalizeOpenAlexId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Match W followed by digits, preceded by optional URL or prefix
  const match = trimmed.match(
    /^(?:https?:\/\/openalex\.org\/)?(?:openalex:)?(W\d+)/i,
  );
  if (!match) return null;

  // Uppercase W for canonical form
  return match[1].toUpperCase();
}
```

### Custom PersistStorage for Map

```typescript
// lib/store/extraction-basket.ts (partial -- storage adapter)
// Source: Zustand official docs "How do I use it with Map and Set"
// [VERIFIED: Context7 /pmndrs/zustand]

import type { PersistStorage, StorageValue } from "zustand/middleware";

interface PersistedBasketState {
  papers: Map<string, BasketEntry>;
}

const basketStorage: PersistStorage<PersistedBasketState> = {
  getItem: (name) => {
    const str = sessionStorage.getItem(name);
    if (!str) return null;
    const parsed: StorageValue<{ papers: [string, BasketEntry][] }> =
      JSON.parse(str);
    return {
      ...parsed,
      state: {
        ...parsed.state,
        papers: new Map(parsed.state.papers),
      },
    };
  },
  setItem: (name, value) => {
    sessionStorage.setItem(
      name,
      JSON.stringify({
        ...value,
        state: {
          ...value.state,
          papers: Array.from(value.state.papers.entries()),
        },
      }),
    );
  },
  removeItem: (name) => sessionStorage.removeItem(name),
};
```

### Store Definition (Skeleton)

```typescript
// lib/store/extraction-basket.ts (full store skeleton)
// Follows createSidebarStore pattern from lib/store.ts:1070 [VERIFIED: codebase]

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useExtractionBasketStore = create<ExtractionBasketState>()(
  persist(
    (set, get) => ({
      papers: new Map<string, BasketEntry>(),
      _hasHydrated: false,
      get count() {
        return get().papers.size;
      },
      has: (id: string) => get().papers.has(id),
      add: (input) => {
        const entries = Array.isArray(input) ? input : [input];
        set((state) => {
          const next = new Map(state.papers);
          for (const entry of entries) {
            if (!next.has(entry.openAlexId)) {
              next.set(entry.openAlexId, entry);
            }
          }
          return { papers: next };
        });
      },
      remove: (id: string) =>
        set((state) => {
          const next = new Map(state.papers);
          next.delete(id);
          return { papers: next };
        }),
      clear: () => set({ papers: new Map() }),
      setHasHydrated: (hydrated: boolean) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: "extraction-basket",
      version: 1,
      storage: basketStorage,
      partialize: (state) => ({ papers: state.papers }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
```

**Note on `count` as getter:** Zustand v5 does not support ES getters inside `create`. The `count` must be either a derived selector consumed as `useExtractionBasketStore(s => s.papers.size)` or computed in the `add`/`remove`/`clear` actions and stored as a plain number alongside the Map. The selector approach is preferred since it avoids duplicating state. [ASSUMED -- needs verification during implementation]

### useAddToBasket Hook

```typescript
// lib/hooks/use-add-to-basket.ts
// Source: D-09 decision [VERIFIED: CONTEXT.md]

import { useCallback } from "react";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
import type { BasketEntry, BasketSource } from "@/lib/store/extraction-basket";

interface AddToBasketInput {
  rawId: string;
  title: string;
  doi: string | null;
  source: BasketSource;
}

export function useAddToBasket() {
  const add = useExtractionBasketStore((s) => s.add);
  const remove = useExtractionBasketStore((s) => s.remove);
  const count = useExtractionBasketStore((s) => s.papers.size);

  const addToBasket = useCallback(
    (input: AddToBasketInput | AddToBasketInput[]) => {
      const inputs = Array.isArray(input) ? input : [input];
      const entries: BasketEntry[] = [];
      for (const item of inputs) {
        const normalized = normalizeOpenAlexId(item.rawId);
        if (normalized) {
          entries.push({
            openAlexId: normalized,
            title: item.title,
            doi: item.doi,
            source: item.source,
            addedAt: Date.now(),
          });
        }
      }
      if (entries.length > 0) {
        add(entries);
      }
    },
    [add],
  );

  const removeFromBasket = useCallback(
    (rawId: string) => {
      const normalized = normalizeOpenAlexId(rawId);
      if (normalized) remove(normalized);
    },
    [remove],
  );

  const isInBasket = useCallback(
    (rawId: string) => {
      const normalized = normalizeOpenAlexId(rawId);
      if (!normalized) return false;
      return useExtractionBasketStore.getState().has(normalized);
    },
    [],
  );

  return { addToBasket, removeFromBasket, isInBasket, basketCount: count };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zustand v4 `create()(persist(...))` | Zustand v5 same API, improved TypeScript inference | v5.0.0 (late 2024) | No code change needed; v5 is a TS-only major bump [VERIFIED: Context7] |
| `createJSONStorage` without reviver/replacer | `createJSONStorage` with optional `{ reviver, replacer }` OR custom `PersistStorage` | Zustand v4.4+ | Custom storage is the canonical pattern for Map/Set [VERIFIED: Context7] |
| Radix Dialog as Sheet | radix-ui unified package (v1.4.3) replaces `@radix-ui/react-dialog` | 2025 | Sheet component in codebase already uses `radix-ui` import [VERIFIED: components/ui/sheet.tsx] |

**Deprecated/outdated:**
- Nothing deprecated that affects this phase. Zustand v5 is current (v5.0.12 latest). [VERIFIED: npm view]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zustand v5 does not support ES getters inside `create()` -- `count` should be a selector, not a getter | Code Examples (Store Definition) | LOW -- if getters work, it is a minor refactor to use one instead of a selector |
| A2 | Zustand selector `s => s.has(id)` with boolean return provides fine-grained re-render control (only re-renders when boolean changes) | Pattern 3, Pitfall 3 | MEDIUM -- if Zustand does not optimize boolean selectors, render storms could occur in large lists; mitigation is `useShallow` or external equality fn |
| A3 | React 19 + Zustand v5 uses `useSyncExternalStore` internally | Pattern 3 | LOW -- implementation detail, does not affect correctness |
| A4 | normalizeOpenAlexId regex handles all edge cases including URLs with query params, fragments, and trailing slashes | Pitfall 5 | MEDIUM -- untested regex; must be covered by comprehensive unit tests |

## Open Questions

1. **`count` implementation: derived selector vs stored number**
   - What we know: Zustand v5 stores are plain objects. ES getters may or may not work inside `create()`.
   - What's unclear: Whether `get count() { return get().papers.size; }` is valid in Zustand v5 `create` callback.
   - Recommendation: Use a selector pattern `useExtractionBasketStore(s => s.papers.size)` -- always works, avoids ambiguity. If the team prefers a `count` property, compute it alongside Map mutations in `add`/`remove`/`clear`.

2. **`entriesBySource` implementation: computed on read vs cached**
   - What we know: D-04 requires `entriesBySource` as an exposed method. Grouping 1000 entries by source on every read is O(n).
   - What's unclear: Whether the drawer re-renders frequently enough to warrant caching.
   - Recommendation: Compute on read via a selector or method. O(1000) grouping is < 1ms. Premature caching adds complexity.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/normalize-openalex-id.test.ts tests/extraction-basket-store.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEL-07 | Basket persists across Zustand rehydration from sessionStorage | unit | `npx vitest run tests/extraction-basket-store.test.ts -t "rehydrate" -x` | Wave 0 |
| SEL-08 | normalizeOpenAlexId handles W123, URL, openalex: prefix | unit | `npx vitest run tests/normalize-openalex-id.test.ts -x` | Wave 0 |
| SEL-08 | Dedupe: adding same paper via different formats results in single entry | unit | `npx vitest run tests/extraction-basket-store.test.ts -t "dedupe" -x` | Wave 0 |
| SEL-09 | Drawer renders count, per-source breakdown, CTA | manual-only | Manual: open drawer in browser | N/A -- component test requires full DOM + router context |
| SEL-10 | Remove paper from store, has() returns false | unit | `npx vitest run tests/extraction-basket-store.test.ts -t "remove" -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/normalize-openalex-id.test.ts tests/extraction-basket-store.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/normalize-openalex-id.test.ts` -- covers SEL-08 (normalization)
- [ ] `tests/extraction-basket-store.test.ts` -- covers SEL-07 (persistence), SEL-08 (dedupe), SEL-10 (remove)
- [ ] sessionStorage mock: Vitest node environment does not have `sessionStorage`. Tests must either use jsdom environment or mock `sessionStorage` via `vi.stubGlobal`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 99 is purely client-side; no auth changes |
| V3 Session Management | no | sessionStorage is tab-scoped, not a security session |
| V4 Access Control | no | No backend mutations in this phase |
| V5 Input Validation | yes | `normalizeOpenAlexId` validates and sanitizes input; returns null for invalid |
| V6 Cryptography | no | No secrets or encryption |

### Known Threat Patterns for Client State

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS injecting malicious data into sessionStorage | Tampering | Next.js CSP headers + React's JSX auto-escaping; store data is never `dangerouslySetInnerHTML`'d |
| sessionStorage data visible to same-origin scripts | Information Disclosure | Basket contains only public paper metadata (title, DOI, OpenAlex ID) -- no PII, no secrets |

## Sources

### Primary (HIGH confidence)
- [Context7 /pmndrs/zustand] -- persist middleware, createJSONStorage, Map serialization patterns, hydration, version migration
- [npm view zustand] -- v5.0.12 confirmed as latest and installed
- [npm view radix-ui] -- v1.4.3 confirmed as installed
- [Codebase: lib/store.ts:1070-1095] -- createSidebarStore factory pattern (structural template)
- [Codebase: components/ui/sheet.tsx] -- Sheet component API (side, showCloseButton)
- [Codebase: components/ui/accordion.tsx] -- Accordion component API (collapsible sections)
- [Codebase: components/ui/badge.tsx] -- Badge component API (source tags)
- [Codebase: lib/animation-config.ts] -- Spring presets (subtleSpring, commandCenterSpring, cardEntrance)
- [Codebase: convex/lib/queryBounds.ts] -- MAX_EXTRACTION_PAPERS_PER_JOB = 1000

### Secondary (MEDIUM confidence)
- [package.json] -- Dependency versions cross-referenced with npm registry

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and version-verified against npm registry
- Architecture: HIGH -- follows established codebase patterns (createSidebarStore factory, persist middleware, Sheet component)
- Pitfalls: HIGH -- Map serialization pitfall is documented in official Zustand docs; hydration pitfall matches existing `_hasHydrated` pattern in codebase

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- all dependencies are pinned/installed)
