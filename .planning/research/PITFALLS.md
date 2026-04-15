# PITFALLS — v7.0 Extraction Workbench

**Project:** openalex-count (Next.js 15 + Convex + Clerk + @convex-dev/workflow + Zotero OAuth)
**Milestone context:** Adding cross-source paper selector + multi-view workbench + 1000-paper limit + Zotero revival + TierSelector fix to an existing v6.0 codebase
**Researched:** 2026-04-15
**Confidence:** HIGH (repository-grounded for integration-specific pitfalls; MEDIUM for generic React/library patterns)

## Output file

**Note to orchestrator:** Instructions were ambiguous — the role frontmatter says "Write research files in `.planning/research/`" but the runtime footer says "Do NOT Write report/summary/findings/analysis .md files. Return findings directly." I'm following the runtime footer (the stricter, later rule) and returning findings as this assistant message. If the orchestrator needs a file, re-invoke with explicit instructions to write one.

---

## How to read this

Each pitfall below is structured as:

- **What goes wrong** — the specific failure mode in this codebase
- **Warning signs** — observable symptoms before the bug bites
- **Prevention** — actionable guardrail (not "be careful")
- **Phase to address** — where the roadmap should enforce it
- **Repo evidence** — file paths that ground the claim

Severity legend: **CRITICAL** = data loss / crash / rewrite, **SIGNIFICANT** = wrong behavior / UX break, **MODERATE** = polish / telemetry, **MINOR** = cleanup.

---

## 1. Data tables with 1000+ rows in React + App Router

### 1.1 TanStack Table column filter re-render storm (CRITICAL)

**What goes wrong:** With 1000 rows and a debounced text filter, every keystroke triggers `getFilteredRowModel()` to recompute the entire table. If column filters are stored as individual React state and spread into `useReactTable({ state: { columnFilters } })`, the table re-memoizes on every filter object identity change, not just value change. Compound with `useQuery` (reactive Convex subscription) re-running on every server mutation, and you get visible lag plus dropped frames.

**Warning signs:**
- Filter input feels sticky past ~100 rows
- React DevTools Profiler shows `TableBody` rendering on every keystroke
- `getFilteredRowModel()` appears near top of flame graph

**Prevention:**
- Store `columnFilters` in `useState` with a single stable setter
- Wrap the table row cells in `React.memo` with primitive comparator, not full row object
- Debounce the filter input with `useDeferredValue` (React 19 native) rather than `useDebounce` from a lib
- **Never** recompute `useReactTable` options inline — hoist `columns` definition outside component or wrap in `useMemo([])`
- Server-side filter only fires when filter is submitted/settled, not on every keystroke

**Phase:** **Results Workbench Toolbar** phase. Add SC: "1000-row table with active text filter: input lag < 50ms on mid-range laptop, measured with React DevTools Profiler."

### 1.2 Server-side filtering with Convex reactive queries (CRITICAL)

**What goes wrong:** Instinct is to push filters to `getExtractionResults` server query. But `getExtractionResults` already loads all papers in a single `useQuery` subscription — adding a `filters` arg means **every filter change invalidates the entire subscription**, forcing re-transport of the full 1000-paper payload and re-renders of all subscribers. Worse, if the job is still running, new `extractionResults` rows streaming in mix with user filter changes, causing flicker.

Existing query (`convex/extraction/queries.ts:479`) is a single non-paginated reactive query returning the whole job. It was designed for 200 papers. At 1000 papers × N questions, payload is 5× larger AND filtering server-side would multiply subscription thrash.

**Warning signs:**
- Filter change causes entire table to flash/remount
- Network tab shows large WS payloads per filter change
- Running job: new results appearing causes filter state to drop

**Prevention:**
- **Filter client-side for in-flight jobs** — the reactive subscription delivers everything; filtering is free local work
- **Filter server-side only for completed, paginated lists** (job history, not per-job results)
- Keep `getExtractionResults` reactive, add optional client-side filter layer ON the reactive result
- If server filtering is truly needed, use `usePaginatedQuery` with filter args baked into cursor — document that pagination resets on filter change
- **Never** add filter args to the primary reactive `getExtractionResults` query

**Phase:** Results Workbench Data Layer phase. Document the "reactive for live, paginated for export" split as a project Key Decision.

### 1.3 Virtualization: row-height jitter + sticky header (SIGNIFICANT)

**What goes wrong:** `@tanstack/react-virtual` with dynamic row heights (rows contain evidence quotes of variable length) causes rows to jitter as `measureElement` reports heights async. If sticky header is inside the same scroll container, the sticky stacking context can break under virtualized `transform: translateY(…)` — header disappears or sits behind rows.

**Warning signs:**
- Scrolling fast: scroll jumps forward when hitting a tall evidence-quote row
- Sticky header disappears mid-scroll
- `estimateSize` callback warns about heights diverging

**Prevention:**
- Use `estimateSize: () => 72` matching the minimum row height (card collapsed) and enable `measureElement`
- Truncate evidence quote to first ~200 chars in table/card view; expand on row click into split view
- Pin sticky header to a separate DOM parent (not inside the scroll container)
- Do NOT try to virtualize both the row list AND a details panel in split view — virtualize only the list, render selected details in a separate component

**Phase:** Results Workbench Virtualization phase. SC: "scroll from row 1 to row 1000 with no jitter; sticky header remains visible throughout."

### 1.4 Column visibility state persistence ambiguity (SIGNIFICANT)

**What goes wrong:** Three wrong ways to persist column visibility:
1. **localStorage** — leaks across jobs (user hides column on job A, opens job B, column is hidden with no explanation)
2. **URL (nuqs)** — bloats URL with `?cols=a,b,c,d,e,f` on shared links; breaks back button
3. **Server (Convex)** — adds schema for a UX preference, infects domain tables

The existing codebase uses **nuqs** for library filters and **Zustand createSidebarStore factory** for sidebar collapse — both are reasonable but inconsistent.

**Warning signs:**
- Bug report: "columns keep hiding themselves"
- URL becomes 300+ chars
- Column state leaks between different job pages

**Prevention:**
- **localStorage keyed by "extraction-results-view" (global user preference, not per-job)** — matches sidebar store pattern
- Use the existing `createSidebarStore` factory pattern from `components/layout/sidebar-layout.tsx` — do not add a new state library
- View-specific state (which paper is selected in split view, current search term) lives in URL via nuqs (bookmarkable)
- Global UX prefs (column visibility, card size, view mode) live in Zustand+localStorage (personal preference)
- Document the split in ADR

**Phase:** Results Workbench State Architecture phase. Add to Key Decisions table in PROJECT.md.

### 1.5 Card view scroll performance at 1000 cards (CRITICAL)

**What goes wrong:** `PaperResultCard` exists today (`components/extraction/paper-result-card.tsx`) and renders an individual paper with nested `EvidenceQuote` components. At 200 papers it works. At 1000, naively mapping `data.papers.map(p => <PaperResultCard ...>)` creates 1000 mounted components, each with its own subscription hooks. Memory and CPU spike; iOS Safari may crash the tab.

Existing code (`app/extraction/[jobId]/extraction-results-client.tsx:175-182`) does exactly this naive map.

**Warning signs:**
- Tab memory > 500 MB
- First Contentful Paint fine, but Time to Interactive delayed 5+ s
- Mobile Safari tab crashes

**Prevention:**
- Card view MUST use virtualization (`@tanstack/react-virtual` or `react-window`)
- PaperResultCard made `React.memo` with stable keys
- Evidence-quote rendering lazy: collapsed by default, expand on click
- Scrolled-out cards unmount their `useQuery` subscriptions if any are hook-local
- Benchmark: 1000 cards cold load < 2 s on throttled 4G, < 100 MB heap growth

**Phase:** Results Workbench Card View phase. SC: "Instrument with React Profiler: render 1000 cards, total commit time < 500 ms."

### 1.6 Split view: state lost when selected paper changes (SIGNIFICANT)

**What goes wrong:** Split view has a list (left) and a detail panel (right). If the detail panel component remounts on each paper selection, local state (scroll position, which tab within detail, expanded sections) is lost. Classic symptom: user scrolls detail panel to a specific evidence quote, clicks next paper, scroll jumps to top even though they wanted to compare.

**Warning signs:**
- UX complaint: "can't compare papers, it keeps scrolling to top"
- Expanded sections collapse on every switch

**Prevention:**
- Detail panel is ONE component keyed by `jobId`, not by `paperId` — remount only when switching jobs
- Pass `selectedPaperId` as a prop, not as the React `key`
- Persist scroll-position & section-expanded state in a `useRef` Map keyed by paperId, restore on prop change
- Use `view-transitions` API for the transition (Next.js 15 supports it natively) — gives visual continuity

**Phase:** Results Workbench Split View phase. SC: "Select paper A, scroll detail, click paper B, click back to A — scroll position restored."

### 1.7 Column filter state leaking across different job pages (MINOR)

**What goes wrong:** URL-based filter state (nuqs) doesn't clear when navigating from `/extraction/jobA` to `/extraction/jobB` because the route is the same `[jobId]` segment — Next.js preserves search params. User applies "status=failed" filter on job A, clicks into job B, sees empty table and panics.

**Warning signs:**
- Empty results page when user knows job completed
- Filter chips visible but don't match current job

**Prevention:**
- Clear URL search params on jobId change via `useEffect([jobId])`
- Or scope filters to URL by including jobId in key: `?${jobId}.status=failed` (ugly)
- **Best:** Use Next.js `router.replace` with empty searchParams when jobId changes

**Phase:** Results Workbench Toolbar phase.

---

## 2. Multi-source selection baskets ("carts")

### 2.1 Dedupe race on mixed-format OpenAlex IDs (CRITICAL)

**What goes wrong:** OpenAlex IDs come in at least **3 formats** in this codebase:
- `W4387233234` (bare short form, used in API args)
- `https://openalex.org/W4387233234` (full URL form, used in `libraryItems.openalexId` per `convex/schema.ts:521`)
- `openalex:W4387233234` (sometimes used internally)

The existing `extractionPaperInputValidator` takes `openalexId: string` with no normalization. Library stores the full URL form. If the user selects the same paper from library (`https://openalex.org/W123`) AND from search (`W123`), dedupe-by-`===` treats them as two papers. User adds one paper "twice," counter ticks to 2/1000, workflow processes them as distinct papers, extraction runs 2×, user is double-billed, **duplicate rows in `extractionResults` for the same paper**.

**Warning signs:**
- Basket counter higher than unique papers
- Extraction results page shows the same paper title twice
- Idempotent-save guard (`convex/extraction/mutations.ts:424-433`) allows duplicates because it keys on `paperId` not `openalexId`

**Prevention:**
- **Add `normalizeOpenAlexId(id: string): string` utility** that strips `https://openalex.org/`, `openalex:` prefixes, lowercases, validates `^W\d+$`
- Dedupe the basket **by the normalized key**, not by the input string
- Apply the same normalizer in `createExtractionJob` mutation as defensive guard
- **Backfill:** the library already has `https://openalex.org/W…` stored; keep that canonical form but expose normalized short-form to the basket dedupe layer only
- Unit test: `normalize("https://openalex.org/W123") === normalize("W123")`

**Phase:** Paper Selector Dedupe phase. SC: "Select paper W4387233234 from library, search, and manual ID → basket shows 1 item."

### 2.2 Stale-source read: user deletes from library while it's in the basket (SIGNIFICANT)

**What goes wrong:** User adds 50 papers from library to basket. In another tab, they remove one paper from library. The Convex reactive subscription updates, but the basket state (if stored locally) still has 50 entries. At submit, the basket sends 50 openalexIds to `createExtractionJob`. Three possible outcomes:
1. Server accepts all 50 regardless — fine, but the basket's provenance labels are lying
2. Server validates against library — unexpected rejection "Paper X not found"
3. Server silently drops — user sees 49 in results, confused

**Warning signs:**
- Error toast: "Paper not found" at submit after a valid selection
- Result count != basket count
- Multi-tab edit sessions

**Prevention:**
- **Basket stores its own canonical copies** of minimal paper metadata (openalexId, title, doi) — no dependency on source data being still reachable
- Source removal doesn't affect basket (basket is a snapshot)
- But: visually gray out basket items whose source row is gone, with a "refresh from source?" affordance
- At submit time, server trusts the basket's payload, doesn't re-validate against library
- Document in ADR: "Basket is snapshot-based, not reference-based."

**Phase:** Paper Selector Basket phase. Key Decision: "Snapshot-based basket over reference-based."

### 2.3 Basket state lost on navigation (CRITICAL)

**What goes wrong:** User spends 10 minutes curating a cross-source basket (library + search + Zotero). They click into a search result to preview, click back, basket is empty. Or they refresh the page mid-selection. Fury.

**Warning signs:**
- User complaint: "I lost my selections"
- Click-back in browser discards state
- Refresh during selection = restart

**Prevention:**
- Basket persisted in `sessionStorage` (survives back/forward, cleared on tab close) — not `localStorage` (stale stuff haunts next session)
- Zustand store with `persist` middleware + `sessionStorage` adapter
- Scope to the current tab via sessionStorage; surface "resume previous basket" if one exists on page load
- Back button keeps basket intact: use `router.push`/`router.back` which preserve JS state
- Clear basket **only** on successful job creation (not on dialog close)
- **Never** put basket in URL — openalexIds explode URL length, shareable URL defeats the private snapshot purpose

**Phase:** Paper Selector Basket State phase.

### 2.4 Silent cap overflow across sources (CRITICAL)

**What goes wrong:** User adds 800 papers from library, 300 from Zotero. UI counter per-source shows `800/1000` and `300/1000` because each source picker has its own counter. Basket has 1100 items. At submit, server rejects with `Maximum 1000 papers per job`. User is confused: "but each source was under 1000!"

**Warning signs:**
- Rejection at submit with no pre-warning
- Counters per-source not aggregated

**Prevention:**
- **Single source of truth for count: the basket itself.** Every picker reads `useBasketStore(s => s.count)`, displays global `X / 1000`
- At `count === 1000`: all "add" buttons disabled with tooltip
- At `count === 999` + user selects multiselect of 10: cap the add to 1, show toast "Added 1 of 10 selected. Basket full."
- Basket-full warning banner on all source tabs, not just dialog footer
- Backend hard-reject + toast-route as secondary defense

**Phase:** Paper Selector Basket phase + Hard Limit phase.

### 2.5 Filter vs basket semantics: "select all" ambiguity (SIGNIFICANT)

**What goes wrong:** Classic data-table trap. User applies filter "year >= 2020," clicks "select all," gets 47 selected. Changes filter to "year >= 2015," now 200 rows visible. Does "select all" mean:
- **(a) Select all filtered rows** (intent: the 47)
- **(b) Select all rows currently visible** (intent: the 200)
- **(c) Replace selection with the filtered set** (destructive)

TanStack Table defaults vary. If you use `table.toggleAllRowsSelected()` vs `table.toggleAllPageRowsSelected()` — different behavior.

**Warning signs:**
- User bug report: "I clicked select all and it unchecked my previous selections"
- User bug report: "Select all didn't select the filtered rows, just the page"

**Prevention:**
- **Explicit semantics in the UI**: two buttons — "Select all on this page" and "Select all matching filter (N papers)"
- When filter changes, keep existing selection intact — do NOT reset
- Show chip "N selected" above the table; clicking it shows the full selection set independent of filter
- Document in UX spec: "Selection is additive across filter changes."
- **CRITICAL edge case:** "Select all matching filter" on a 10k-row search result page with a 1000 cap → show confirm dialog: "Only the first 1000 will be added. Continue?"

**Phase:** Paper Selector Selection Semantics phase.

### 2.6 Zotero items with no OpenAlex-resolvable ID (SIGNIFICANT)

**What goes wrong:** Existing Zotero backend (`convex/zotero/actions.ts:932-970`) returns items with optional `doi` field only. Many Zotero items have NO DOI (books, grey literature, dissertations, preprints not yet on arXiv). The extraction pipeline requires an OpenAlex ID to function (paper metadata, parsing waterfall, everything). A Zotero item without a resolvable OpenAlex ID is a dead-end.

**Warning signs:**
- Extraction fails with "Paper not found on OpenAlex" for Zotero-sourced items
- Users confused why some Zotero items can't be extracted

**Prevention:**
- On the Zotero tab in the selector, call a **DOI→OpenAlex resolution query** before allowing "Add to basket"
- Show per-item status: "Matched to OpenAlex W123" (green), "No match found — cannot extract" (grey, disabled), "Resolving…" (spinner)
- For items with arXiv IDs, PMIDs — build a small resolver: arXiv → OpenAlex, PMID → OpenAlex. OpenAlex supports these as alt IDs in the `ids` field
- **Never** let an unresolvable Zotero item into the basket — it would fail in the extraction pipeline mid-flight
- Document in copy: "Zotero items without a DOI, arXiv ID, or PubMed ID cannot be extracted because we have no path to full text."
- Allow bulk-add of only the resolvable subset: "Add 47 of 50 resolvable items"

**Phase:** Zotero Integration phase. SC: "Zotero picker distinguishes resolvable vs unresolvable items before basket add."

---

## 3. Zotero OAuth revival after orphan state

### 3.1 Dev DB has stale `zoteroConnections` and `zoteroOAuthTokens` rows (CRITICAL)

**What goes wrong:** The Zotero backend has been orphaned since Phase 88 teardown (all UI callers deleted). But the **Convex dev DB still has `zoteroConnections` rows** from old testing — these rows may have:
- Encrypted API keys encrypted with an old `ENCRYPTION_KEY` that's been rotated
- `keyPrefix` in an old format
- Associated with deleted user IDs (orphan FKs)

On first revival, `disconnect()` mutation (`convex/zotero/mutations.ts:129-146`) won't help if no one is logged in as that user. `resolveZoteroApiKey` (`convex/zotero/actions.ts:34-43`) will throw decrypt errors that look like "ENCRYPTION_KEY missing" when the actual cause is key rotation.

**Warning signs:**
- First `fetchItems` call: "Decryption failed" or "Invalid auth tag"
- `ENCRYPTION_KEY missing` but env var is set
- `zoteroConnections` rows with `userId` that doesn't exist in `users`

**Prevention:**
- **Phase 1 task: cleanup migration** — internal action `purgeStaleZoteroState` that deletes:
  - All `zoteroConnections` rows
  - All `zoteroOAuthTokens` rows (the hourly cron handles this, but force-purge at phase start)
- Only run against dev DB, not prod (guard with `process.env.CONVEX_CLOUD_URL` check or dev-deployment flag)
- Reconnect flow forces a fresh OAuth round-trip, producing clean state
- Alternatively: detect decrypt failures in `resolveZoteroApiKey` and auto-delete the broken connection with structured log entry

**Phase:** Zotero Revival phase, first plan.

### 3.2 `ZOTERO_CLIENT_KEY` / `ZOTERO_CLIENT_SECRET` env var status unknown (CRITICAL)

**What goes wrong:** The code (`convex/zotero/actions.ts:451-459`) checks these env vars at action-invocation time and throws `ZOTERO_OAUTH_NOT_CONFIGURED`. But **nobody has verified the dev Convex dashboard has them set**. They may have been rotated or expired at Zotero's end. First click on "Connect Zotero" → cryptic error.

Reminder: Convex env vars are **not in `.env.local`**, they're set via `npx convex env set` or the dashboard. Common mistake: developer sets them in `.env.local` and is confused when Convex actions can't see them.

**Warning signs:**
- `ZOTERO_OAUTH_NOT_CONFIGURED` at first Connect click
- `npx convex env list` doesn't show them
- They exist in `.env.local` but not in Convex dashboard

**Prevention:**
- **Phase precondition checklist:** verify `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`, `ENCRYPTION_KEY` all present in `npx convex env list`
- Add them to the cron env-var validator (`convex/maintenance/*`) — 24h catch window per existing project pattern
- Document in phase RESEARCH that the Zotero app at zotero.org may need to be reconfirmed (callback URL, scopes)
- First SC of Zotero phase: "Fresh dev environment: running `npx convex env list` shows ZOTERO_CLIENT_KEY and ZOTERO_CLIENT_SECRET set."

**Phase:** Zotero Revival phase, first plan.

### 3.3 Callback URL mismatch: localhost vs prod (SIGNIFICANT)

**What goes wrong:** OAuth 1.0a signs the `oauth_callback` parameter (`convex/zotero/actions.ts:471`). The callback URL is currently passed from the client as `callbackUrl` arg. If the client constructs it wrong (e.g., `window.location.origin + "/api/zotero/callback"` on localhost gives `http://localhost:3000/...` but Zotero app is registered with the prod URL), the OAuth handshake succeeds but the browser redirect 404s.

Dev-only OAuth apps: Zotero lets you register one consumer key but limits callback URL matching. If both dev and prod use the same key, dev must go through a proxy or NGROK.

**Warning signs:**
- OAuth flow completes at zotero.org but redirect lands on a 404
- Callback handler in Next.js returns 404 because the path is wrong
- Production works, localhost doesn't (or vice versa)

**Prevention:**
- **Two Zotero OAuth apps:** one for dev (callback `http://localhost:3000/api/zotero/callback`), one for prod. Document in README.
- Or: single app with both URLs registered (Zotero allows multiple callback patterns)
- Client always passes `${window.location.origin}${ZOTERO_CALLBACK_PATH}` and the callback path is a constant in `lib/zotero/constants.ts`
- Integration test: start OAuth → verify `authorizeUrl` contains the callback we sent

**Phase:** Zotero Revival phase, second plan.

### 3.4 OAuth request token deletion race (MODERATE)

**What goes wrong:** `getRequestToken` internalMutation (`convex/zotero/mutations.ts:42-73`) reads the token and **deletes it inside the same mutation** (one-time use semantics). Meanwhile, the hourly cleanup cron (`cleanupExpiredOAuthTokens`, `convex/zotero/mutations.ts:153-181`) also deletes expired tokens. If the user takes 10 minutes (the TTL) and comes back exactly as the cron runs, the cron deletes the token before the callback handler reads it. User sees "OAuth session expired or invalid."

Existing code handles this gracefully — the cleanup cron has `try/catch` per delete. But the user-facing error is still generic.

**Warning signs:**
- Flaky OAuth completes rate
- Error "OAuth session expired or invalid" when user completed flow within TTL

**Prevention:**
- Keep the TTL at 10 min (matches Zotero's typical auth window)
- Make the user-facing error more helpful: "Zotero authorization took too long. Please try again."
- Log the time delta between `storeRequestToken.createdAt` and `getRequestToken` read, alert if > 90% of TTL
- Confirm cleanup cron uses `by_expiry` index and only deletes `expiresAt < Date.now()` — it does (line 161)

**Phase:** Zotero Revival phase, second plan.

### 3.5 Zotero rate limits: 1 req/sec, ambiguous auth/unauth (SIGNIFICANT)

**What goes wrong:** Zotero API returns `429` when rate limit is hit, with `Retry-After` or `Backoff` header. Existing code (`fetchAllCollectionsForParent`, `fetchAllTopItemsForCollection`) has **zero backoff logic** — it fires sequential requests in a tight loop. Fetching a large library triggers cascading 429s and throws `ZOTERO_API_ERROR` mid-fetch, leaving the user with a partial list.

The task description's claim "unauthenticated higher than authenticated" is **backwards per current Zotero docs** (as of 2025: authenticated requests get higher limits). But this should be **verified with Zotero docs** at implementation time — it has changed in the past.

**Warning signs:**
- `ZOTERO_API_ERROR: 429` in logs after fetching ~100+ items
- User sees partial results then error toast

**Prevention:**
- Add exponential backoff with jitter on 429 / 5xx responses
- Respect `Retry-After` and `Backoff` headers (Zotero sends both)
- Centralize the fetch logic in `convex/zotero/fetchWithBackoff.ts` — replace all bare `fetch()` calls
- Cap total fetch time at 60s per user-facing operation (already has `signal: AbortSignal.timeout(30_000)` per-request, but not total)
- **Verify current Zotero rate limits** via their API docs before building the backoff schedule
- Do NOT use `pLimit` concurrency > 1 — keep fetches serial per user

**Phase:** Zotero Revival phase. SC: "Fetch 500+ items from Zotero without hitting 429."

### 3.6 Groups vs personal items endpoint mismatch (SIGNIFICANT)

**What goes wrong:** Existing code builds prefix `groupId ? /groups/${groupId} : /users/${zoteroUserId}`. If a user picks a group but the groupId is stale (group was renamed or deleted), Zotero returns 200 with empty array — not a 404. The selector shows "0 items" and user assumes empty group, when really the group ID is wrong.

**Warning signs:**
- Group with known items returns empty in picker
- 200 OK but `Total-Results: 0`

**Prevention:**
- Re-fetch groups list (`fetchGroups`) before showing items, validate `groupId` still exists
- If group list doesn't contain the id: show "This group is no longer accessible" and invalidate cached picker state
- Log `Total-Results` header mismatch (expected vs 0)

**Phase:** Zotero Integration phase.

### 3.7 Pagination: Zotero uses `Link` header, not offset/limit (MODERATE)

**What goes wrong:** The task description flags this as a gotcha. **But the existing code uses `start`/`limit` query params and `Total-Results` header**, not `Link` parsing (`actions.ts:212-217, 400-405`). The code is manually computing `start += batch.length` and looping until `start >= totalResults`. This is functionally correct for Zotero's API (which accepts both offset-based and link-based), but:

- Zotero may deprecate offset-based pagination
- The `Link: rel="next"` header is the documented-preferred method
- Existing code works but may break silently if Zotero changes the offset behavior

**Warning signs:**
- Pagination stops early (missed items)
- Pagination never stops (infinite loop if `Total-Results` isn't returned)

**Prevention:**
- Keep existing offset pagination (working)
- Add defensive guards: max iteration count, timeout on the total loop
- Add a comment at pagination sites flagging this for future audit
- Don't migrate to `Link`-header parsing in v7.0 — scope-out

**Phase:** Zotero Revival phase, no active action beyond documentation.

### 3.8 Zotero UI was deleted — no components exist (CRITICAL, STRUCTURAL)

**What goes wrong:** Confirmed via repo scan: **there is no `components/zotero/`, no `app/zotero/`**. Phase 88 scorched-earth deleted all Zotero UI. The backend at `convex/zotero/*` (~1433 LOC per task description) is orphaned — no React component calls `api.zotero.*`. v7.0 must rebuild the UI surface from scratch, including:
- Settings "Connect Zotero" card
- OAuth callback route handler (`app/api/zotero/callback/route.ts`)
- Zotero source tab in the paper selector
- All i18n keys (keys in `messages/en-US.json` etc. need to be added)

The audit and Phase 88 summary confirm i18n keys were deleted along with UI.

**Warning signs:**
- Cannot grep for `api.zotero.` in `components/` or `app/`
- `messages/*.json` has no `zotero` namespace

**Prevention:**
- Explicit phase scope: **rebuild full Zotero UI surface**, don't treat as "wire up existing"
- Add i18n keys to all 6 locales BEFORE component work (per v5.0 Key Decision: "i18n keys seeded before UI work")
- OAuth callback route handler is new code — Next.js 15 `async params` apply if using `[token]/route.ts` dynamic segment
- Telemetry events for Zotero connect/disconnect/fetch are new — re-add to PostHog

**Phase:** Zotero Revival phase, foundation plan.

### 3.9 `zoteroConnections` table may have dead FKs (MODERATE)

**What goes wrong:** Existing cron `cleanupDeletedUsers` (v2.4) cascades GDPR deletions to zotero connections — but it's been running correctly. Dev DB may still have orphan rows from pre-cascade days. These rows will cause `requireCurrentUserId` to succeed but `fetchItems` to decrypt-succeed with someone else's key, OR fail with a user lookup mismatch.

**Warning signs:**
- Decryption audit logs mention a `userId` not in `users` table
- Ghost Zotero connection for deleted user

**Prevention:**
- Same cleanup migration as Pitfall 3.1 handles this
- Add integrity assertion in dev: `zoteroConnections.userId` must exist in `users`

**Phase:** Zotero Revival phase, first plan (alongside 3.1).

---

## 4. Hard per-job paper limit enforcement

### 4.1 Bumping `MAX_EXTRACTION_PAPERS_PER_JOB` — existing call sites (CRITICAL)

**What goes wrong:** Confirmed via grep: **15 call sites** in production code use `MAX_EXTRACTION_PAPERS_PER_JOB` (file: `convex/lib/queryBounds.ts:22`):

- `convex/extraction/mutations.ts`: enforcement at create, papers `.take()` in cancel, papers `.take()` in enqueueAllPapers, `results.take(MAX * 10)` in finalize
- `convex/extraction/queries.ts`: 6 `.take()` sites, including `MAX * 10` for results

Bumping `MAX` from 200 to 1000 cascades:
- `finalizeJobIfDone` will `.take(10_000)` extraction results (10× the max papers × 10) — that's now 10,000 rows instead of 2,000. Convex hard caps `.take(N)` at 32,768 in a single query (likely OK) but **the query runtime grows linearly** (likely seconds for large jobs).
- `getExtractionResults` will `.take(1000)` papers and then loop 1000 × `.take(100)` for results — that's 100,000 max result rows in a single reactive query. Convex enforces 8 MB result size and 1 s query time caps; you may blow the result size limit.
- The batched `enqueueAllPapers` will issue 1000 `ctx.db.patch` + `extractionPool.enqueueAction` pairs in a single mutation. Mutation transaction size limit in Convex is ~8 MB of writes; 1000 patches × ~200 bytes each is ~200 KB (safe), but **will blow up with slower DB write throughput** (5-10 s mutation execution).

**Warning signs:**
- Convex error: "Too many bytes written" or "Query exceeded result size limit"
- Mutation timeouts
- `enqueueAllPapers` runs for 10+ seconds
- `getExtractionResults` returns partial data

**Prevention:**
- **Before bumping:** benchmark 1000-paper job end-to-end in dev
- Keep `getExtractionResults` as reactive, but **paginate it** — return first page + "load more"
- `MAX_EXTRACTION_PAPERS_PER_JOB * 10` multiplier in `finalizeJobIfDone` is load-bearing; revisit by using a direct count query via aggregate index instead of fetching all results
- `enqueueAllPapers` loop: measure, if > 5 s, break into multiple batches via `ctx.scheduler.runAfter(0, …)`
- **Separate constants** if behavior differs: `MAX_EXTRACTION_PAPERS_PER_JOB = 1000` (user-facing), `MAX_EXTRACTION_RESULTS_QUERY = 2000` (internal bound for result queries). Document the split in Key Decisions.
- Audit every call site before bumping; one unchanged site is a silent bug

**Phase:** Hard Limit phase. First task: benchmark before bumping. Add SC: "1000-paper job: enqueue completes in < 5 s, getExtractionResults returns in < 1 s."

### 4.2 UI counter diverges from server truth (SIGNIFICANT)

**What goes wrong:** Basket shows `999/1000`. User clicks "Add 5 more." Client-side check passes (because the UI counter is stale — the last add's network response hadn't settled). Server rejects at 1001. User blamed.

**Warning signs:**
- Users report "I was under 1000 but got rejected"
- Rapid-fire adds from keyboard shortcut

**Prevention:**
- Counter updates **optimistically on click** (not on server ack)
- "Add" button disables at exact cap, not "at or near" cap
- Server is authoritative, but UI shouldn't let the user even submit at cap+1
- At submit, show a diff if counts mismatch: "Client counted N, server counted M — re-select please"
- Backend error maps to a helpful toast via `toast-routing` pattern (existing in v6.0): "Too many papers. Reduce basket to 1000 or fewer."

**Phase:** Hard Limit phase.

### 4.3 Per-tier limit shape without per-tier logic (MODERATE)

**What goes wrong:** Task description says: "constant shape made per-tier-ready (no tier logic yet)." The trap: build a config like `{ free: 100, go: 500, pro: 1000 }` but then hardcode `pro` in all call sites. Six months later, per-tier enforcement is added and half the call sites still read `pro`.

**Warning signs:**
- Future audit finds hardcoded `pro` in createExtractionJob and enqueueAllPapers
- Plan downgrade test reveals the wrong limit

**Prevention:**
- Central helper `getPaperLimit(plan: PlanKey): number` — always call this, never read the map directly
- Even before per-tier is active, all call sites route through `getPaperLimit("pro")` or `getPaperLimit(user.plan ?? "free")`
- Unit test: call `getPaperLimit` for all plan keys, assert values match spec
- **Do not** create a single `MAX_PAPERS` constant that's read directly

**Phase:** Hard Limit phase. Key Decision entry.

### 4.4 Plan downgrade mid-workflow (SIGNIFICANT)

**What goes wrong:** User on pro (1000 limit) queues a 1000-paper job. Workflow starts. User downgrades to go (500 limit) 30 seconds later (e.g., cancels pro subscription with immediate effect — not standard, but possible via customer portal). The workflow continues processing. What should happen?

- **Option A (existing project rule):** "Downgrade = end of billing period" (v1.0 decision) means this race **doesn't exist** for self-serve — downgrades apply at period end, not immediately
- **Option B:** If admin-forced downgrade → credit-guard pattern (existing in v2.4) prevents billing, but does NOT stop the workflow from processing papers
- **Option C:** Workflow should check plan limits on each paper → adds DB reads to every paper, overhead

**Warning signs:**
- Customer portal immediate downgrade + active job
- Credit guard triggers mid-job
- Support tickets about "my job was cancelled"

**Prevention:**
- **Do NOT enforce per-tier limits mid-workflow** — only at `createExtractionJob` time
- Downgrade takes effect at period end per existing billing rule — no immediate downgrade path
- Document in Key Decisions: "Tier limits enforced at job creation, not mid-job. Mid-workflow downgrades don't cancel in-flight jobs."
- If a workflow outlives the user's billing period, the credit guard handles billing, not the paper limit

**Phase:** Hard Limit phase. Out-of-scope for v7.0: mid-workflow tier enforcement.

### 4.5 i18n pluralization of the counter (MINOR)

**What goes wrong:** "{count} / {limit} papers" in en-US becomes `"1000 / 1000 papers"`. In zh, ja, hi, there's no plural form distinction, so it's fine. In French, "papers" → "papiers" — but pluralization is smooth. The actual trap: **interpolating the `{limit}` into a message that uses ICU plural syntax for count**:

```json
"counter": "{count, plural, =0 {No papers} one {# paper} other {# of {limit} papers}}"
```

If a locale's plural rule doesn't support `{limit}` as a nested var, next-intl silently renders `"1000 of {limit} papers"` in that locale.

**Warning signs:**
- Some locales show literal `{limit}` in the UI
- QA audit finds broken pluralization

**Prevention:**
- Use simple interpolation, not ICU plural, for the counter: `"{count} / {limit}"` + a separate `"papers"` label
- Or: test all 6 locales in Storybook / jest snapshot with sample values
- Add counter rendering to the i18n regression test suite
- Seed all 6 locales simultaneously (existing v5.0 Key Decision)

**Phase:** Hard Limit phase UX polish + i18n audit.

### 4.6 Constant drift across multiple files (MODERATE)

**What goes wrong:** Developer bumps `MAX_EXTRACTION_PAPERS_PER_JOB` in `queryBounds.ts` to 1000 but **also hardcodes 1000** in the dialog UI as `const MAX = 1000`. Future bump to 2000 updates one site, not the other.

**Warning signs:**
- Grep for `1000` matches UI files AND queryBounds
- Bump PR touches multiple files for a number that should be central

**Prevention:**
- **Single source of truth:** `convex/lib/queryBounds.ts` export, imported by UI via `convex/_generated/api` types OR a shared constants file
- ESLint rule or grep-based lint test (per v6.0 Phase 94 pattern): forbid literal `1000` in files matching `components/extraction/**` and `app/extraction/**`
- Unit test: `expect(clientLimit).toEqual(MAX_EXTRACTION_PAPERS_PER_JOB)`

**Phase:** Hard Limit phase. SC: "grep -rn '1000' components/extraction app/extraction returns zero matches; limit only referenced via shared constant."

---

## 5. Multi-view results workbench integration with v6.0 data flow

### 5.1 Reading stale data while job still running (SIGNIFICANT)

**What goes wrong:** Existing `getExtractionResults` (`convex/extraction/queries.ts:479`) is a single reactive query. It returns whatever's in `extractionResults` at subscription time, subscribed to all updates. During a job run, the user sees papers appearing one by one. Table view, card view, split view all react.

But: if filter is "status=completed" and user watches status go pending → completed, the filtered row set churns. Paper "vanishes" from view as it changes state. Bad UX unless explicitly designed.

**Warning signs:**
- Visible paper flicker during job run
- Scroll position jumps as filtered set shrinks/grows

**Prevention:**
- Default filter during running jobs: no status filter OR explicitly "all including in-progress"
- Show in-flight status badges (pending/parsing/extracting/completed/failed) so movement is intentional
- Disable destructive filter actions during job runs ("only failed" hides the running ones)
- Split view: if selected paper transitions, update the detail panel in-place with view-transitions API

**Phase:** Results Workbench phase.

### 5.2 Evidence-quote character offsets + wrong source text (CRITICAL)

**What goes wrong:** Existing schema has `evidenceStartChar` / `evidenceEndChar` on `extractionResults`. The existing `EvidenceQuote` component (per v6.0 audit `CRASH-02` and `PARSE-07`) renders verbatim `bodyText.slice(start, end)`. But **bodyText is stored on `extractionPapers` not `extractionResults`**, and differs by `parsingSource` (PMC, arXiv, unpdf, gemini, abstract_only). If the result was saved with offsets relative to an OLD bodyText (e.g., re-parsing changed the source), the slice is garbage. Hallucinated quotes slip through because the Levenshtein check was against the old text.

Additionally: abstract-only parsing means `bodyText` is the abstract (short). Offsets 0-200 are valid. If the result was saved with `parsingSource="abstract_only"` but the UI reads `bodyText` from a newer re-parse that used PMC (longer text), the offsets are wildly off.

**Warning signs:**
- EvidenceQuote shows mid-sentence text or random characters
- `evidenceEndChar > bodyText.length`
- Mismatch between `result.parsingSource` and `paper.parsingSource`

**Prevention:**
- **Store `parsingSource` on BOTH `extractionResults` AND `extractionPapers`** (already done per schema line 493)
- **Invariant:** renderer asserts `result.parsingSource === paper.parsingSource`; if not, show a fallback "Source text has changed, quote may be stale" with the raw quote string rendered
- Ideally: store the full bodyText snapshot per result (space-expensive but bulletproof). Or store a hash of bodyText and compare
- PARSE-07 audit gap should be resolved in v7.0: confirm the UI renders `parsingSource` on result cards
- Per-paper re-parse: invalidate all results (current code doesn't support re-parse, but if added in future, must cascade-delete results)

**Phase:** Results Workbench Evidence Rendering phase. SC: "All 4 views render EvidenceQuote with parsingSource badge; mismatched parsingSource triggers fallback."

### 5.3 Reactive vs paginated: when to use what (SIGNIFICANT)

**What goes wrong:** Developer instinct: "use `usePaginatedQuery` for the workbench, pagination is expected for tables." But `usePaginatedQuery` is designed for stable, append-only data. Reactive updates during job runs don't flow through paginated queries in the same way — new papers don't auto-appear in page 1 unless pagination is reset.

Existing `getExtractionResults` returns a **full snapshot**, not paginated. Works at 200 papers. At 1000, full-snapshot payload is 5× bigger and reactive updates transport 5× more data per tick.

**Warning signs:**
- 1000-paper WS payloads on every state change
- Slow first-render
- CPU spin during active jobs

**Prevention:**
- **Hybrid:** primary query is reactive + paginated via `usePaginatedQuery`. On new data (via a separate count query), invalidate the first page.
- **OR:** reactive full-snapshot for "running" jobs (smaller because fewer results yet), switch to paginated query for "completed" jobs
- **OR:** keep reactive full but use a lighter projection — don't return `evidenceQuote`, `reasoning` in the list query; fetch details lazily per row
- Document the "small enough for reactive / big enough for paginated" threshold in ADR
- Benchmark 1000-paper completed job first-render time

**Phase:** Results Workbench Data Layer phase.

### 5.4 Server-side filtering needs new indexes (MODERATE)

**What goes wrong:** Current indexes on `extractionResults` are `by_paper_question`, `by_job`, `by_paper` (`convex/schema.ts:499-501`). If you want to filter "all results for jobX where confidence = 'low' and criticVerdict != 'supported'", there's no compound index — you'll scan the whole `by_job` partition and filter in memory. Fine at 200 results × 7 questions = 1400 rows; at 1000 × 7 = 7000, still probably fine but not ideal.

**Warning signs:**
- Slow filter queries
- Convex dashboard shows high scan counts

**Prevention:**
- Prefer **client-side filter** on the reactive subscription (see Pitfall 1.2) — free with the data you already have
- Only add indexes if server-side filter is confirmed needed
- If added: `by_job_confidence`, `by_job_criticVerdict`
- Each index costs write throughput — don't speculate

**Phase:** Results Workbench Data Layer phase. SC: "Filter operations < 50 ms on client-side against 1000 papers × 7 questions."

### 5.5 v6.0 audit gap: `parsingSource` UI rendering unconfirmed (MODERATE)

**What goes wrong:** Audit (v6.0-MILESTONE-AUDIT.md) flags PARSE-07 as partial: "Storage of parsingSource is complete. UI rendering was deferred to Phase 97. No verification that Phase 97 actually renders parsingSource on result cards." v7.0 must close this.

**Warning signs:**
- Existing `PaperResultCard` doesn't show parsing source badge
- Users can't distinguish "extracted from PMC full text" vs "abstract only"

**Prevention:**
- v7.0 adds parsing-source badge to all 4 views (table row, card, split detail, highlighted-citation view)
- Badge copy differs by source: "Full text (PMC)" (strong), "Full text (arXiv)" (strong), "PDF parsed" (medium), "Abstract only" (weak — warn user that confidence may be lower)
- Color-code via existing v5.0 color system (green/yellow/amber)
- i18n: add 5 keys (one per parsingSource value) to all 6 locales up front

**Phase:** Results Workbench Evidence Rendering phase. Closes PARSE-07.

### 5.6 CRASH-02: Bare `useQuery` in EvidenceQuote and JobMetricsPanel (MODERATE)

**What goes wrong:** v6.0 audit flags CRASH-02: `EvidenceQuote` and `JobMetricsPanel` use bare `useQuery` instead of `useProtectedQuery`. Not a security issue (server guards exist), but can cause flash during auth transitions — on sign-in/sign-out, the component briefly sees `undefined` data and renders a fallback, then flashes to real data.

v7.0 introduces multiple new components — they must all use `useProtectedQuery`, AND v7.0 should fix the two v6.0 offenders.

**Warning signs:**
- Flash of empty state during auth transitions
- Existing lint test (Phase 94 `grep-backed useQuery lint test`) doesn't cover these files

**Prevention:**
- Extend the existing lint test to cover new extraction/workbench files
- Fix CRASH-02 in a v7.0 cleanup plan
- Any new workbench component uses `useProtectedQuery`; reject PRs that don't

**Phase:** Results Workbench + v7.0 cleanup plan. SC: "grep-backed useQuery lint test passes on all new v7.0 components and closes CRASH-02."

---

## 6. TierSelector wiring

### 6.1 `tier` arg never threaded to `extractAnswers` (CRITICAL)

**What goes wrong:** TierSelector UI sets local `tier` state (`extraction-dialog.tsx:58`) and logs it to PostHog (`line 131`). It's **never passed** to `createExtractionJob` mutation (`line 125`). The mutation signature (`convex/extraction/mutations.ts:31-36`) doesn't accept a tier arg. The workflow always runs all 3 cascade tiers.

Wiring this through requires:
1. Add `tier` arg to `createExtractionJob` validator
2. Store on `extractionJobs` row (add `tier` column with default)
3. Workflow reads `job.tier`, passes to `extractAnswers` action
4. `extractAnswers` uses it to pick single-tier config vs full cascade
5. `TierSelector` value must map to a backend-understood enum (`"auto" | "cheap" | "accurate"`)

**Warning signs:**
- User picks "cheap" — still gets billed for "auto" cascade
- PostHog event shows tier choice, but costs don't match

**Prevention:**
- Integration test: `createExtractionJob` with `tier: "cheap"` → downstream `extractAnswers` invoked with cheap tier only
- Don't just pass the string blindly — validate via `v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate"))`
- Schema migration: add `tier` optional field to `extractionJobs` table
- UI: no "tier locked by admin" fallback — user always chooses

**Phase:** TierSelector Wiring phase. SC: "TierSelector value 'cheap' → extraction uses Flash Lite only, verified in test."

### 6.2 Cost preview dialog doesn't update with tier (SIGNIFICANT)

**What goes wrong:** Current cost preview (`extraction-dialog.tsx:220-238`) shows flat `paperCount × ESTIMATED_CREDITS_PER_PAPER` (1 credit/paper). Doesn't change when tier changes. User picks "accurate" (more expensive), sees same cost, is surprised at billing.

**Warning signs:**
- Cost preview identical for all tiers
- Billing surprise / support ticket

**Prevention:**
- `ESTIMATED_CREDITS_PER_PAPER` becomes `getCostPerPaper(tier)` returning per-tier estimate
- Reactive: when user changes TierSelector, cost preview updates
- `aria-live="polite"` already exists on the preview block — good
- **Estimate, not exact.** Actual cost depends on model pricing + token counts — show an estimate range
- "Cost may vary based on paper length" fine print
- Credit-guard check against max-cost estimate, not min

**Phase:** TierSelector Wiring phase.

### 6.3 Test seams: existing extraction tests mock the cascade (MODERATE)

**What goes wrong:** Per v6.0 tech debt, Phase 91 test doesn't inspect the built request payload (`EXTR-07` partial). Adding `tier` arg to the test will require updating all existing mocks that stub `extractAnswers`. If test mocks don't accept the new arg shape, tests break.

Additionally, convex-test has known runtime issues (`cancel.test.ts` fails at runtime per v6.0 audit). Adding new test paths may hit the same issue.

**Warning signs:**
- Adding tier arg to mutation breaks 10+ tests
- Test failures in unrelated files

**Prevention:**
- Before wiring: audit which tests mock `createExtractionJob` / `extractAnswers`
- Update mocks to accept optional `tier` (backward compatible)
- Don't mark tier as required in the validator — use `v.optional(v.union(…))` with default
- If convex-test issue bites, fall back to pure-function extraction of the decision logic (pattern from v2.5 ref-injection approach)

**Phase:** TierSelector Wiring phase, first plan is test inventory.

### 6.4 Tier persistence across dialog opens (MINOR)

**What goes wrong:** Dialog resets `tier` to `"auto"` on every open (`extraction-dialog.tsx:66`). User preference not remembered. Power user picks "accurate" every single time.

**Warning signs:**
- User complaint: "Why doesn't it remember my choice?"

**Prevention:**
- Persist last-selected tier in localStorage per user (not per dialog instance)
- On dialog open, restore to last value, fall back to "auto"
- Add a "Reset to default" affordance
- Do NOT persist in URL — it's noise

**Phase:** TierSelector Wiring phase, polish plan.

---

## 7. General pitfalls (DRY, i18n, a11y, telemetry, testing)

### 7.1 Scorched-earth missed references from Phase 88 (CRITICAL)

**What goes wrong:** Phase 88 deleted 93 extraction files (~15,800 LoC), 11 legacy tables, and all extraction i18n keys. Dead references may remain in:
- `components/search/` referencing deleted extraction modals
- `lib/extraction/` helpers orphaned but not deleted (non-extraction files importing them)
- i18n keys in locale files under deleted namespaces (`en-US.json` may have stray `extraction.oldKey` entries)
- Type imports from `convex/_generated/api` referencing legacy functions (will be fine post-codegen but dev might have stale imports)
- `app/search/results/` using deleted extraction-related components

**Warning signs:**
- `tsc --noEmit` errors during v7.0 work that weren't there before
- `next build` fails with "Cannot find module" for deleted modules
- ESLint `no-unused-vars` warns on imports from deleted files

**Prevention:**
- **Pre-flight audit phase:** run `tsc --noEmit && next build && npx eslint . && pnpm test` clean on v7.0 start. Any error means unresolved v6.0 debt.
- Grep for imports from deleted paths: `components/extraction/results/`, `lib/extraction/reporting/`, etc.
- Remove orphan i18n keys: script that diffs locale file keys against `useTranslations` call sites
- **Do not accept** inherited v6.0 errors as "known issues" — fix them as part of v7.0 preconditions

**Phase:** v7.0 Precondition phase / Audit v6.0 Debt Closure plan. Closes v6.0 audit gaps.

### 7.2 i18n: 6 locales, keys added across features (CRITICAL)

**What goes wrong:** v5.0 Key Decision: "i18n keys seeded before UI work." v7.0 adds hundreds of new keys (Zotero UI from scratch, selector UI, 4 view modes, basket labels, limit counters, tier preview). Missing a key in one locale = literal `extraction.basket.cta` rendered in that locale.

**Warning signs:**
- Production QA in non-English locale shows key names
- `next-intl` warnings "Missing message for key"

**Prevention:**
- **Seed all keys in all 6 locales BEFORE component work starts** per v5.0 rule
- Use a script: new keys added to `en-US.json` mirror into `en-GB.json`, `fr.json`, `zh.json`, `ja.json`, `hi.json`
- Placeholder = English translation (not empty string, not `TODO`)
- Flag for translation sprint post-v7.0 (accept English placeholders in non-en locales as a calculated debt)
- CI: fail if `messages/en-US.json` has keys not present in all other locales
- French diacritic audit (existing v2.1 check)
- Do NOT use string interpolation `"{text}"` when a key would do — eliminates missing-key detection

**Phase:** Every phase touching UI. First task: seed keys.

### 7.3 Accessibility: WCAG AAA (project rule) — data tables + baskets (SIGNIFICANT)

**What goes wrong:** WCAG AAA is the project rule. 1000-row data tables and cross-source baskets are a11y minefields:
- **Bulk selection**: shift-click range select must be keyboard accessible (Shift+Space, Shift+ArrowDown)
- **Virtual lists**: screen readers expect a complete DOM; virtualization breaks Rotor / swipe navigation
- **Sticky headers**: focus may land under the sticky header (clipped)
- **Modal basket**: focus trap when basket is open; Esc closes; return focus to trigger
- **Dynamic counters**: "`X / 1000`" updates should use `aria-live="polite"` not "assertive" (don't interrupt reader)
- **Loading states**: skeleton shimmer needs `role="status"` + `aria-label`
- **Selection state**: checkbox in data-table row needs `aria-label="Select paper Title"` not just generic
- **Tier selector**: existing `TierSelector` uses `RadioGroup` + `Label` — good, but ensure `aria-describedby` links description to radio
- **Color-only status**: v5.0 color-coded summary cards with green/yellow/red — must also have text labels or icons

**Warning signs:**
- Manual test with VoiceOver / NVDA reveals unnamed elements
- Keyboard-only navigation skips cells
- Color-blind reviewer can't distinguish status

**Prevention:**
- Every phase has an a11y acceptance criterion in SC
- Screen reader smoke test per phase (VoiceOver or NVDA, both for desktop + mobile)
- ESLint plugin `eslint-plugin-jsx-a11y` (likely already enabled) — don't disable rules
- Contrast check at 7:1 (AAA) for all new color usage — project uses OKLCH per design context
- Focus-visible styles on all interactive elements
- Virtualized list needs `aria-rowcount` / `aria-rowindex` / `aria-setsize`
- Focus management test in e2e: tab from selector → basket → submit → job list

**Phase:** Every phase. Add accessibility SC to every phase per project rule.

### 7.4 Telemetry: PostHog events may be missing (MODERATE)

**What goes wrong:** `posthog.capture("extraction_job_created", ...)` exists in the dialog. But pre-v6.0 Phase 88 deleted extraction code — other PostHog events (`extraction_paper_selected`, `extraction_view_changed`, `zotero_connected`, `zotero_fetch_items`, etc.) may have been deleted and not re-added.

The product relies on PostHog for usage data. Missing events means the v7.0 workbench is unobservable.

**Warning signs:**
- PostHog dashboard shows event drop
- Grep for `posthog.capture` returns a small set
- No Zotero events at all (pre-existing gap — UI was deleted)

**Prevention:**
- **Enumerate events v7.0 needs** in a single ADR:
  - `workbench_view_changed` (table/card/split/highlighted)
  - `basket_paper_added` (source: library/search/manual/zotero/collection)
  - `basket_paper_removed`
  - `basket_cleared`
  - `basket_submitted` (with count, sources, tier)
  - `zotero_connected`, `zotero_disconnected`, `zotero_fetch_items`, `zotero_sync_error`
  - `extraction_limit_hit` (with count attempted)
  - `tier_selected` (already in extraction_job_created properties)
- Fire these from components (not from Convex actions — Convex can't reach PostHog without an action)
- Add them to a telemetry-events registry file as a central list
- Document which events are tracked in Key Decisions

**Phase:** Every UI phase owns its events; final phase audits completeness.

### 7.5 Convex-test quirks and existing test failures (SIGNIFICANT)

**What goes wrong:** v6.0 audit flags `cancel.test.ts` (12 tests) failing at runtime due to a pre-existing convex-test pnpm issue (convex-test #50). New v7.0 tests using convex-test may hit the same issue.

Additionally: `early-return.test.ts` "uses t.run inline guards, not actual mutation calls" — meaning the test infra doesn't actually execute the mutation path. Tests pass but don't verify real behavior.

**Warning signs:**
- New tests for `createExtractionJob` tier wiring fail at runtime
- Tests "pass" but don't invoke the mutation

**Prevention:**
- **Use pure-function extraction** for testable logic (pattern from v2.5 `ref-injection`): decision logic in pure functions, Convex mutation is a thin wrapper
- For convex-test-blocked paths, use the ref-injection or DeepPartial mock factory pattern (v3.1)
- Vitest `server.integration` test that exercises the REAL mutation against a real dev deployment (per Vercel CLI skill: `vercel dev` + `npx convex dev`)
- Document the "Convex-test #50 blocker" as known in every phase that adds tests

**Phase:** Every phase adding tests. Add SC: "Test actually invokes mutation — verified by coverage report or manual trace."

### 7.6 Clerk auth isolation in E2E and convex-test (SIGNIFICANT)

**What goes wrong:** Existing rule: "each E2E test gets a fresh Clerk user" (Clerk bug #7891). Playwright E2E for billing runs `workers: 1`. Adding new v7.0 E2E tests (selector, basket, workbench navigation) increases test suite time linearly at `workers: 1`. Tempting to use shared users to parallelize — hits the bug.

Additionally: convex-test cannot test auth-gated functions (`PROJECT.md: "convex-test end-to-end auth-gated functions — blocked by convex-test issue #50"`). Testing `createExtractionJob` (auth-required) end-to-end needs Playwright, not convex-test.

**Warning signs:**
- Flaky auth in E2E with `workers > 1`
- Convex-test for auth-gated functions returns undefined

**Prevention:**
- Keep `workers: 1` for billing and extraction E2E; accept the runtime cost
- Group v7.0 E2E into few, fat tests (setup cost amortized) rather than many small ones
- For unit-level auth testing, use ref-injection / DeepPartial mocks (v3.1 pattern), not convex-test
- Document in phase RESEARCH: "convex-test blocked on auth; E2E uses Playwright with fresh Clerk user per test"

**Phase:** Every phase with E2E tests.

### 7.7 Error taxonomy: new errors must route to toasts (MODERATE)

**What goes wrong:** v6.0 Phase 94 added mutation-to-toast routing for extraction. v7.0 adds new error codes:
- `EXTRACTION_BASKET_EMPTY`
- `EXTRACTION_BASKET_OVER_LIMIT`
- `ZOTERO_NOT_CONNECTED` (existing)
- `ZOTERO_OAUTH_FAILED`
- `ZOTERO_API_ERROR` (existing)
- `OPENALEX_RESOLUTION_FAILED`
- `TIER_INVALID`

If not added to the toast-routing map, user sees raw error messages.

**Warning signs:**
- Toast shows `"EXTRACTION_BASKET_EMPTY"` literal key
- i18n missing for error messages

**Prevention:**
- Central error code list + i18n mapping + toast router
- Unit test: every error code used in a mutation has an i18n key in all 6 locales
- New errors use existing `createError` pattern (`convex/lib/errors.ts`)
- Document in Key Decisions

**Phase:** Every phase with new mutations.

### 7.8 Cascade delete: new Zotero UI doesn't cascade on user delete (MODERATE)

**What goes wrong:** Existing `cleanupDeletedUsers` cron (v2.4) cascades to `zoteroConnections` + extraction jobs. v7.0 adds NO new tables (basket is session-only, settings are in `zoteroConnections` already). So cascade should be fine. But:
- If v7.0 adds a `basketSnapshots` table (optional "save for later" basket)
- If v7.0 adds a `userViewPreferences` table (column visibility, default view)

These must be added to the cascade delete list.

**Warning signs:**
- GDPR delete leaves orphan rows in new tables

**Prevention:**
- **Prefer sessionStorage / localStorage over DB tables** for UX state (no cascade needed)
- If a new DB table is added, audit `cleanupDeletedUsers` in the same PR
- GDPR checklist in phase RESEARCH

**Phase:** Any phase adding new tables.

### 7.9 Workflow component vs tests: `workflow.start` fails in test env (MODERATE)

**What goes wrong:** `createExtractionJob` (`mutations.ts:136-140`) catches `workflow.start` failures and logs them. Comment says: "Workflow component may not be available in test environments. In production, the component is always registered." Adding tier wiring means tests need to verify the workflow was started WITH the tier. But the workflow is swallowed in tests.

**Warning signs:**
- Test can't assert `workflow.start` was called
- Adding new workflow dispatch logic is untestable

**Prevention:**
- Instead of checking workflow.start side effects, check that the job row has `tier` set to the expected value
- Mock `workflow.start` at module boundary (v2.0 pattern: `vi.mock`)
- Split workflow dispatch into a separate pure function that returns the args, then passes to `workflow.start`. Test the pure function.

**Phase:** TierSelector Wiring phase.

### 7.10 `EXTRACTION_JOB_ALREADY_ACTIVE` blocks concurrent job creation (MODERATE)

**What goes wrong:** Existing rule: only ONE extraction job active per user at a time (`createExtractionJob` lines 62-88). With the new workbench, users might:
- Submit a 1000-paper job
- Want to start a small 10-paper job while waiting

They'll get `EXTRACTION_JOB_ALREADY_ACTIVE` and get confused. Currently this is the correct (documented) behavior but worth flagging for UX.

**Warning signs:**
- Users report "I can't start a new job"
- High bounce rate on dialog close

**Prevention:**
- Don't change the rule for v7.0 (scope creep)
- Surface the blocker upfront: if an active job exists, the "Create Job" button shows "Job in progress" with a link to the active job
- Existing toast handling (`activeJobWarning`, extraction-dialog.tsx line 144) covers it — verify the UX is still clear with the bigger basket

**Phase:** Paper Selector + Results Workbench toolbar plan. UX polish, not a new feature.

### 7.11 Nuqs URL state breaks on 1000-paper filters (MODERATE)

**What goes wrong:** Existing library/search pages use nuqs for filter state. If v7.0 workbench uses nuqs for "selected paper IDs," a basket of 1000 openalexIds becomes a 20 KB URL — exceeds browser max URL length (Chrome: 2 MB, Safari: 80 KB, server: often 8 KB).

**Warning signs:**
- URL length warnings in dev tools
- Bookmarks fail
- Nginx / CDN 414 "Request-URI Too Large"

**Prevention:**
- Basket in sessionStorage (per Pitfall 2.3), NOT URL
- URL only holds: current view, current search, current filter values (short)
- Selected paper in split view = single ID, fine in URL
- Document in Key Decisions: "Multi-item state → storage; scalar state → URL."

**Phase:** Paper Selector Basket phase.

### 7.12 Credit guard + hard limit interaction (MODERATE)

**What goes wrong:** User queues 1000-paper job. Has 999 credits. `createExtractionJob` accepts (balance check passes because check is not at create time but per-paper in workpool actions). Job starts, runs out of credits on paper 1000, paper 1000 fails with credits exhausted. User sees 999/1000 successful. Not terrible, but confusing.

**Warning signs:**
- Job marked "completed" with 1 paper failed "credits exhausted"
- User support ticket about the one failed paper

**Prevention:**
- **Check balance at job creation time** against `estimatedCredits = paperCount × tierCostFactor` (existing check in dialog at line 79, but only UI-level — enforce server-side in `createExtractionJob`)
- If insufficient, reject with `INSUFFICIENT_CREDITS` toast + link to Buy Credits (existing v1.0 flow)
- Pre-submit estimate must match server estimate — do not let UI say "999 credits OK" if server says "1000 needed"
- Document: "Credits are reserved estimated at create, drawn actual at execute. Over-reserve to handle variance."

**Phase:** Hard Limit phase. Integration with existing credit system.

### 7.13 Animation performance at scale (Motion library) (MINOR)

**What goes wrong:** Project uses Motion (spring-based animations) per Design Context. Animating 1000 list items on mount = 1000 spring physics simulations. CPU spike, frame drops, battery drain.

**Warning signs:**
- Mobile Safari stutters on workbench load
- `requestAnimationFrame` log shows dropped frames

**Prevention:**
- Stagger animations via Motion's `stagger` — don't animate all 1000 at once
- Respect `prefers-reduced-motion` — disable animations entirely for users who opt out (existing project rule: "full reduced-motion support")
- Virtualized list animates only visible rows
- First render: no entrance animation (instant), only animate subsequent changes
- Motion's `LayoutGroup` performance cliff at 100+ items — avoid for workbench

**Phase:** Results Workbench Polish phase.

---

## Summary: pitfall → phase mapping

The roadmapper should structure v7.0 with these phases (names are suggestive, roadmapper decides final names). Each phase name maps to a group of pitfalls:

| Pitfall group | Suggested phase | Critical pitfalls to block release |
|---|---|---|
| **v6.0 precondition cleanup** | v7.0 Precondition Audit | 7.1 (scorched-earth refs), 3.1 (Zotero DB cleanup), 3.2 (env vars) |
| **Paper selector data layer** | Cross-Source Selector Foundation | 2.1 (dedupe), 2.2 (snapshot), 2.3 (sessionStorage), 7.11 (URL length) |
| **Paper selector UI** | Cross-Source Selector UI | 2.4 (silent cap), 2.5 (select-all semantics), 7.3 (a11y) |
| **Hard limit bump** | 1000-Paper Hard Limit | 4.1 (call-site audit), 4.2 (counter diverge), 4.6 (constant drift), 7.12 (credit interaction) |
| **Zotero revival** | Zotero Integration Revival | 3.1-3.9 (all Zotero), 7.2 (i18n seed) |
| **Workbench data layer** | Results Workbench Data Layer | 1.2 (server filter trap), 5.1 (stale data), 5.3 (reactive vs paginated), 5.4 (indexes) |
| **Workbench views** | Results Workbench Views | 1.1 (filter storm), 1.3 (virtualization), 1.5 (card scroll), 1.6 (split state), 5.2 (evidence offsets), 5.5 (parsingSource), 7.13 (animations) |
| **Workbench toolbar** | Results Workbench Toolbar | 1.4 (persistence ambiguity), 1.7 (URL param leak) |
| **TierSelector wiring** | TierSelector Backend Wire-up | 6.1-6.4 (all tier), 7.9 (workflow testability) |
| **Cross-cutting polish** | v7.0 Polish & Debt Closure | 5.6 (CRASH-02 fix), 7.4 (telemetry), 7.7 (error taxonomy), v6.0 audit gap closures (UI-01, EVAL-05, EVAL-06, PARSE-07, EXTR-07, WORK-06) |

---

## Confidence assessment

| Area | Confidence | Reason |
|---|---|---|
| Repo-specific integration (MAX constant call sites, extractionResults schema, Zotero actions, extraction-dialog wiring) | **HIGH** | Direct grep + file reads against HEAD commit |
| v6.0 audit gaps (UI-01, CRASH-02, PARSE-07, EXTR-07, WORK-06) | **HIGH** | Read from v6.0-MILESTONE-AUDIT.md |
| Zotero API behavior (rate limits, pagination) | **MEDIUM** | Existing code + training data; actual Zotero docs should be re-verified at implementation time |
| TanStack Table 1000-row performance patterns | **MEDIUM** | Generic best practices; not benchmarked in this codebase yet |
| Motion library animation cliff at 100+ items | **MEDIUM** | General knowledge; specific to Motion version in `package.json` (not read) |
| Next.js 15 async params in OAuth callback route | **HIGH** | Next.js 15 standard behavior |
| Convex transaction / query caps at 1000 papers | **MEDIUM** | Based on Convex docs + existing `.take()` patterns; would benefit from benchmark |
| WCAG AAA specifics for virtualized lists | **MEDIUM** | General a11y knowledge; no specific WCAG AAA spec text consulted |

---

## Gaps / things I couldn't verify

- **Actual Zotero rate limit numbers as of 2026-04** — existing code has no backoff, I recommend one but didn't query Zotero API docs directly
- **Current Motion library version and its stagger-group perf at 1000 items** — I didn't read `package.json`
- **Exact Convex transaction write byte caps** — quoted ~8 MB from memory, worth verifying in `@convex-dev/workflow` docs
- **Whether `@tanstack/react-table` v8 is already installed** — I didn't check; the existing codebase has `Recharts`, `nuqs`, `framer-motion`, but table library is TBD for v7.0
- **Whether PaperResultCard currently virtualizes** — from reading line 175-182 of `extraction-results-client.tsx` it does NOT; flagged in Pitfall 1.5
- **E2E test harness for workbench** — project has Playwright for billing only; whether the extraction flow has E2E at all was not verified
- **`evidenceStartChar`/`evidenceEndChar` rendering logic in `EvidenceQuote`** — I didn't read the component file; the pitfall 5.2 is based on the schema shape and the v6.0 Phase 92 summary claim of "verbatim slice"

---

## Roadmap implications (for roadmapper)

- **v7.0 SHOULD start with a precondition-audit phase** before building new features. Close v6.0 audit gaps (UI-01, EXTR-07, WORK-06, CRASH-02, PARSE-07), purge stale Zotero dev DB state, verify env vars. Without this, v7.0 builds on broken v6.0 foundations.
- **Benchmark before bumping the limit.** 200→1000 is a 5× scale jump that blows past the current query shapes. First plan of the Hard Limit phase is "benchmark 1000-paper job end-to-end in dev," NOT "bump the constant."
- **Zotero revival is a full rebuild, not a wire-up.** UI was deleted in Phase 88 — settings card, callback route, source tab in selector, i18n keys, PostHog events are all NEW code, not "re-enable existing."
- **Basket state is snapshot-based in sessionStorage.** Everything else breaks — DB tables cascade, URL explodes, localStorage stales.
- **Filter client-side for live jobs, paginate for completed.** Don't push filters to the existing reactive `getExtractionResults` — it will thrash subscriptions. Add a hybrid layer that uses reactive-full for small running jobs, paginated for large completed jobs.
- **A11y + i18n + telemetry as first-class SCs per phase, not a final polish sweep.** Project rule is WCAG AAA; 6 locales; PostHog-observed. Retrofitting costs 3× more than front-loading.
- **TierSelector wiring has a test-seam problem.** Existing mocks will break; use pure-function extraction + ref-injection pattern (v2.5) to keep the decision logic testable without touching convex-test.

---

## Files referenced (absolute paths, for roadmapper context)

- `/Users/mcharrad/Documents/Github/openalex-count/.planning/PROJECT.md` — v7.0 milestone definition + Key Decisions + Out of Scope
- `/Users/mcharrad/Documents/Github/openalex-count/.planning/MILESTONES.md` — v1.0-v6.0 shipped features + tech debt carried forward
- `/Users/mcharrad/Documents/Github/openalex-count/.planning/milestones/v6.0-MILESTONE-AUDIT.md` — v6.0 gaps to close in v7.0
- `/Users/mcharrad/Documents/Github/openalex-count/convex/schema.ts` — table shapes for `extractionJobs`, `extractionPapers`, `extractionResults`, `libraryItems`, `zoteroConnections`, `zoteroOAuthTokens`
- `/Users/mcharrad/Documents/Github/openalex-count/convex/extraction/mutations.ts` — `createExtractionJob` (auth, validation, insertion, workflow kick), `enqueueAllPapers` (batched enqueue), `cancelExtractionJob`, `saveResult` (idempotent), `handleExtractionComplete` (workpool onComplete)
- `/Users/mcharrad/Documents/Github/openalex-count/convex/extraction/queries.ts` — `getExtractionResults` (line 479), `getExtractionResultsForExport` (line 582), both use `.take(MAX_EXTRACTION_PAPERS_PER_JOB)`
- `/Users/mcharrad/Documents/Github/openalex-count/convex/lib/queryBounds.ts` — `MAX_EXTRACTION_PAPERS_PER_JOB = 200` at line 22
- `/Users/mcharrad/Documents/Github/openalex-count/convex/zotero/actions.ts` — OAuth 1.0a implementation, `fetchItems` pagination, `fetchCollections` tree flatten, `getAttachments`, `downloadFile`
- `/Users/mcharrad/Documents/Github/openalex-count/convex/zotero/mutations.ts` — `storeRequestToken`, `getRequestToken` (one-time use), `saveConnection`, `disconnect`, `cleanupExpiredOAuthTokens` cron
- `/Users/mcharrad/Documents/Github/openalex-count/components/extraction/extraction-dialog.tsx` — UI-01 break point: `papers` prop at line 33 never passed by any caller; `tier` state at line 58 never threaded to mutation at line 125
- `/Users/mcharrad/Documents/Github/openalex-count/components/extraction/tier-selector.tsx` — `ModelTier = "auto" | "cheap" | "accurate"` type (line 12); RadioGroup implementation
- `/Users/mcharrad/Documents/Github/openalex-count/app/extraction/[jobId]/extraction-results-client.tsx` — current workbench entry point; line 175-182 is the un-virtualized `data.papers.map(...)` that v7.0 must replace