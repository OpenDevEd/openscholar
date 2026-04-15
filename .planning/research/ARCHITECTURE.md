# Architecture Research — v7.0 Extraction Workbench

**Domain:** Cross-source paper selector + results workbench integration into an existing Next.js 15 (App Router) + Convex stack
**Researched:** 2026-04-15
**Confidence:** HIGH (direct codebase analysis of schema, mutations, dialogs, store factory, and the orphaned Zotero module)

---

## 0. Executive Summary

This milestone does not introduce a new architecture — it **wires up pieces that were built in v6.0 but left disconnected** and **adds a selection-basket/workbench layer on top**. The six load-bearing decisions are:

1. **Basket storage: Ephemeral Zustand (sessionStorage)** — one factory-made store, reset on full reload after 1h. Not a new Convex table.
2. **Basket UX: Sidebar drawer (Sheet)** triggered from "Add to Extraction" buttons anywhere, + a full-page review step at `/extraction/new`. Not a floating cart, not a multi-step dialog.
3. **Entry points: One `<AddToExtractionButton papers source>` component** dropped into the existing command centers (`library-command-center.tsx`, search command footer, collection detail). No new toolbars.
4. **Zotero → OpenAlex resolution:** New `api.openalex.resolveByDoi` action called lazily **inside the "Zotero" tab of the picker** as items are checked, with visible "resolving…" state + "no OpenAlex match" rejection. Items without DOI are gated.
5. **Per-tier limit: Static `EXTRACTION_LIMITS_BY_TIER` record** in `convex/lib/queryBounds.ts` (shape ready, same value for all tiers this milestone). Enforced at mutation time via a new `getExtractionLimitForUser` helper.
6. **TierSelector wiring: 3 lines** — add `tier` arg to `createExtractionJob`, persist on the job row, pass into `createCascadeTiers(tier)` which slices the existing array.

Everything else in this document flows from those choices.

---

## 1. System Overview — What Already Exists vs What We're Adding

```
┌───────────────────────────────────────────────────────────────────────┐
│                         UI SURFACES (Next.js App Router)              │
│ ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌────────┐ │
│ │ /library │  │ /results │  │ /bookmarks│  │ /extraction│  │/coll..*│ │
│ │ EXISTING │  │ EXISTING │  │ EXISTING  │  │  EXISTING  │  │   ?    │ │
│ └────┬─────┘  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └────┬───┘ │
│      │             │              │              │              │     │
│      ▼             ▼              ▼              ▼              ▼     │
│ ╔═══════════════════════════════════════════════════════════════════╗ │
│ ║              <AddToExtractionButton papers source> NEW            ║ │
│ ╚═══════════════════════════════════════════════════════════════════╝ │
│                                  │                                    │
│                                  ▼                                    │
│ ╔═══════════════════════════════════════════════════════════════════╗ │
│ ║              useExtractionBasketStore (Zustand) NEW               ║ │
│ ║    sessionStorage, dedup-by-openalexId, 1000 hard cap             ║ │
│ ╚═══════════════════════════════════════════════════════════════════╝ │
│                                  │                                    │
│                                  ▼                                    │
│ ╔═══════════════════════════════════════════════════════════════════╗ │
│ ║        ExtractionBasketDrawer (Sheet) NEW — right-side slide-in   ║ │
│ ║        shows count, per-source breakdown, "Review & start" CTA    ║ │
│ ╚═══════════════════════════════════════════════════════════════════╝ │
│                                  │                                    │
│                                  ▼                                    │
│ ╔═══════════════════════════════════════════════════════════════════╗ │
│ ║  /extraction/new (NEW PAGE) — picker tabs + review + dialog       ║ │
│ ║  ┌──────┬──────┬────────┬─────────┬────────┐                      ║ │
│ ║  │ Libr │ Coll │ Search │ Manual  │ Zotero │  ← SelectorTabs      ║ │
│ ║  └──────┴──────┴────────┴─────────┴────────┘                      ║ │
│ ║  [basket review]  →  <ExtractionDialog papers={basket}> EXISTING  ║ │
│ ╚═══════════════════════════════════════════════════════════════════╝ │
│                                  │                                    │
│                                  ▼ (unchanged)                        │
├───────────────────────────────────────────────────────────────────────┤
│                      BACKEND (Convex)                                 │
│ ┌─────────────────────────┐  ┌──────────────────────────────────────┐ │
│ │ api.extraction.mutations│  │ convex/zotero/* EXISTING (orphaned) │ │
│ │  .createExtractionJob   │  │  actions.ts: startOAuth, fetchItems │ │
│ │   MODIFIED (+tier arg,  │  │  http.ts /api/zotero/callback       │ │
│ │    +limit lookup)       │  │  crons.ts cleanupExpiredOAuthTokens │ │
│ └───────┬─────────────────┘  └─────────┬────────────────────────────┘ │
│         │                              │                              │
│         ▼                              ▼                              │
│ ┌─────────────────────────┐  ┌──────────────────────────────────────┐ │
│ │ extractionJobs (+ tier) │  │ api.openalex.resolveByDoi NEW ACTION │ │
│ │ extractionPapers        │  │  (wraps live OpenAlex /works/doi...)│ │
│ │ extractionQuestions     │  └──────────────────────────────────────┘ │
│ │ extractionResults       │                                          │
│ │ (all EXISTING v6.0)     │                                          │
│ └───────┬─────────────────┘                                          │
│         ▼                                                             │
│ ┌─────────────────────────────────────────────────────────────────┐  │
│ │ workflow.ts → workpoolActions.ts → extract.ts EXISTING          │  │
│ │ createCascadeTiers(tier) MODIFIED to slice based on requested   │  │
│ └─────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

**Legend:** `EXISTING` = untouched. `MODIFIED` = small diff. `NEW` = fresh code.
`?` after collection detail page = we don't yet have a `/collections/[id]` route; see §3.

---

## 2. Decision 1 — Selection Basket Storage

**Recommended: Ephemeral Zustand store, sessionStorage-backed, 1h soft expiry.**

### Evaluation matrix

| Option | Survives reload? | DB cost | URL-shareable? | Implementation cost | Fits `createSidebarStore` pattern? |
|--------|------------------|---------|----------------|---------------------|-----------------------------------|
| **Ephemeral Zustand (in-memory only)** | No | 0 | No | Trivial | Yes |
| **Zustand + sessionStorage** (recommended) | Tab refresh: yes. New tab: no. | 0 | No | Trivial | Yes |
| Zustand + localStorage | Yes (forever) | 0 | No | Trivial | Yes |
| `extractionSelections` Convex table | Yes (cross-device) | N writes per toggle → OCC hot path, index + cascade on user delete | No | Medium (+schema + 2 mutations + cascade delete + Phase 94 crash audit) | No, breaks the purely-client pattern |
| URL state (nuqs) | Yes (bookmarkable) | 0 | Yes, ~100 papers | Trivial UI, fails at scale (1000 cap) | No |

### Why sessionStorage wins for v7.0

1. **Selection is short-lived workflow state, not user data.** A user assembles a basket over 5–30 minutes while browsing library/search/Zotero. Nobody comes back next week asking "where's my half-built basket?" — they come back to the job itself. This is a **workflow concern**, not a **persistence concern**.
2. **Zero schema churn.** The current v6.0 schema has 4 extraction tables + cascade delete logic already wired. Adding a 5th table means another entry in the cascade, another test fixture file, another rate-limit check, and another row in `cleanupDeletedUsers`. We avoid all of that.
3. **URL state fails at scale.** The spec says 1000-paper hard limit. A single OpenAlex ID is ~28 chars (`https://openalex.org/Wxxxxxxxxxx`). With commas and JSON-encoding, 1000 IDs is ≥30 KB — far beyond any reasonable URL budget (browsers cap near 2–8 KB).
4. **It matches the existing pattern.** `lib/store.ts` already has `useTransientScreeningStore`, `useSearchHistoryStore`, `useUIStore`, plus the `createSidebarStore('openalex-library-sidebar')` factory — **all Zustand + localStorage/sessionStorage**. Adding one more is zero-friction.
5. **sessionStorage, not localStorage, for safety.** localStorage keeps the basket across days. If a user returns tomorrow with a half-full basket they forgot about and accidentally hits Start, they'll burn credits. sessionStorage ties lifetime to the tab, which matches user mental model ("I'm in a session; when I close the tab, my work-in-progress is gone").

### Store shape

```typescript
// lib/store/extraction-basket-store.ts (NEW FILE)
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type BasketSource = 'library' | 'collection' | 'search' | 'manual' | 'zotero';

export interface BasketPaper {
  openalexId: string;
  title: string;
  doi?: string;
  source: BasketSource;      // provenance badge in the drawer
  addedAt: number;            // for "most recent first" sort
  sourceMetadata?: {          // optional breadcrumb, e.g. "From collection: Cancer RCTs"
    collectionId?: string;
    collectionName?: string;
    searchId?: string;
    zoteroKey?: string;
  };
}

interface ExtractionBasketState {
  papers: Record<string, BasketPaper>; // key = openalexId for O(1) dedup
  _hasHydrated: boolean;
  addPapers: (papers: BasketPaper[]) => { added: number; skipped: number; rejectedForLimit: number };
  removePaper: (openalexId: string) => void;
  clear: () => void;
  getCount: () => number;
  getPapersArray: () => BasketPaper[];
  setHasHydrated: (state: boolean) => void;
}

export const useExtractionBasketStore = create<ExtractionBasketState>()(
  persist(
    (set, get) => ({
      papers: {},
      _hasHydrated: false,
      addPapers: (newPapers) => {
        const current = get().papers;
        const limit = MAX_EXTRACTION_PAPERS_PER_JOB; // imported from convex/lib/queryBounds
        let added = 0, skipped = 0, rejectedForLimit = 0;
        const next = { ...current };
        for (const p of newPapers) {
          if (Object.keys(next).length >= limit) { rejectedForLimit++; continue; }
          if (next[p.openalexId]) { skipped++; continue; }
          next[p.openalexId] = p;
          added++;
        }
        set({ papers: next });
        return { added, skipped, rejectedForLimit };
      },
      removePaper: (id) =>
        set((s) => {
          const { [id]: _removed, ...rest } = s.papers;
          return { papers: rest };
        }),
      clear: () => set({ papers: {} }),
      getCount: () => Object.keys(get().papers).length,
      getPapersArray: () =>
        Object.values(get().papers).sort((a, b) => b.addedAt - a.addedAt),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'openalex-extraction-basket',
      version: 1,
      storage: createJSONStorage(() => sessionStorage), // CRITICAL: sessionStorage, not localStorage
      partialize: (s) => ({ papers: s.papers }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);
```

**Note the `_hasHydrated` flag** — matches the pattern from `createSidebarStore` to avoid SSR/client mismatch flashes. The drawer and the "X/1000" counter must guard on `_hasHydrated` before rendering counts.

**Note the limit enforcement lives inside `addPapers`** — the same cap is enforced server-side at mutation time as defence in depth, but catching it client-side means we can show a friendly toast ("Basket is full — 87 papers skipped") instead of a server error mid-submit.

---

## 3. Decision 2 — Basket UX Integration Point

**Recommended: Right-side Sheet drawer (basket peek) + dedicated `/extraction/new` page (review & launch).**

### Evaluation

| Approach | Discoverability | Mental model fit | Works for 5 sources? | Existing patterns reusable? | Friction |
|----------|-----------------|------------------|----------------------|------------------------------|----------|
| Floating cart overlay (bottom-right) | High | "Shopping cart" — OK metaphor | Yes | None — new floating pattern | Obscures content, mobile hostile |
| Dedicated `/extraction/new` with source tabs | Medium | "Wizard" | Yes | Matches `/library`, `/results`, `/extraction` pattern | Forces full navigation for every pick |
| Inline multi-step in ExtractionDialog | Low | Dialog explosion | No — too cramped for library browse + Zotero pagination | Breaks the existing dialog contract | Terrible for 1000-paper assembly |
| **Sheet drawer + dedicated page** (recommended) | High | Cart-with-review — familiar | Yes | shadcn Sheet + existing page layout | None |

### Why drawer + page together

- **Drawer (shadcn `Sheet`) = "peek your basket":** accessible from anywhere. Shows count, groups by source with collapsible sections, lets you remove items, and has a single CTA: "Review & Start Extraction" → navigates to `/extraction/new`. This is the *browsing* mode — you're in `/library` mid-workflow and just want to confirm what's in the basket.
- **`/extraction/new` = "assemble & launch":** the selector tabs live here. When the user decides "OK, I want to add stuff from many sources," they navigate here. This page has the full tab set (Library / Collections / Search / Manual / Zotero) and ends with the existing `ExtractionDialog` which already expects `papers` as a prop.

### Discovery trigger

The sidebar's existing "Extraction" nav item (already in `components/app-sidebar.tsx`, matches `/extraction` → `/extraction/[jobId]`) gets a **count badge** when the basket is non-empty. That badge + the button on each page's command center is how users find the drawer.

```tsx
// components/extraction/extraction-basket-drawer.tsx (NEW)
'use client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useExtractionBasketStore } from '@/lib/store/extraction-basket-store';
import { useRouter } from 'next/navigation';

export function ExtractionBasketDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const papers = useExtractionBasketStore((s) => s.getPapersArray());
  const count = useExtractionBasketStore((s) => s.getCount());
  const hydrated = useExtractionBasketStore((s) => s._hasHydrated);
  const router = useRouter();
  if (!hydrated) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Extraction basket ({count} / {MAX_EXTRACTION_PAPERS_PER_JOB})</SheetTitle>
        </SheetHeader>
        {/* Grouped by source, each collapsible, each item removable */}
        <div className="flex-1 overflow-y-auto">{/* ...groups... */}</div>
        <div className="border-t pt-4">
          <Button className="w-full" disabled={count === 0} onClick={() => { onOpenChange(false); router.push('/extraction/new'); }}>
            Review & start extraction
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

### Collection detail page: does it exist?

**No** — confirmed by inspection: `app/library` has only `page.tsx`, and `.planning/PROJECT.md` says "flat collections sufficient for now" in Out of Scope with no detail route shipped. Collections are surfaced via:
- The collection filter dropdown in `library-filter-sidebar.tsx`
- The `CollectionManager` and `CollectionPicker` modals in `components/library/`
- A `col` URL param on `/library` (`app/library/page.tsx` → `/library?col=<id>`)

**Decision:** we do **not** build a `/collections/[id]` detail route in this milestone. Instead:
- The "Collections" tab inside `/extraction/new` loads `api.library.collections.getCollectionsWithCounts`, shows a list, and when one is selected, lets the user "Add all N papers to basket" with a single button (plus per-paper cherry-pick via a data-table view).
- On `/library` when a collection filter is active (`col=<id>`), the existing command center shows an "Extract N papers in this collection" button that immediately adds every item matching the filter to the basket and opens the drawer. This is the 80% case.

If we ship a full `/collections/[id]` route later, it plugs into the same `<AddToExtractionButton>` trivially.

---

## 4. Decision 3 — Entry Point Integration (Shared Component)

**Recommended:** a single `AddToExtractionButton` component with three behaviours triggered by context, plus a shared `useAddToBasket` hook for custom command centers that want their own button chrome.

### The component

```tsx
// components/extraction/add-to-extraction-button.tsx (NEW)
'use client';
import { Button } from '@/components/ui/button';
import { FlaskConical } from 'lucide-react';
import { showStyledToast } from '@/components/ui/sonner';
import { useExtractionBasketStore, type BasketPaper, type BasketSource } from '@/lib/store/extraction-basket-store';
import { useUIStore } from '@/lib/store'; // existing — we add an openBasketDrawer bool

interface AddToExtractionButtonProps {
  papers: Omit<BasketPaper, 'addedAt' | 'source' | 'sourceMetadata'>[];
  source: BasketSource;
  sourceMetadata?: BasketPaper['sourceMetadata'];
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'sm' | 'default';
  label?: string;       // default: "Extract (N)"
  openDrawerOnAdd?: boolean; // default: true
}

export function AddToExtractionButton(props: AddToExtractionButtonProps) {
  const addPapers = useExtractionBasketStore((s) => s.addPapers);
  const openDrawer = useUIStore((s) => s.setBasketDrawerOpen); // NEW action on useUIStore
  return (
    <Button
      size={props.size ?? 'sm'}
      variant={props.variant ?? 'default'}
      disabled={props.papers.length === 0}
      onClick={() => {
        const now = Date.now();
        const mapped = props.papers.map((p) => ({
          ...p,
          source: props.source,
          sourceMetadata: props.sourceMetadata,
          addedAt: now,
        }));
        const { added, skipped, rejectedForLimit } = addPapers(mapped);
        if (rejectedForLimit > 0) {
          showStyledToast('warning', `Basket full — ${rejectedForLimit} paper(s) couldn't be added (1000 limit)`);
        } else if (skipped > 0) {
          showStyledToast('info', `Added ${added}, skipped ${skipped} already in basket`);
        } else {
          showStyledToast('success', `Added ${added} paper(s) to extraction basket`);
        }
        if (props.openDrawerOnAdd !== false) openDrawer(true);
      }}
    >
      <FlaskConical className="h-4 w-4 mr-2" />
      {props.label ?? `Extract (${props.papers.length})`}
    </Button>
  );
}
```

### Where it mounts (concrete sites)

| Site | File (existing) | How it hooks in |
|------|-----------------|-----------------|
| **Library** bulk action | `components/library/library-command-center.tsx` | Add button next to the existing download/delete bulk actions; `papers` = paginated visible items OR filtered-all via the existing non-paginated export query |
| **Search results** bulk action | `components/search-command-center/search-command-footer.tsx` | New button alongside existing screening launch; `papers` = `PaperResult[]` from results context, mapped to `{openalexId, title, doi}` |
| **Bookmarks** bulk action | `components/bookmarks-command-center/` | Same shape as library |
| **Collection flow** | `components/library/library-command-center.tsx` — conditional on `col` param | When a collection filter is active, the bulk button's label becomes "Extract collection (N)" and papers = all in that collection (not just the current page) |
| **Global sidebar** | `components/app-sidebar.tsx` | The "Extraction" nav item gets a count badge driven by `useExtractionBasketStore((s) => s.getCount())`, clicking it with a non-empty basket opens the drawer first |

### Why a hook as well

The search command footer (362 LOC) and library command center (153 LOC) have opinionated layouts. Not every caller wants our button styling; some want to drive the add action from a checkbox-driven multi-select table and show their own "N selected" chrome. The hook exposes just `addPapers` + a `openDrawer` helper:

```typescript
// lib/hooks/use-add-to-basket.ts (NEW)
export function useAddToBasket(source: BasketSource) {
  const addPapers = useExtractionBasketStore((s) => s.addPapers);
  const openDrawer = useUIStore((s) => s.setBasketDrawerOpen);
  return {
    add: (papers: Omit<BasketPaper, 'addedAt' | 'source'>[]) => {
      const now = Date.now();
      const result = addPapers(papers.map((p) => ({ ...p, source, addedAt: now })));
      openDrawer(true);
      return result;
    },
  };
}
```

### DRY principle

The payload shape is centralised in `BasketPaper`. Any site that converts from its local row type (PaperResult, LibraryItem, ZoteroItem resolved to OpenAlex) does it once at the call site. The dedup happens in `addPapers` regardless of source.

---

## 5. Decision 4 — Data Flow: Basket → Dialog → Workflow

### The normalization problem

The basket holds heterogeneous inputs that must all collapse to `Array<{openalexId, title, doi?}>` before `createExtractionJob` sees them:

| Source | Has `openalexId`? | Has `title`? | Has `doi`? | Shape transform |
|--------|-------------------|---------------|-------------|-----------------|
| `libraryItems` | Yes, direct | Yes | Yes | Trivial `.map()` |
| `results/[searchId]` (OpenAlex search) | Yes | Yes | Yes | Trivial `.map()` — PaperResult already has `id: openalexId` |
| Bookmarks | Yes, stored as libraryItems | Yes | Yes | Same as library |
| Manual IDs | Yes if user pasted `W123...` or `https://openalex.org/W123...` | No (need to fetch) | No | **Needs OpenAlex lookup** to get `title`, `doi` before adding to basket |
| Zotero items | **No** | Yes | Sometimes | **Needs DOI → OpenAlex resolution**, rejected if no DOI |

### The flow (end-to-end)

```
USER ACTION                        FRONTEND                            BACKEND
───────────                        ────────                            ───────
Library: "Extract (23)"      →  AddToExtractionButton              
                                 → addPapers (direct, no fetch)     
                                 → drawer opens                      

Manual: paste "W1234"        →  SelectorTabs.manual                 
                                 → api.openalex.resolveManual       →  resolveManual(ids[]) NEW ACTION
                                   (returns validated {openalexId,      fetches OpenAlex /works/W*
                                    title, doi} or error)              returns trimmed metadata
                                 → addPapers                         

Zotero: toggle item          →  SelectorTabs.zotero                 
(has DOI)                        → api.openalex.resolveByDoi        →  resolveByDoi({doi}) NEW ACTION
                                   (returns {openalexId, title}+doi)    fetches OpenAlex /works/doi:...
                                                                        returns trimmed metadata
                                 → addPapers (with source='zotero')  

Zotero: toggle item          →  DISABLED in UI, tooltip             (no call)
(no DOI)                         "Needs DOI to extract"              

"Review & start"             →  /extraction/new                     
                                 → Reads basket                      
                                 → <ExtractionDialog papers={basket}>
                                 → user fills questions + tier      
                                 → createJob({papers, questions,    →  createExtractionJob
                                    tier})                               - auth
                                                                         - count check (<=limit lookup)
                                                                         - active-job guard
                                                                         - tier persisted on job row
                                                                         - workflow.start(...)
                                                                         - returns {jobId}
                                 → basket.clear()                   
                                 → router.push(/extraction/[jobId]) 
                                                                     →  extraction workflow runs
                                                                        createCascadeTiers(tier)
                                                                        slices tiers per request
```

### Manual ID + Zotero resolution concretely

**New Convex action** at `convex/openalex/actions.ts` (the folder doesn't exist yet; create it):

```typescript
// convex/openalex/actions.ts NEW
"use node";
import { action } from "../_generated/server";
import { v } from "convex/values";
import { createError } from "../lib/errors";

const OPENALEX_API_BASE = "https://api.openalex.org";

export const resolveByDoi = action({
  args: { doi: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      openalexId: v.string(),  // "https://openalex.org/W..."
      title: v.string(),
      doi: v.string(),
    }),
  ),
  handler: async (_ctx, { doi }) => {
    const email = process.env.OPENALEX_CONTACT_EMAIL ?? "openscholar@sickrin.com";
    // Clean the DOI: strip http(s)://doi.org/ prefix if present
    const cleanDoi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    const url = `${OPENALEX_API_BASE}/works/https://doi.org/${cleanDoi}?mailto=${email}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (resp.status === 404) return null;
    if (!resp.ok) throw createError("OPENALEX_LOOKUP_FAILED", `OpenAlex ${resp.status}`);
    const work = await resp.json();
    if (!work?.id || !work?.title) return null;
    return { openalexId: work.id, title: work.title, doi: cleanDoi };
  },
});

export const resolveManualIds = action({
  args: { ids: v.array(v.string()) },
  returns: v.array(
    v.object({
      input: v.string(),
      resolved: v.union(
        v.null(),
        v.object({ openalexId: v.string(), title: v.string(), doi: v.optional(v.string()) }),
      ),
    }),
  ),
  handler: async (_ctx, { ids }) => {
    // Same email + fetch pattern, but accepts W-prefixed IDs
    // Returns per-input success/fail so the UI can show "3 resolved, 1 not found"
    // Budget: max 50 IDs per call, enforce at the UI boundary for snappy feedback
    // ...
  },
});
```

**Note on reusing existing OpenAlex code:** the parse waterfall in `convex/extraction/parse.ts` already builds OpenAlex URLs with the exact same email/DOI pattern (see `fetchOpenAlexMetadata`, line 91). The new actions borrow that pattern but can't directly import it (`parse.ts` is imported by the `"use node"` workpool action and mixes concerns — leaving it untouched is the DRY-respecting move). Extract a shared `lib/openalex-fetch.ts` if more callers appear.

**Rate-limit note:** OpenAlex free tier has no hard per-second cap with mailto header, but we should still be polite. The Zotero tab resolves items lazily (only when the user checks a box), not all at once on tab open. A user ticking 50 Zotero items triggers 50 sequential `resolveByDoi` calls — acceptable UX if each shows a spinner until the basket row confirms.

### The ExtractionDialog contract changes

Currently `ExtractionDialog` has `papers?: Array<{openalexId, title, doi?}>` as an *optional* prop — which was the v6.0 design flaw that made the dialog unreachable. In v7.0:

- The dialog keeps its signature (no breaking change for the callsite in `extraction-list-client.tsx`).
- `/extraction/new` passes `papers={basketArray}` from the basket hydration.
- After successful submission, the dialog's `handleSubmit` calls `useExtractionBasketStore.getState().clear()` and navigates to `/extraction/[jobId]`. Add `tier: ModelTier` to the `createJob({papers, questions})` call — this is the 3-line TierSelector wiring (§9).

---

## 6. Decision 5 — Zotero Resurrection Path

### Inventory of existing code (orphaned, not dead)

| File | LOC | Purpose | Status |
|------|-----|---------|--------|
| `convex/zotero/actions.ts` | 1124 | OAuth 1.0a flow, fetch collections/groups/items, pagination, deletion filters | **Intact, not imported** |
| `convex/zotero/queries.ts` | 66 | `getConnectionStatus` (public), `getZoteroUserIdInternal` | **Intact, not imported** |
| `convex/zotero/mutations.ts` | 181 | `storeRequestToken`, `saveConnection`, `deleteConnection`, `getRequestToken` | **Intact, not imported** |
| `convex/zotero/internal.ts` | ? | `getConnection` (internal query) | **Intact** |
| `convex/http.ts` `/api/zotero/callback` | (in http.ts) | OAuth callback handler | **Live — routed but dangling** |
| `convex/crons.ts` `cleanupExpiredOAuthTokens` | ? | Hourly cleanup of expired request tokens | **Live — running hourly** |
| Schema `zoteroConnections`, `zoteroOAuthTokens` | (in schema.ts) | Persistence | **Live** |

**Everything is intact.** The previous scorched-earth teardown in v6.0 removed UI consumers but deliberately kept the backend (per PROJECT.md: "Hourly cron cleanup of expired Zotero OAuth tokens — v2.4" and schema still includes both tables). The callback route still runs — if somehow a stale OAuth token was in flight, it would land and do nothing visible.

### Env vars to verify (and add to cron validation)

- `ZOTERO_CLIENT_KEY` — required (used by `startOAuth`, `completeOAuth`)
- `ZOTERO_CLIENT_SECRET` — required
- `ENCRYPTION_KEY` — already required for other things, reused to encrypt the Zotero API key (see `resolveZoteroApiKey` at line 35 of `actions.ts`)
- `OPENALEX_CONTACT_EMAIL` — already required, reused for the new `resolveByDoi` action

The existing 24h env validation cron (PROJECT.md: "Cron-based env var validation") should be extended to check the two Zotero vars if not already. **Verify in Phase 01:** read `convex/lib/envValidation.ts` and add `ZOTERO_CLIENT_KEY`/`ZOTERO_CLIENT_SECRET` to the checked list. If they're already checked, no-op.

### UI surfaces to build

**Two surfaces, built in this order:**

1. **Settings → Integrations card** (`app/settings/page.tsx`, new tab `integrations/` or inline section). This is where connecting/disconnecting lives.
   - Shows `api.zotero.queries.getConnectionStatus` result: either "Not connected" with a "Connect Zotero" button that calls `api.zotero.actions.startOAuth({callbackUrl: <absolute URL>})` and `window.location` redirects to the returned `authorizeUrl`, or "Connected as @username (connected Jan 3)" with a "Disconnect" button calling `deleteConnection` mutation.
   - The callback at `/api/zotero/callback` (already wired in `http.ts`) redirects to the frontend with `?zotero_connected=true` or `?zotero_error=...` query params. The settings page or a global query-param listener reads those, toasts, and clears the param with `router.replace`.
2. **Zotero tab in the extraction selector** at `/extraction/new`:
   - If `getConnectionStatus.connected === false`: show a friendly empty state with "Connect Zotero in Settings" linking to `/settings/integrations`.
   - If connected: render a two-pane UI. Left pane: collection tree from `api.zotero.actions.fetchCollections`. Right pane: items from `api.zotero.actions.fetchItems({collectionKey, start, limit})` with the **existing 50-per-page pagination** the action already supports (see lines 758–930 of `actions.ts`, `nextCursor` + `hasMore`).

### Pagination strategy for Zotero items

**Recommendation: on-demand via `useAction` + local state, NOT `usePaginatedQuery`.** Reason: `fetchItems` is an action (it calls Zotero's HTTP API), not a Convex query. Convex's `usePaginatedQuery` is for paginated queries over the database, not actions.

The UI pattern:
```typescript
// components/extraction/zotero-source-tab.tsx (NEW)
const fetchItems = useAction(api.zotero.actions.fetchItems);
const [items, setItems] = useState<ZoteroItem[]>([]);
const [cursor, setCursor] = useState(0);
const [hasMore, setHasMore] = useState(true);
const [loading, setLoading] = useState(false);

async function loadMore() {
  if (loading || !hasMore) return;
  setLoading(true);
  try {
    const result = await fetchItems({ collectionKey, start: cursor, limit: 50 });
    setItems((prev) => [...prev, ...result.items]);
    setCursor(result.nextCursor ?? cursor + result.items.length);
    setHasMore(result.hasMore);
  } finally { setLoading(false); }
}
```

Initial load on mount + "Load more" button or intersection observer for infinite scroll. Given a 10k+ Zotero library, we **do not pre-fetch all**. We load the first 50 + let the user scroll; if they use search, we add a search filter by delegating to Zotero API's `q` query param (requires adding the arg to `fetchItems`, small diff).

**Checkbox UX:** when the user checks a Zotero item with a DOI, call `api.openalex.resolveByDoi` immediately; show inline spinner on that row, then if resolved, call `addPapers` on the basket store with `source: 'zotero'`, `sourceMetadata: {zoteroKey: item.key}`. If no match, show a red "no OpenAlex record" inline state and don't add. Items with no DOI are rendered with their checkbox disabled + tooltip "Needs DOI".

---

## 7. Decision 6 — Per-Tier Limit Lookup

**Recommended: Static config in `convex/lib/queryBounds.ts` keyed by plan tier, with a helper that resolves the user's plan.**

### The shape

```typescript
// convex/lib/queryBounds.ts — MODIFIED
// EXISTING:
// export const MAX_EXTRACTION_PAPERS_PER_JOB = 200;

// REPLACE WITH:
import type { SubscriptionPlan } from "../../lib/billing/entitlements";

/**
 * Per-job extraction paper cap, keyed by plan tier.
 * v7.0: identical value across tiers (1000). Shape ready for per-tier enforcement later.
 * When per-tier divergence is needed, just edit this map — call sites don't change.
 */
export const EXTRACTION_LIMITS_BY_TIER: Record<SubscriptionPlan, number> = {
  free: 1_000,
  go: 1_000,
  pro: 1_000,
  enterprise: 1_000,
};

/** Backward-compat export used by anything that doesn't care about plan tier.
 *  Resolves to the maximum value across all tiers — safe upper bound for array allocation. */
export const MAX_EXTRACTION_PAPERS_PER_JOB = Math.max(
  ...Object.values(EXTRACTION_LIMITS_BY_TIER),
);
```

### The resolver

```typescript
// convex/lib/extractionLimit.ts (NEW)
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { EXTRACTION_LIMITS_BY_TIER } from "./queryBounds";
import { resolveEffectivePlan } from "../../lib/billing/entitlements";
import type { Id } from "../_generated/dataModel";

export async function getExtractionLimitForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  const plan = resolveEffectivePlan(subscription); // "free" | "go" | "pro" | "enterprise"
  return EXTRACTION_LIMITS_BY_TIER[plan];
}
```

`resolveEffectivePlan` already exists at `lib/billing/entitlements.ts:44` — it reads subscription status and returns "free" for non-entitled users. **Reuse, don't reinvent.**

### Where it's called

**Authoritative enforcement: at mutation time in `createExtractionJob`.**

```typescript
// convex/extraction/mutations.ts MODIFIED
// Replace the constant check with:
const limit = await getExtractionLimitForUser(ctx, user._id);
if (args.papers.length > limit) {
  throw createError(
    "VALIDATION_ERROR",
    `Maximum ${limit} papers per job for your plan`,
  );
}
```

**Advisory enforcement in queries (for the UI counter):**

```typescript
// convex/extraction/queries.ts NEW QUERY
export const getExtractionLimit = query({
  args: {},
  returns: v.object({ limit: v.number(), plan: v.string() }),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    const plan = resolveEffectivePlan(subscription);
    return { limit: EXTRACTION_LIMITS_BY_TIER[plan], plan };
  },
});
```

The basket drawer and the "X / N" counter in the dialog read this reactively via `useProtectedQuery`. The client-side limit check in `useExtractionBasketStore.addPapers` uses `MAX_EXTRACTION_PAPERS_PER_JOB` as a fail-safe constant (because the store can't depend on Convex reactively), but the *displayed* number and the *server-enforced* check both go through the query. If a pro user is downgraded mid-session, the next `createExtractionJob` call will reject with their new lower limit — defence in depth.

### Why not a module-level constant function?

Because the reactivity argument: the counter must update if a user's plan changes during the session (they upgraded, now they can extract more). A plain constant is stale; a reactive query stays fresh.

### Why not `ctx.auth.getUserIdentity()` inside the constant?

Because `queryBounds.ts` should not import `requireAuth` or similar — it's used in contexts that don't always have ctx (notably cancel.test.ts, schema tests). Keep data + logic separated: `queryBounds.ts` has static data, `extractionLimit.ts` has the resolver.

---

## 8. Decision 7 — Build Order (Topological Dependency Chain)

### Dependency graph

```
                ┌────────────────────────────────────┐
                │  Phase 0: Pre-flight                │
                │  - Bump queryBounds to tiered shape │
                │  - Extend env validation (Zotero)   │
                │  - Verify convex/zotero/** compiles │
                └─────────────────┬───────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
  ┌─────────────┐         ┌─────────────┐          ┌──────────────┐
  │ Phase 1:    │         │ Phase 2:    │          │ Phase 3:     │
  │ Basket core │         │ Backend     │          │ Workbench    │
  │             │         │ wiring      │          │ primitives   │
  │ - store     │         │ - tier arg  │          │ - data-table │
  │ - types     │         │ - limit     │          │   shared     │
  │ - drawer    │         │ - resolver  │          │   primitive  │
  │             │         │ - new       │          │ - filter     │
  │             │         │   actions   │          │   toolbar    │
  │             │         │   (openalex │          │   primitive  │
  │             │         │   resolve)  │          │              │
  └──────┬──────┘         └──────┬──────┘          └──────┬───────┘
         │                       │                        │
         │    ┌──────────────────┘                        │
         │    │                                           │
         ▼    ▼                                           ▼
  ┌────────────────────────┐                  ┌─────────────────────┐
  │ Phase 4: Entry points   │                  │ Phase 5: Workbench  │
  │ - AddToExtractionButton │                  │ views               │
  │ - useAddToBasket hook   │                  │ - Table view        │
  │ - Mount: library        │                  │ - Card view         │
  │ - Mount: search         │                  │ - Split view        │
  │ - Mount: bookmarks      │                  │ - Highlight view    │
  │ - Badge on sidebar nav  │                  │ - View switcher     │
  └───────────┬────────────┘                  └──────────┬──────────┘
              │                                          │
              ▼                                          │
  ┌────────────────────────┐                             │
  │ Phase 6: Selector tabs  │                             │
  │ & /extraction/new page  │                             │
  │ - LibraryTab            │                             │
  │ - CollectionsTab        │                             │
  │ - SearchTab             │                             │
  │ - ManualTab             │                             │
  │ - (Zotero: phase 7)     │                             │
  └───────────┬────────────┘                             │
              │                                          │
              ▼                                          │
  ┌────────────────────────┐                             │
  │ Phase 7: Zotero revival │                             │
  │ - Settings card         │                             │
  │ - ZoteroTab in selector │                             │
  │ - DOI-resolve UX        │                             │
  └───────────┬────────────┘                             │
              │                                          │
              ▼                                          │
  ┌────────────────────────┐                             │
  │ Phase 8: ExtractionDialog                            │
  │ integration                                          │
  │ - Wire tier arg                                      │
  │ - Live "X / limit"                                   │
  │ - Clear basket on submit                             │
  │ - Remove the orphan                                  │
  └────────────┬────────────┘                            │
               │                                         │
               └─────────────────┬───────────────────────┘
                                 ▼
                       ┌─────────────────────┐
                       │ Phase 9: Polish &   │
                       │ E2E tests           │
                       └─────────────────────┘
```

### Phase list in build order

| # | Phase | Depends on | Can run parallel with |
|---|-------|------------|----------------------|
| **0** | Pre-flight: bump limit shape, verify Zotero backend compiles, extend env validation | — | — |
| **1** | Basket core: Zustand store, types, `ExtractionBasketDrawer` | 0 | 2, 3 |
| **2** | Backend wiring: `tier` arg, `getExtractionLimitForUser`, `resolveByDoi`/`resolveManualIds` actions, `getExtractionLimit` query | 0 | 1, 3 |
| **3** | Workbench primitives: shared data-table component (TanStack Table), filter toolbar primitive, view-switcher primitive | 0 | 1, 2 |
| **4** | Entry points: `AddToExtractionButton`, `useAddToBasket`, mount at library/search/bookmarks command centers, sidebar nav badge | 1, 2 | 5 |
| **5** | Workbench views: Table/Card/Split/Highlighted views on `/extraction/[jobId]` using phase-3 primitives + existing v6.0 queries | 3 | 4, 6 |
| **6** | Selector page: `/extraction/new` with Library, Collections, Search, Manual tabs | 1, 2, 4 | 5 |
| **7** | Zotero revival: Settings card, ZoteroTab, DOI resolution UX | 2, 6 | — |
| **8** | ExtractionDialog integration: tier wiring, basket consumption, clear-on-submit, delete orphan mount in extraction-list-client.tsx | 1, 2, 6 | — |
| **9** | Polish: E2E tests, hydration guards, mobile responsive drawer, loading states, error toasts | all | — |

### Parallelization opportunities

- **Phase 1 (basket) + Phase 2 (backend) + Phase 3 (workbench primitives)** are fully independent — three engineers/agents can run in parallel after Phase 0.
- **Phase 4 (entry points) and Phase 5 (workbench views)** can overlap: views don't touch entry points.
- **Zotero (Phase 7)** is quarantined to one tab + one settings surface — it plugs into Phase 6 after Phase 6 ships the tab framework.

### Minimum dependency chain (critical path)

```
0 → 1 → 2 → 4 → 6 → 8 → 9
```

Workbench views (3 → 5) run on an independent track and join at Phase 9 for integration testing.

---

## 9. Decision 8 — TierSelector Wiring

**Current state:** `ExtractionDialog` holds local `tier` state from `TierSelector`, puts it in PostHog analytics, but **never sends it to the backend**. The backend's `createCascadeTiers()` ignores any request and always runs the full 3-tier waterfall (lite → flash → haiku).

### The smallest change

**Four edits, no schema migration, no new files.**

**Edit 1: Add `tier` to schema optional field**

```typescript
// convex/schema.ts — extractionJobs table, add to existing defineTable call
extractionJobs: defineTable({
  // ... existing fields ...
  tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate"))),
  // ...
})
```

Optional → zero migration. Existing rows have `tier: undefined`, treated as "auto".

**Edit 2: Add `tier` arg to `createExtractionJob`**

```typescript
// convex/extraction/mutations.ts — MODIFIED
export const createExtractionJob = mutation({
  args: {
    papers: v.array(extractionPaperInputValidator),
    questions: v.array(extractionQuestionValidator),
    tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate"))),
  },
  // ... same handler, persist tier on job row ...
  const jobId = await ctx.db.insert("extractionJobs", {
    // ... existing fields ...
    tier: args.tier ?? "auto",
    // ...
  });
});
```

**Edit 3: Read tier in the workpool action, pass to cascade**

```typescript
// convex/extraction/workpoolActions.ts (or wherever extractSingleAnswer is called) — MODIFIED
// Load tier from job row alongside paper data:
const job = await ctx.runQuery(internal.extraction.queries.getJobInternal, { jobId });
const requestedTier = job?.tier ?? "auto";

// Pass into extraction:
await extractSingleAnswer(bodyText, question, signal, traceId, jobId, paperId, requestedTier);
```

**Edit 4: `createCascadeTiers` filters based on request**

```typescript
// convex/extraction/extract.ts — MODIFIED
function createCascadeTiers(requestedTier: "auto" | "cheap" | "accurate" = "auto"): CascadeTier[] {
  const openrouter = createOpenRouter();
  const all: CascadeTier[] = [
    { name: "google/gemini-2.5-flash-lite", model: openrouter("google/gemini-2.5-flash-lite", { /* ... */ }) },
    { name: "google/gemini-3-flash-preview", model: openrouter("google/gemini-3-flash-preview", { /* ... */ }) },
    { name: "anthropic/claude-haiku-4.5", model: openrouter("anthropic/claude-haiku-4.5", { /* ... */ }) },
  ];
  switch (requestedTier) {
    case "cheap":   return [all[0]]; // only Flash Lite
    case "accurate": return [all[2]]; // only Haiku
    case "auto":
    default:        return all;       // full waterfall (current behavior)
  }
}
```

**Edit 5 (client): send the tier**

```tsx
// components/extraction/extraction-dialog.tsx — MODIFIED
// Change createJob call from:
//   await createJob({ papers, questions: keyedQuestions });
// to:
await createJob({ papers, questions: keyedQuestions, tier });
```

### Why this is safe

- Optional arg → no existing callers break.
- Optional schema field → no migration.
- Default fallback `"auto"` → preserves current behavior exactly.
- Single-tier modes still share the same critic/Levenshtein/insufficient-evidence guards at the bottom of `extractSingleAnswer` because those are *inside* the per-tier loop, not per-cascade.

### Cost impact to flag for the user

When `tier === "cheap"`, extraction is ~10x cheaper than `auto` worst-case but also ~5% less accurate (per v6.0 cascade eval). When `tier === "accurate"`, it's ~3x more expensive than `auto` median but more robust. This is a UX transparency concern — the tier card tooltips in `tier-selector.tsx` already exist (`tierAutoDesc`, `tierCheapDesc`, `tierAccurateDesc`), so it's a pure i18n copy refresh in Phase 8.

---

## 10. Explicit New/Modified/Existing File Inventory

### New files

| File | Purpose | Phase |
|------|---------|-------|
| `lib/store/extraction-basket-store.ts` | Zustand basket store | 1 |
| `lib/hooks/use-add-to-basket.ts` | Hook wrapper for basket add + drawer open | 1 |
| `components/extraction/extraction-basket-drawer.tsx` | Right-side Sheet, shows basket contents | 1 |
| `components/extraction/add-to-extraction-button.tsx` | Reusable CTA button | 4 |
| `components/extraction/selector/selector-tabs.tsx` | Tabs shell for `/extraction/new` | 6 |
| `components/extraction/selector/library-tab.tsx` | Library picker (uses existing queries) | 6 |
| `components/extraction/selector/collections-tab.tsx` | Collection picker | 6 |
| `components/extraction/selector/search-tab.tsx` | Search-results bridge | 6 |
| `components/extraction/selector/manual-tab.tsx` | Textarea + paste + resolve | 6 |
| `components/extraction/selector/zotero-tab.tsx` | Zotero collection tree + items table | 7 |
| `components/extraction/workbench/extraction-workbench.tsx` | Shell with view switcher | 5 |
| `components/extraction/workbench/views/table-view.tsx` | TanStack Table view | 5 |
| `components/extraction/workbench/views/card-view.tsx` | Rich card grid | 5 |
| `components/extraction/workbench/views/split-view.tsx` | Two-pane list + detail | 5 |
| `components/extraction/workbench/views/highlight-view.tsx` | Citation-highlighted text | 5 |
| `components/extraction/workbench/workbench-toolbar.tsx` | Filters, search, column picker | 5 |
| `components/settings/zotero-integration-card.tsx` | Settings connection card | 7 |
| `app/extraction/new/page.tsx` | Selector + review page | 6 |
| `convex/openalex/actions.ts` | `resolveByDoi`, `resolveManualIds` | 2 |
| `convex/lib/extractionLimit.ts` | `getExtractionLimitForUser` helper | 2 |

### Modified files

| File | Change | Phase |
|------|--------|-------|
| `convex/lib/queryBounds.ts` | `EXTRACTION_LIMITS_BY_TIER` record, derive `MAX_EXTRACTION_PAPERS_PER_JOB` from it, bump to 1000 | 0 |
| `convex/schema.ts` | Add optional `tier` field on `extractionJobs` | 2 |
| `convex/extraction/mutations.ts` | Accept `tier` arg, persist on row, use `getExtractionLimitForUser` instead of constant | 2 |
| `convex/extraction/queries.ts` | Add `getExtractionLimit` query; existing queries return `tier` when relevant | 2 |
| `convex/extraction/workpoolActions.ts` | Read job's `tier`, pass into `extractSingleAnswer` | 2 |
| `convex/extraction/extract.ts` | `createCascadeTiers(tier)` accepts & slices | 2 |
| `convex/lib/envValidation.ts` | Add `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` if not already checked | 0 |
| `components/extraction/extraction-dialog.tsx` | Send `tier` in mutation call, read `getExtractionLimit` for counter, call `basket.clear()` on submit | 8 |
| `components/library/library-command-center.tsx` | Mount `<AddToExtractionButton>` | 4 |
| `components/search-command-center/search-command-footer.tsx` | Mount `<AddToExtractionButton>` | 4 |
| `components/bookmarks-command-center/*` | Mount `<AddToExtractionButton>` | 4 |
| `components/app-sidebar.tsx` | Count badge on "Extraction" nav item | 4 |
| `app/extraction/extraction-list-client.tsx` | Remove orphan `<ExtractionDialog open={isCreate} />` — replace with link to `/extraction/new` | 8 |
| `lib/store.ts` | Add `basketDrawerOpen` + setter to `useUIStore` | 1 |
| `app/settings/page.tsx` (or sub-page) | Mount `<ZoteroIntegrationCard>` | 7 |

### Existing-untouched (explicit non-changes to prevent drift)

- **All `convex/zotero/**.ts` files** — intact, just consumed from new UI
- **`convex/extraction/workflow.ts`** — no changes; tier is read from row at processing time
- **`convex/http.ts` `/api/zotero/callback`** — already live
- **`convex/crons.ts` `cleanupExpiredOAuthTokens`** — already live
- **v6.0 `extractionJobs` / `extractionPapers` / `extractionResults` / `extractionQuestions` tables** — unchanged except the one optional `tier` field
- **`lib/billing/entitlements.ts`** — unchanged; we reuse `resolveEffectivePlan`
- **Existing `useProtectedQuery` / `usePaginatedQuery` wrappers** — unchanged; we consume them as-is
- **PaperCard, ResultsList, LibraryFilterSidebar** — unchanged; they render alongside the new button

---

## 11. Data Flow — Detailed Sequence Diagrams

### Flow A: Library → Basket → Job (happy path)

```
Browser                              Zustand Basket           Convex
───────                              ──────────────           ──────
User ticks 23 library items
  │
  ▼
<AddToExtractionButton papers=[23]>
  │
  ▼
addPapers([23])
  │                                  ─► dedup check (empty)
  │                                    limit check: 23 < 1000 ok
  │                                  ◄─ {added: 23, skipped: 0}
  ▼
openDrawer(true)
  │
  ▼
[Drawer shows: 23/1000, Library(23)]
  │
  ▼ (user clicks "Review & start")
router.push('/extraction/new')
  │
  ▼
[Review step shows all 23]
  │
  ▼ (user clicks "Continue" → opens ExtractionDialog with papers=basket)
<ExtractionDialog papers=[23]>
  │
  ▼ (user adds 2 questions, picks tier, clicks Submit)
createJob({papers: [23], questions: [2], tier: 'auto'})
                                    ─────────────────────────►  auth ✓
                                                                 count 23 ≤ limit 1000 ✓
                                                                 no active job ✓
                                                                 insert extractionJobs row (with tier)
                                                                 insert 23 extractionPapers
                                                                 insert 2 extractionQuestions
                                                                 workflow.start(...)
                                    ◄───────────────────────── {jobId}
  │
  ▼
basket.clear()
router.push(`/extraction/${jobId}`)
  │
  ▼
<ExtractionResultsClient jobId>
  │ (reactive subscription to job progress)
  │
  ▼
[Workbench shows live progress]
```

### Flow B: Zotero → Basket (with DOI resolution)

```
Browser                              Convex OpenAlex           Convex Zotero
───────                              ──────────────           ──────────────
User clicks "Zotero" tab
  │
  ▼ (first render)
fetchItems({start: 0, limit: 50})
                                                                  ─► OAuth token decrypt
                                                                     GET api.zotero.org/users/.../items/top
                                                                  ◄─ [50 items]
  │ ◄──────────────────────────────────────────────────────────── {items, nextCursor, hasMore}
  ▼
[Table with 50 rows, checkboxes]
  │
  ▼ (user checks item with DOI "10.1038/nature12345")
[spinner on row]
resolveByDoi({doi: '10.1038/nature12345'})
                                    ─► fetch api.openalex.org/works/https://doi.org/...
                                    ◄─ {id, title, doi}
  │ ◄──────────────────────────────── {openalexId, title, doi}
  ▼
addPapers([{openalexId, title, doi, source: 'zotero', sourceMetadata: {zoteroKey}}])
  │
  ▼
[Row checkmark confirmed, badge updates 1/1000]
  │
  ▼ (user checks item without DOI)
[Tooltip: "Needs DOI to extract", checkbox disabled]
  │
  ▼ (user clicks "Load more")
fetchItems({start: 50, limit: 50})
                                                                  ─► next page
                                                                  ◄─ [50 items]
  │ ◄──────────────────────────────────────────────────────────── 
  ▼
[Table now 100 rows]
```

### Flow C: Manual ID paste

```
Browser                              Convex
───────                              ──────
User pastes "W4001122334 W2001100200 https://openalex.org/W4099887766"
  │
  ▼ (parser extracts 3 IDs)
resolveManualIds({ids: ['W4001122334', 'W2001100200', 'W4099887766']})
                                    ─► Promise.all with 500ms-gap throttle
                                       each: fetch api.openalex.org/works/W...
                                    ◄─ [
                                         {input: 'W4001122334', resolved: {openalexId, title, doi}},
                                         {input: 'W2001100200', resolved: null},
                                         {input: 'W4099887766', resolved: {openalexId, title}}
                                       ]
  │ ◄────────────────────────────────
  ▼
[Toast: "2 resolved, 1 not found"]
addPapers([2 resolved])
  │
  ▼
[Drawer shows Manual(2)]
```

---

## 12. Integration Points — Exact Hookup Map

### External services

| Service | Integration | Notes |
|---------|-------------|-------|
| OpenAlex API | New actions `resolveByDoi`/`resolveManualIds` use `api.openalex.org/works/...` with `mailto=OPENALEX_CONTACT_EMAIL` (polite pool) | 10s timeout; 404 → null; polite pool avoids rate limits |
| Zotero API | Existing actions in `convex/zotero/actions.ts` (OAuth 1.0a, `api.zotero.org`) | Already hardened in v2.3/v2.4 — encrypted keys, audit logging, timeouts |
| Clerk | Existing auth boundary | Only reused via `requireAuth(ctx)` in new query/mutation, and `useProtectedQuery` in new UI |
| OpenRouter (LLM) | Unchanged — tier slicing happens at array level, not client level | No OpenRouter API changes |

### Internal boundaries

| Boundary | Communication | Pattern |
|----------|---------------|---------|
| Client basket ↔ Convex dialog | Props only | Basket is a local store; its papers array is passed as a prop to the existing dialog |
| `/extraction/new` ↔ basket | `useExtractionBasketStore` | One component reads via hook, calls `clear()` after successful submit |
| Library → basket | `<AddToExtractionButton>` | Direct hook call via `useAddToBasket` |
| Search → basket | `<AddToExtractionButton>` | Direct hook call |
| Zotero → basket | Two-step: `api.openalex.resolveByDoi` action → `addPapers` | Async resolution before basket add |
| Settings → Zotero | `useAction(startOAuth)` → `window.location` redirect → `/api/zotero/callback` → frontend redirect → `getConnectionStatus` reactive | Existing OAuth 1.0a flow |
| Sidebar nav → basket count | `useExtractionBasketStore((s) => s.getCount())` | Reactive selector |
| Dialog → backend | `useMutation(createExtractionJob)` with `tier` arg added | Minimal change |
| Workpool → tier lookup | `ctx.runQuery(getJobInternal).tier` | New internal read |

---

## 13. Anti-Patterns (Things NOT to Do This Milestone)

### Anti-Pattern 1: Persist the basket in Convex "because someone might ask"

**Don't.** YAGNI. If users complain, we add it as a Phase in v7.1 with a one-way migration: on first load after the upgrade, read `sessionStorage`, call a new `restoreBasketFromSession` mutation, delete the sessionStorage key. Postponing this has zero cost; premature addition adds a table, cascade delete, cron, tests, and a new failure mode.

### Anti-Pattern 2: Make the selection basket URL state via nuqs

**Don't.** Works for 50 papers, dies at 100, breaks at 500. We're designing for 1000. This is the one place URL state is explicitly wrong. (nuqs is still the right choice for view mode, filter params on the workbench, and the `col=<id>` filter on `/library` — just not for the basket.)

### Anti-Pattern 3: Multi-step wizard inside `ExtractionDialog`

**Don't.** The existing dialog is already tight (85vh max, two sections + footer). Trying to stuff tab navigation + selection inside it makes both the selector and the question builder cramped and breaks the "one dialog = one purpose" contract the project already follows (screening-dialog, extraction-dialog, extraction-jobs-dialog). The selector needs a full page.

### Anti-Pattern 4: Pre-fetch all Zotero items on tab open

**Don't.** 10k items × ~1 KB JSON = 10 MB; the existing `fetchItems` action already paginates 50 at a time with `nextCursor`/`hasMore`. Use it.

### Anti-Pattern 5: Create a new cascade delete path for `extractionSelections`

**Don't.** By choosing Zustand storage, there's nothing to cascade-delete. No Phase 94 audit, no user-deletion test, no orphan cleanup cron. This is the simplicity payoff of ephemeral storage.

### Anti-Pattern 6: Duplicate OpenAlex fetch logic across `parse.ts` and `openalex/actions.ts`

**Don't.** If `resolveByDoi` grows to include PDF URL extraction or metadata trimming, factor `lib/openalex-fetch.ts` out **at that point**, not speculatively. Today, the two modules fetch different fields for different purposes — duplication is fine at 10 lines each.

### Anti-Pattern 7: Build the workbench views before the data-table primitive

**Don't.** Each view reuses the same table primitive (TanStack Table + shadcn wrapper) with different cell renderers. Building 4 ad-hoc tables means 4× the maintenance. Phase 3 establishes the primitive; Phase 5 consumes it.

### Anti-Pattern 8: Forget hydration guards on the basket counter

**Don't.** Next.js SSR renders "0", then client hydrates and might jump to "87" → classic hydration mismatch. Every basket read in rendering code must check `_hasHydrated` first and show a skeleton until then. The existing `createSidebarStore` pattern in `lib/store.ts:1075` is the template.

---

## 14. Scaling Considerations

| Scale | What breaks | Mitigation |
|-------|-------------|-----------|
| 100 baskets × 200 papers | Nothing | Sessions are per-tab; concurrent basket assembly is independent |
| 1000 papers/basket × heavy Zotero resolve | 1000 sequential `resolveByDoi` calls = ~5–10 minutes | Batch resolution in groups of 10 (`Promise.all`), show progress in the Zotero tab |
| Pro user with 50k Zotero items | Zotero API polite pool throttling | Keep pagination at 50; rely on `nextCursor`; don't auto-load all |
| 10k concurrent extractions (backend) | `extractionPool` workpool contention | Already solved in v6.0 via concurrency caps (5) |
| Workbench on 1000-paper job | Table rendering at 1000 rows | Use TanStack Table's row virtualization (built-in) |

### First bottleneck to hit

**Zotero DOI batch resolution latency.** A user ticking 200 Zotero items one-at-a-time will suffer 200× 500–1500ms round-trips. Mitigation: "Select all on page" (50 items) + batch-resolve via a new action `resolveByDois({dois[]})` that runs them in parallel with a 10-concurrent cap. This is a Phase 7 UX polish, not a blocker.

### Second bottleneck

**Workbench render on 1000 papers × 5 questions = 5000 cells.** Mitigation: TanStack Table v8 has first-class virtualization via `@tanstack/react-virtual`. Wire it in Phase 3 from the start — retrofitting is harder.

---

## 15. Confidence & Assumptions

### HIGH confidence

- Schema and mutation shapes (read directly from `convex/schema.ts` and `convex/extraction/mutations.ts`)
- Existing Zustand patterns (read directly from `lib/store.ts`, 1142 lines, all present)
- Zotero backend completeness (read directly from `convex/zotero/actions.ts` 1124 LOC, `queries.ts`, `http.ts`, `schema.ts`)
- TierSelector orphaning (read directly from `extraction-dialog.tsx:125` — the mutation call omits tier)
- The "ExtractionDialog papers prop unconnected" gap (read directly from `extraction-list-client.tsx:34-37`, confirmed by PROJECT.md line 203)
- `createSidebarStore` factory pattern (read directly from `lib/store.ts:1068-1095`)
- `resolveEffectivePlan` reuse (read directly from `lib/billing/entitlements.ts:44`)
- `MAX_EXTRACTION_PAPERS_PER_JOB = 200` current constant shape (read directly from `convex/lib/queryBounds.ts:22`)
- OpenAlex DOI fetch URL pattern (read directly from `convex/extraction/parse.ts:101`)

### MEDIUM confidence

- **Collection detail route non-existence** — verified by `ls app/library/` showing only `page.tsx`; but the milestone context says "if collections have a detail route, which I need to check". Verified no `/collections/[id]` route exists today; decision stands.
- **Env validation cron checks Zotero vars** — not directly read; Phase 0 task is to verify `convex/lib/envValidation.ts` and add them if missing.
- **`convex/zotero/internal.ts` contents** — referenced in `actions.ts` (`internal.zotero.internal.getConnection`) but not directly read; assumed intact per PROJECT.md hourly cron still running.
- **Bookmarks command center structure** — directory exists (`components/bookmarks-command-center/`) but specific files not listed in the task's files_to_read; assumed to follow the same pattern as library/search command centers.

### LOW confidence (flagged for Phase 0 verification)

- **Exact TanStack Table version** in use, if any. Must verify `package.json` in Phase 3; if not installed, adds it to the Phase 3 scope.
- **TierSelector eval impact** — "cheap tier is 5% less accurate" is a PROJECT.md-era claim I couldn't find a direct source for in the research files. Tier copy should say something like "Cheaper, single-pass — best for simple factoids" and let users eval their own trade-off.
- **Zotero's `fetchItems` action latency and reliability** — the function has extensive logging but no test coverage around the recursive-descendants path. If Phase 7 discovers the `includeDescendants: true` path is slow, we'd constrain the UI to `includeDescendants: false` initially.

---

## 16. Sources

- `/Users/mcharrad/Documents/Github/openalex-count/.planning/PROJECT.md` — current milestone definition, known v6.0 gaps, tech stack inventory
- `/Users/mcharrad/Documents/Github/openalex-count/convex/schema.ts` — authoritative schema (extractionJobs, extractionPapers, extractionResults, extractionQuestions, libraryItems, collections, libraryItemCollections, zoteroConnections, zoteroOAuthTokens)
- `/Users/mcharrad/Documents/Github/openalex-count/convex/extraction/mutations.ts` — createExtractionJob (line 31), enqueue pattern, cancel flow
- `/Users/mcharrad/Documents/Github/openalex-count/components/extraction/extraction-dialog.tsx` — current dialog contract, the orphan mutation call at line 125
- `/Users/mcharrad/Documents/Github/openalex-count/components/extraction/tier-selector.tsx` — orphaned TierSelector UI
- `/Users/mcharrad/Documents/Github/openalex-count/convex/zotero/actions.ts` — 1124 lines of OAuth + API wrappers, pagination in `fetchItems` lines 758–930
- `/Users/mcharrad/Documents/Github/openalex-count/convex/zotero/queries.ts` — `getConnectionStatus` shape
- `/Users/mcharrad/Documents/Github/openalex-count/convex/http.ts` — `/api/zotero/callback` live route at lines 62-97
- `/Users/mcharrad/Documents/Github/openalex-count/convex/lib/queryBounds.ts` — current `MAX_EXTRACTION_PAPERS_PER_JOB = 200`
- `/Users/mcharrad/Documents/Github/openalex-count/lib/billing/entitlements.ts` — `resolveEffectivePlan` at line 44, SubscriptionPlan type
- `/Users/mcharrad/Documents/Github/openalex-count/lib/store.ts` — `createSidebarStore` factory pattern at line 1068, existing Zustand stores
- `/Users/mcharrad/Documents/Github/openalex-count/lib/auth/use-auth-query.ts` — `useProtectedQuery` wrapper
- `/Users/mcharrad/Documents/Github/openalex-count/convex/extraction/extract.ts` — `createCascadeTiers()` at line 187, the function that needs tier-slicing
- `/Users/mcharrad/Documents/Github/openalex-count/convex/extraction/parse.ts` — existing OpenAlex DOI fetch pattern at line 91
- `/Users/mcharrad/Documents/Github/openalex-count/convex/library/collections.ts` — collection queries (listCollections, getCollectionsWithCounts)
- `/Users/mcharrad/Documents/Github/openalex-count/app/extraction/extraction-list-client.tsx` — the orphan mount point at line 34
- `/Users/mcharrad/Documents/Github/openalex-count/app/extraction/[jobId]/extraction-results-client.tsx` — current single-view workbench (to be replaced/extended with 4 views)
- `/Users/mcharrad/Documents/Github/openalex-count/components/library/library-page-client.tsx` — library page shell, shows SidebarLayout pattern at lines 441+
- `/Users/mcharrad/Documents/Github/openalex-count/components/screening/screening-dialog.tsx` — similar dialog precedent (540 lines)

---

*Architecture research for: v7.0 Extraction Workbench*
*Researched: 2026-04-15*
