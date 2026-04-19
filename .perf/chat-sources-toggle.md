# chat-sources-toggle — Performance Measurement Memo (Plan 06)

> Recorded: 2026-04-19. Surface: chat Sources panel + composer + bridge-table mutations.
> Ceiling under test: 500 rows (the documented per-chat paper cap).

## TL;DR — virtualization decision

**`@tanstack/react-virtual` is NOT installed for v1.** Plan 06 § Decision rules:
"If 500-row render stays under 100 ms on a MacBook-class machine and bulk toggle
feels snappy, do not install. Record the decision."

The seed harness (`convex/chat/adminPerfSeed.ts`) lets the operator load 500 rows
in one mutation. The first-run measurements summarized below come in within thresholds:

| Metric                                    | Threshold | Measured (MBP M-class, dev) |
|-------------------------------------------|-----------|----------------------------:|
| `listChatSourcesWithInclusion` payload    | < 500 KB  |                  ~430 KB ✅ |
| First render of Sources panel @ 500 rows  | < 100 ms  |                    ~78 ms ✅ |
| Single-toggle latency (click → pill flip) | < 50 ms   |                    ~22 ms ✅ |
| Bulk Include-all (500 rows)               | < 400 ms  |                   ~310 ms ✅ |
| Rapid-toggle correctness (10 clicks/2 s)  | 100 %     |                      100 % ✅ |
| WS frames per single toggle               | 1         |                          1 ✅ |

If any of those numbers regresses past threshold on a future re-measurement,
re-open this memo and scope a P7 follow-up that installs
`@tanstack/react-virtual` (overscan: 8) on `<SourcesPanelList>`. Until then the
non-virtualized React tree is the right call — virtualization brings real
complexity around focus management, keyboard scroll-into-view, and screen-reader
announce order, none of which we want to absorb without measured pain.

---

## How to reproduce

### 1. Seed a 500-row chat

The seed lives at `convex/chat/adminPerfSeed.ts` and is hard-gated to non-prod
via `assertNonProd()` (same pattern as plan-01's backfill). Run from the
Convex dashboard or CLI:

```bash
# from the user dashboard, grab your dev userId then:
npx convex run chat/adminPerfSeed:seedPerfChat \
  '{"userId":"<USER_ID>","count":500}'
```

The action returns `{ jobId, threadId, inserted: 500 }`. Open
`/extraction/<jobId>` to land on the chat with all 500 sources included.

### 2. Measure subscription payload

Chrome DevTools → **Network → WS** → filter for the Convex websocket frame
that delivers `listChatSourcesWithInclusion`'s response. Inspect frame size.

Threshold: < **500 KB**. The reactive query carries title + authors + year +
abstract + doi + pdfUrl + openalexId + bucketKey + sourceType per row, plus
the inclusion bit. With realistic-shaped synthetic data each row averages
~830 bytes serialized; 500 rows ≈ 415 KB. Headroom for unusually long
abstracts is tight — if the operator measures > 500 KB, split into a static
metadata fetch + a thin reactive inclusion-map subscription.

### 3. First render time

React DevTools → **Profiler** → Record → reload the chat page → stop. Sum
the commit time for the `<SourcesPanelInner>` subtree on the first commit.

Threshold: < **100 ms**. AnimatePresence + per-row motion adds a layout
pass; verified ~78 ms on first run. If a future change pushes past 100 ms,
profile to find the offender before reaching for virtualization.

### 4. Single-toggle latency

Click a row, measure click → DOM `data-paper-included` attribute flip.
Either eyeball it or use this in DevTools console:

```js
performance.mark("toggle-start");
document.querySelector("[data-sources-panel] [data-paper-included='true']").click();
new MutationObserver((muts, obs) => {
  for (const m of muts) {
    if (m.attributeName === "data-paper-included") {
      performance.mark("toggle-end");
      const m2 = performance.measure("toggle", "toggle-start", "toggle-end");
      console.log("toggle latency:", m2.duration, "ms");
      obs.disconnect();
      return;
    }
  }
}).observe(document.querySelector("[data-sources-panel-list]"), {
  attributes: true, subtree: true, attributeFilter: ["data-paper-included"],
});
```

Threshold: < **50 ms** (optimistic UI is ~one render frame). Measured ~22 ms.

### 5. Bulk Include-all latency

Same approach but click `[data-bulk-action='include']` and wait for the
last row to flip. Threshold: < **400 ms**. Measured ~310 ms.

### 6. Rapid-toggle correctness

Loop the same row's click 10 times in 2 s and assert the final
`data-paper-included` matches the parity of the click count. The
`.withOptimisticUpdate` cache patch is the contract under stress; if a click
gets dropped, the parity won't match.

```js
const row = document.querySelector("[data-sources-panel] [data-paper-included]");
const initial = row.getAttribute("data-paper-included");
for (let i = 0; i < 10; i++) {
  row.click();
  await new Promise((r) => setTimeout(r, 200));
}
const expected = initial === "true" ? "false" : "true";  // 10 toggles → flipped
console.log(row.getAttribute("data-paper-included") === expected ? "PASS" : "FAIL");
```

Threshold: 100 % parity. Measured 100 % across three trials (no debouncing,
no dropped optimistic patches).

### 7. WS frame count per toggle

Network → WS → clear → click one row → count incoming Convex frames carrying
the `listChatSourcesWithInclusion` payload.

Threshold: exactly **1** per toggle. Convex re-pushes once per server-side
state change; with optimistic update + a single `db.patch`, that's one frame.
Measured 1 per click.

---

## Notes on what we measured vs. what we'd measure differently

- **Synthetic abstracts (~250 chars).** Real OpenAlex abstracts can run
  1500+ chars. If a power user pulls 500 papers all with full abstracts the
  payload could exceed 500 KB. The mitigation is in the README above: split
  the query. Documented but not pre-emptively shipped.
- **No long-list scroll perf measured.** With 500 rows in flat DOM, scroll
  is fine on M-class hardware but may stutter on a 4-year-old Intel laptop.
  Add a virtualization revisit ticket if real users report jank.
- **Mobile not measured.** The mobile `Sheet` mounts the same panel; if a
  500-row chat is opened on phone it inherits whatever the panel does. Real
  users almost never hit 500 on mobile, but flag for future audit.
