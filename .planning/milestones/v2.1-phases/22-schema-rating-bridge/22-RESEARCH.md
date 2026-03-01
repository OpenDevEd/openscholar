# Phase 22: Schema & Rating Bridge - Research

**Researched:** 2026-02-28
**Domain:** Convex schema design, data normalization, Zustand-to-Convex bridging
**Confidence:** HIGH

## Summary

Phase 22 is the foundation for v2.1 Library & Collections. It creates the `libraryItems` Convex table with slim normalized metadata, a `trimPaperData` utility to strip full OpenAlex Work blobs down to ~1 KB documents, a Convex mutation for upsert-on-rate, and a client-side bridge that fires the mutation when a signed-in user rates a paper while preserving the existing Zustand/localStorage behavior for anonymous users.

The existing codebase has all the building blocks: `useRatingsStore` (Zustand with localStorage persistence) handles client-side ratings, `RatingSelector` renders the star UI, paper card components pass `result` (the full OpenAlex `Work` object) and `result.id` (the OpenAlex work URL like `https://openalex.org/W1234567890`). The `requireAuth`/`getCurrentUser` patterns in `convex/lib/auth.ts` provide the server-side auth helpers. No new npm packages are needed.

**Primary recommendation:** Define the `libraryItems` table with explicitly typed slim fields (no `v.any()` blob), create a `trimPaperData()` utility function, add a `saveToLibrary` Convex mutation with upsert logic, and modify `RatingSelector` to accept the paper result object and conditionally call the mutation for authenticated users.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LIB-01 | Rating a paper (signed-in user) saves/upserts it to the user's Convex-backed library with slim normalized metadata | Schema design section defines the `libraryItems` table; Architecture Patterns section covers the upsert mutation and RatingSelector bridge; the `by_user_openalexId` compound index enables dedup lookup |
| LIB-02 | Library stores trimmed paper data (title, authors, DOI, abstract, year, journal, cited_by_count, open access status, OpenAlex ID) -- not the full Work blob | The `trimPaperData` utility pattern extracts exactly these 10 fields from the OpenAlex `Work` type. Document size estimated at 800-1200 bytes, well within the 1-2 KB success criterion |
| LIB-12 | Anonymous users retain existing localStorage rating behavior (Zustand fallback) | Architecture Patterns section covers the dual-path approach: `useAuth` phase check gates Convex mutation, anonymous users fall through to existing `useRatingsStore` localStorage persistence unchanged |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex` | ^1.31.7 | Backend database, schema, mutations, queries | Already the project's entire backend. `defineTable`, `v` validators, compound indexes, mutations with `requireAuth` are established patterns |
| `zustand` | ^5.0.5 | Client-side rating state with localStorage persistence | Already used for `useRatingsStore`. Remains the optimistic cache for search results page |
| `@clerk/nextjs` | ^6.38.2 | Authentication state (`useAuth`) | Already provides `isSignedIn` for conditional mutation calls |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex/react` | (bundled with convex) | `useMutation` hook for calling Convex mutations from React | Bridge: `RatingSelector` calls `useMutation(api.library.mutations.saveToLibrary)` |
| `convex/values` | (bundled with convex) | `v` validators for schema and mutation args | Schema definition and mutation arg validation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Typed slim fields on `libraryItems` | `paperData: v.any()` for full Work blob | STACK.md research suggested `v.any()` blob, but success criteria #4 requires 1-2 KB documents with "full OpenAlex blob fields stripped." Slim typed fields enforce the size constraint at schema level and avoid storing 5-20 KB Work objects |
| Modifying `RatingSelector` to accept paper data | Creating a separate `useLibrarySave` hook called from parent components | Modifying `RatingSelector` keeps the bridge logic co-located with the rating action. A separate hook would require coordinating state across parent components |
| `searchableText` concatenated field | Separate title/abstract fields for search | Convex search indexes support exactly 1 `searchField`. Concatenation is the established pattern. Phase 23 will use this for search, but Phase 22 should include it in the schema and populate it at save time |

**Installation:**
```bash
# No new packages needed. Zero npm install commands.
```

## Architecture Patterns

### Recommended Project Structure
```
convex/
├── library/
│   ├── mutations.ts        # saveToLibrary (upsert)
│   └── queries.ts          # (placeholder for Phase 23)
├── lib/
│   └── trimPaperData.ts    # Pure function: Work -> slim metadata
├── schema.ts               # ADD libraryItems table
lib/
├── types/
│   └── library.types.ts    # LibraryItemSlim type (shared client/display)
components/
├── rating-selector.tsx     # MODIFY: accept paper result, call mutation
```

### Pattern 1: Slim Metadata Schema (No v.any() Blob)

**What:** Define `libraryItems` with explicitly typed fields matching the 10 required metadata fields from LIB-02, plus `searchableText` for Phase 23 search, plus `rating`, `savedAt`, `updatedAt` system fields. No `paperData: v.any()`.

**When to use:** When the success criteria explicitly require stripped documents at 1-2 KB.

**Schema:**
```typescript
// convex/schema.ts -- ADD to defineSchema
libraryItems: defineTable({
  userId: v.id("users"),
  openalexId: v.string(),                    // e.g. "https://openalex.org/W1234567890"
  rating: v.number(),                         // 0-5
  title: v.string(),
  authors: v.optional(v.string()),            // Flattened: "John Doe, Jane Smith"
  doi: v.optional(v.string()),
  abstract: v.optional(v.string()),
  publicationYear: v.optional(v.number()),
  journal: v.optional(v.string()),            // primary_location.source.display_name
  citedByCount: v.optional(v.number()),
  isOpenAccess: v.optional(v.boolean()),
  oaStatus: v.optional(v.string()),           // "gold" | "green" | "bronze" | "hybrid" | "closed"
  searchableText: v.string(),                 // title + abstract + authors (for Phase 23 search index)
  savedAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_openalexId", ["userId", "openalexId"])
  .index("by_user_rating", ["userId", "rating"])
  .index("by_user_savedAt", ["userId", "savedAt"])
  .index("by_user_year", ["userId", "publicationYear"])
  .searchIndex("search_library", {
    searchField: "searchableText",
    filterFields: ["userId", "rating"],
  }),
```

**Rationale for including indexes and searchIndex now (even though Phase 23 uses them):**
Convex schema changes require a deployment. Adding all indexes upfront avoids a second schema migration in Phase 23. The indexes have zero cost until queried. The search index will backfill automatically when the first document is inserted.

**Index budget:** 5 regular + 1 search = 6 total (Convex limit: 32 per table).

### Pattern 2: trimPaperData Utility

**What:** A pure function that extracts the 10 required fields from an OpenAlex `Work` object and produces the slim metadata for storage.

**When to use:** Called in the Convex mutation (server-side) or as a client-side utility before sending data to the mutation.

**Example:**
```typescript
// convex/lib/trimPaperData.ts
import type { Work } from "./types"; // or inline type

export interface TrimmedPaperData {
  openalexId: string;
  title: string;
  authors: string | undefined;
  doi: string | undefined;
  abstract: string | undefined;
  publicationYear: number | undefined;
  journal: string | undefined;
  citedByCount: number | undefined;
  isOpenAccess: boolean | undefined;
  oaStatus: string | undefined;
}

export function trimPaperData(work: Record<string, any>): TrimmedPaperData {
  const authors = work.authorships
    ?.map((a: any) => a.author?.display_name)
    .filter(Boolean)
    .join(", ") || undefined;

  return {
    openalexId: work.id,
    title: work.title || work.display_name || "",
    authors,
    doi: work.doi || undefined,
    abstract: work.abstract || undefined,
    publicationYear: work.publication_year || undefined,
    journal: work.primary_location?.source?.display_name || undefined,
    citedByCount: work.cited_by_count ?? undefined,
    isOpenAccess: work.open_access?.is_oa ?? undefined,
    oaStatus: work.open_access?.oa_status || undefined,
  };
}
```

**Design choice -- trim client-side or server-side?**
Trim client-side before sending to the mutation. This avoids sending the full 5-20 KB Work object over the wire to Convex. The mutation receives only the slim fields (~1 KB). This is more bandwidth-efficient and aligns with the success criteria that the Convex documents themselves are 1-2 KB.

### Pattern 3: Upsert Mutation with requireAuth

**What:** A Convex mutation that inserts or updates a library item using the `by_user_openalexId` compound index for dedup.

**When to use:** Called from the RatingSelector when a signed-in user rates a paper.

**Example:**
```typescript
// convex/library/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";

export const saveToLibrary = mutation({
  args: {
    openalexId: v.string(),
    rating: v.number(),
    title: v.string(),
    authors: v.optional(v.string()),
    doi: v.optional(v.string()),
    abstract: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
    journal: v.optional(v.string()),
    citedByCount: v.optional(v.number()),
    isOpenAccess: v.optional(v.boolean()),
    oaStatus: v.optional(v.string()),
  },
  returns: v.id("libraryItems"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const searchableText = [args.title, args.abstract, args.authors]
      .filter(Boolean)
      .join(" ");

    // Upsert: check if already in library
    const existing = await ctx.db
      .query("libraryItems")
      .withIndex("by_user_openalexId", (q) =>
        q.eq("userId", user._id).eq("openalexId", args.openalexId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        searchableText,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("libraryItems", {
      userId: user._id,
      ...args,
      searchableText,
      savedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
```

**Upsert behavior:** On re-rate, only `rating`, `searchableText`, and `updatedAt` are patched. The metadata fields (title, authors, etc.) are NOT updated because they came from the same OpenAlex source and don't change. `savedAt` is preserved as the original save timestamp.

### Pattern 4: RatingSelector Bridge (Dual-Path)

**What:** Modify `RatingSelector` to accept the paper `result` object and call the Convex mutation for signed-in users while preserving Zustand localStorage behavior for anonymous users.

**When to use:** This is the core bridge logic that connects the existing UI to the new backend.

**Current signature:**
```typescript
interface RatingSelectorProps {
  paperId: string;
  variant?: "default" | "compact";
}
```

**New signature:**
```typescript
interface RatingSelectorProps {
  paperId: string;
  paperResult?: Work;           // Full OpenAlex result for library save
  variant?: "default" | "compact";
}
```

**Bridge logic:**
```typescript
export function RatingSelector({ paperId, paperResult, variant = "default" }: RatingSelectorProps) {
  const { ratings, setRating } = useRatingsStore();
  const { phase } = useAuthReadiness();
  const saveToLibrary = useMutation(api.library.mutations.saveToLibrary);

  const handleRatingChange = (rating: string) => {
    const newRating = rating === "no-rating" ? null : parseInt(rating);

    // 1. Always update Zustand (optimistic, localStorage)
    setRating(paperId, newRating);

    // 2. If signed-in AND we have paper data AND rating is not removal, save to Convex
    if (phase === "authenticated" && paperResult && newRating !== null) {
      const trimmed = trimPaperData(paperResult);
      saveToLibrary({
        ...trimmed,
        rating: newRating,
      }).catch((error) => {
        // Log but don't block -- Zustand already has the rating
        console.error("[Library] Failed to save to library:", error);
      });
    }

    // PostHog tracking (existing)
    posthog.capture("paper_rated", { ... });
  };
  // ... rest of component
}
```

**Key design decisions:**
- `paperResult` is optional: components that don't have the full result (unlikely but defensive) gracefully degrade to Zustand-only
- Mutation is fire-and-forget (`.catch()` logs but doesn't throw): the rating UI is optimistic, the library save is eventual
- Rating removal (`"no-rating"`) does NOT delete from library -- it only removes the Zustand client-side rating. Library removal is a separate action in Phase 23 (LIB-07)
- `trimPaperData` is called client-side to avoid sending the full Work blob over the wire

### Pattern 5: Focus Mode Rating Bridge

**What:** The `FocusMode` component (`components/ui/focus-mode.tsx`) has its own `handleRatingChange` that bypasses `RatingSelector`. It must also call the Convex mutation.

**When to use:** When the user rates via keyboard shortcuts (0-5, X) or star buttons in focus mode.

**Approach:** Extract the bridge logic into a shared hook (e.g., `useLibrarySave`) that both `RatingSelector` and `FocusMode` can use, or apply the same dual-path logic inline in `FocusMode`'s `handleRatingChange`.

### Anti-Patterns to Avoid

- **Storing the full OpenAlex Work blob:** The `Work` type has 40+ fields including `abstract_inverted_index`, `authorships` (with nested institutions), `concepts`, `counts_by_year`, `referenced_works`, `related_works`, `mesh`, etc. A real Work object is 5-20 KB. The success criteria require 1-2 KB documents. Use `trimPaperData` to extract only the 10 required fields.

- **Using `v.any()` for paper data:** While STACK.md research suggested `paperData: v.any()`, Phase 22 success criteria explicitly require stripped documents. Using `v.any()` would bypass Convex's type validation and make the document size unpredictable.

- **Calling mutation from Zustand store middleware:** It might seem elegant to intercept `setRating` in Zustand middleware and fire the mutation there. Don't -- Zustand stores are pure client state and should not have side effects that depend on auth state or Convex client availability. Keep the bridge logic in React components where hooks (`useAuth`, `useMutation`) are available.

- **Blocking the UI on mutation result:** The mutation should be fire-and-forget. Users expect instant rating feedback. The Zustand store provides this. The Convex mutation confirms persistence asynchronously.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Upsert by user+openalexId | Manual insert-or-update with transaction | Convex compound index `by_user_openalexId` + `.unique()` then conditional `patch`/`insert` | Convex mutations are transactional by default. The compound index + `.unique()` pattern is the established Convex upsert idiom (used in `ensureUser`, `stripeEventLogs`) |
| Auth check in mutation | Custom JWT parsing | `requireAuth(ctx)` from `convex/lib/auth.ts` | Already built, tested, handles suspended/deleted users, returns typed `Doc<"users">` |
| Auth state on client | Manual Clerk token checking | `useAuthReadiness()` from `convex-provider.tsx` | Already built with settlement state machine, handles initializing/syncing edge cases |
| Paper metadata extraction | Inline field picking in component | `trimPaperData()` utility function | Centralizes the mapping from OpenAlex Work to slim metadata. Single place to update if fields change. Testable as a pure function |

**Key insight:** Every building block for this phase already exists in the codebase. The work is connecting them: Zustand store -> Convex mutation -> schema table.

## Common Pitfalls

### Pitfall 1: Sending Full Work Object to Convex Mutation
**What goes wrong:** The mutation args include `paperData: v.any()` or accept the full Work object, resulting in 5-20 KB documents instead of 1-2 KB.
**Why it happens:** The STACK.md research recommended `v.any()` for flexibility. But Phase 22 success criteria require slim documents.
**How to avoid:** Trim client-side with `trimPaperData()`. Mutation args should only accept the 10 slim fields. Measure document size in tests.
**Warning signs:** Mutation args file size grows beyond 1-2 KB. Schema has `v.any()` fields.

### Pitfall 2: Breaking Anonymous Rating Flow
**What goes wrong:** Refactoring `RatingSelector` breaks the existing localStorage rating for anonymous users.
**Why it happens:** Adding auth-conditional logic introduces paths where `setRating` (Zustand) is skipped.
**How to avoid:** Always call `setRating` first (step 1), then conditionally call Convex mutation (step 2). The Zustand call is unconditional. Test with both signed-in and anonymous users.
**Warning signs:** Anonymous user rates a paper, refreshes page, rating is gone.

### Pitfall 3: Race Condition on Rapid Re-Rating
**What goes wrong:** User rapidly changes rating (e.g., 3 -> 4 -> 5). Three mutations fire. They may resolve out of order, leaving the library item with rating 4 instead of 5.
**Why it happens:** Convex mutations are queued but execution order isn't guaranteed when fired from client in rapid succession.
**How to avoid:** Convex mutations within a single client are executed in order. The Convex client batches and orders mutations from the same session. This is a non-issue with Convex's default behavior, but worth verifying. If needed, a simple debounce (300ms) on the mutation call would eliminate rapid-fire mutations.
**Warning signs:** Library shows a different rating than what the user last selected.

### Pitfall 4: Forgetting FocusMode Rating Path
**What goes wrong:** Rating from focus mode (keyboard shortcuts, star buttons) doesn't save to library because only `RatingSelector` was modified.
**Why it happens:** `FocusMode` has its own `handleRatingChange` function that directly calls `setRating` from Zustand, bypassing `RatingSelector`.
**How to avoid:** Extract the bridge logic into a shared hook or apply the same dual-path logic in `FocusMode`. Ensure all rating entry points trigger the Convex mutation.
**Warning signs:** Rating from search results saves to library but rating from focus mode does not.

### Pitfall 5: Schema Deployment Without Indexes
**What goes wrong:** Schema is deployed with the `libraryItems` table but without the search index and regular indexes. Phase 23 then requires a second schema migration.
**Why it happens:** Thinking "we'll add indexes when we need them."
**How to avoid:** Define all 5 regular indexes and the search index in the Phase 22 schema definition. Indexes have zero cost until queried. Adding them upfront prevents a schema migration in Phase 23.
**Warning signs:** Phase 23 planning says "add search index to libraryItems."

### Pitfall 6: `result.id` vs OpenAlex ID Confusion
**What goes wrong:** Using `result.id` directly without understanding its format. OpenAlex work IDs are full URLs like `https://openalex.org/W1234567890`, not bare IDs.
**Why it happens:** The `Work.id` field is a string that looks like a URL.
**How to avoid:** Store the full URL as `openalexId`. This is consistent with how `extractionPapers.openalexId` is stored in the existing schema. Use it as-is for dedup.
**Warning signs:** Attempting to parse or transform the ID, or storing a different format than what `result.id` provides.

## Code Examples

### Example 1: Current Rating Flow (What Exists Today)

```typescript
// components/rating-selector.tsx (current -- Zustand only)
export function RatingSelector({ paperId, variant }: RatingSelectorProps) {
  const { ratings, setRating } = useRatingsStore();

  const handleRatingChange = (rating: string) => {
    if (rating === "no-rating") {
      setRating(paperId, null);
    } else {
      setRating(paperId, parseInt(rating));
    }
    posthog.capture("paper_rated", { ... });
  };
}
```

### Example 2: Current Paper Card Usage (Where Paper Data Is Available)

```typescript
// components/paper-card/paper-card-list-detail.tsx
<RatingSelector paperId={result.id} variant="compact" />
// `result` is the full OpenAlex Work object -- available in scope
// Phase 22 changes this to:
<RatingSelector paperId={result.id} paperResult={result} variant="compact" />
```

### Example 3: Existing Upsert Pattern in Codebase

```typescript
// convex/users/mutations.ts -- ensureUser (existing pattern)
const existing = await ctx.db
  .query("users")
  .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
  .unique();

if (existing) {
  await ctx.db.patch(existing._id, { lastLoginAt: Date.now() });
  return existing._id;
}

return await createUserWithDefaults(ctx, { ... });
```

### Example 4: Auth Readiness Check (Existing Pattern)

```typescript
// Used in multiple components to conditionally run auth-dependent logic
import { useAuthReadiness } from "@/components/providers/convex-provider";

const { phase } = useAuthReadiness();
const isSignedIn = phase === "authenticated";
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ratings in localStorage only (Zustand) | Ratings in Zustand + Convex (dual-write for signed-in users) | Phase 22 (v2.1) | Ratings persist server-side. Library becomes a first-class feature |
| No library table in Convex | `libraryItems` table with slim metadata | Phase 22 (v2.1) | Foundation for library page, search, filtering, collections |
| `RatingSelector` receives only `paperId` | `RatingSelector` receives `paperId` + `paperResult` | Phase 22 (v2.1) | Bridge has the data needed to extract slim metadata for Convex |

**Deprecated/outdated:**
- Nothing deprecated. This phase adds new functionality without removing existing patterns.

## Open Questions

1. **Rating removal behavior**
   - What we know: When a user selects "no rating" on a paper they previously rated, the Zustand store removes the rating. But should this also remove the item from the library?
   - What's unclear: The success criteria don't specify removal behavior. LIB-07 (remove from library) is in Phase 23.
   - Recommendation: **Do NOT remove from library on "no rating."** Rating removal is a UI convenience (clearing the search results display). Library removal is a deliberate action with a confirmation step (Phase 23). Keep them separate. A "no rating" on a library item can be handled in Phase 23 as a separate concern.

2. **Convex mutation error handling**
   - What we know: The mutation is fire-and-forget. Errors are logged but don't block the UI.
   - What's unclear: Should there be any toast/feedback if the library save fails? Should there be a retry?
   - Recommendation: **Silent failure with console.error for Phase 22.** The rating itself succeeds (Zustand). Library save failure is rare (auth issues, Convex downtime). Phase 26 (EXP-04) can add toast feedback on destructive actions, but save failure is not destructive. If needed later, add retry logic.

3. **Should `trimPaperData` live in `convex/lib/` or `lib/`?**
   - What we know: It's called client-side (in React components) before sending to the mutation.
   - What's unclear: Convex files in `convex/` are bundled separately from Next.js client code.
   - Recommendation: **Put `trimPaperData` in `lib/library/trim-paper-data.ts`** (client-side). It's a pure function that operates on the OpenAlex Work object available in the browser. The Convex mutation receives already-trimmed fields. If a shared type is needed, define `TrimmedPaperData` in `lib/types/library.types.ts`.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `convex/schema.ts` (existing 11 tables, all index patterns), `lib/store.ts` (useRatingsStore implementation at lines 153-176), `components/rating-selector.tsx` (current rating flow), `components/paper-card/` (paper card components showing `result.id` usage), `convex/lib/auth.ts` (requireAuth, getCurrentUser patterns), `convex/users/mutations.ts` (ensureUser upsert pattern), `components/providers/convex-provider.tsx` (AuthReadiness context), `lib/auth/use-auth-query.ts` (protected query hooks), `components/ui/focus-mode.tsx` (separate rating path at line 538-546)
- `node_modules/@sickrin/openalex-sdk/dist/src/types/work.d.ts` -- OpenAlex `Work` type definition with 40+ fields, confirming the need for trimming
- `.planning/research/STACK.md` -- Prior research covering schema design, Convex patterns, indexes, junction tables, and pagination (HIGH confidence, same-day research)
- `.planning/codebase/CONVENTIONS.md` -- Naming conventions, import patterns, Convex module structure
- `.planning/codebase/ARCHITECTURE.md` -- Data flow patterns, auth flow, state management strategy
- `.planning/codebase/STRUCTURE.md` -- Directory layout, where to add new code

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` -- v2.1 requirement definitions (LIB-01, LIB-02, LIB-12)
- `.planning/ROADMAP.md` -- Phase 22 scope, success criteria, dependencies

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase inspection and verified project documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies. All libraries already in use and verified via `package.json`.
- Architecture: HIGH - Schema design follows established Convex patterns (`extractionPapers` table has similar structure). Upsert pattern mirrors `ensureUser`. Auth patterns are well-established.
- Pitfalls: HIGH - Identified through direct inspection of the rating flow, focus mode, and OpenAlex Work type size analysis.

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable domain -- Convex APIs, Zustand, and project patterns are not fast-moving)
