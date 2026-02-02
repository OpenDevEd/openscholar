# PDF Citation Renderer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right-side PDF drawer that jumps to a cited page and highlights the exact cited text for extraction answers.

**Architecture:** Parse top citation from `extractionResults.contextChunks`, fetch a usable PDF URL (Convex storage first, `pdfUrl` fallback), and render the PDF in a right-side drawer using react-pdf with a custom highlight overlay that maps citation char ranges to PDF.js text items.

**Tech Stack:** Next.js App Router, React 19, Convex, Tailwind, Radix Dialog, react-pdf (pdf.js)

---

### Task 1: Add test harness for new utilities

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Step 1: Write the failing test**

Create `tests/citations.test.ts` with a placeholder failing assertion.

```ts
import { describe, it, expect } from "vitest";

describe("citations", () => {
  it("placeholder", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL (placeholder assertion)

**Step 3: Write minimal implementation**

Add `vitest` to devDependencies and a `test` script in `package.json`, plus a minimal `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS (if you change the placeholder assertion after verifying the harness)

**Step 5: Commit**

```bash
git add package.json vitest.config.ts tests/citations.test.ts
git commit -m "test: add vitest harness"
```

---

### Task 2: Add citation parsing utility + tests

**Files:**
- Create: `lib/extraction/citations.ts`
- Modify: `tests/citations.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseContextChunk } from "@/lib/extraction/citations";

describe("parseContextChunk", () => {
  it("parses page and char range from context chunk", () => {
    const chunk = "[Page 3, chars 120-420]\nSome cited text";
    expect(parseContextChunk(chunk)).toEqual({
      page: 3,
      charRange: [120, 420],
      text: "Some cited text",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL (function missing)

**Step 3: Write minimal implementation**

Implement `parseContextChunk` to extract `page`, `charRange`, and trailing text via regex, and return `null` when parsing fails.

```ts
export function parseContextChunk(chunk: string): {
  page: number;
  charRange: [number, number];
  text: string;
} | null {
  const match = chunk.match(/\[Page (\d+), chars (\d+)-(\d+)\]\s*([\s\S]*)/i);
  if (!match) return null;
  return {
    page: Number(match[1]),
    charRange: [Number(match[2]), Number(match[3])],
    text: match[4].trim(),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS

**Step 5: Commit**

```bash
git add lib/extraction/citations.ts tests/citations.test.ts
git commit -m "feat: add citation parsing helper"
```

---

### Task 3: Add Convex query to resolve PDF URL

**Files:**
- Modify: `convex/extraction/queries.ts`

**Step 1: Write the failing test**

Create a short script `scripts/verify-pdf-url.mjs` that calls the new query for a known paperId and asserts a non-null URL. (No existing test harness for Convex query; keep this as a manual check.)

**Step 2: Run test to verify it fails**

Run: `npx convex run extraction.queries.getPaperPdfUrl '{"paperId":"<paperId>"}'`

Expected: FAIL (function not found)

**Step 3: Write minimal implementation**

Add `getPaperPdfUrl` (public query) that:
- Checks current user
- Loads paper + job, verifies ownership
- Returns `ctx.storage.getUrl(paper.storageId)` if present, else `paper.pdfUrl`, else `null`

**Step 4: Run test to verify it passes**

Run: `npx convex run extraction.queries.getPaperPdfUrl '{"paperId":"<paperId>"}'`

Expected: URL or null (no error)

**Step 5: Commit**

```bash
git add convex/extraction/queries.ts
git commit -m "feat: add pdf url resolver query"
```

---

### Task 4: Add highlight mapping utility + tests

**Files:**
- Create: `lib/extraction/pdf-highlight.ts`
- Modify: `tests/citations.test.ts`

**Step 1: Write the failing test**

Add a unit test that feeds fake text items with known `str` lengths and verifies range intersection logic (not viewport math yet):

```ts
import { getTextItemRanges } from "@/lib/extraction/pdf-highlight";

it("creates char ranges for text items", () => {
  const ranges = getTextItemRanges([
    { str: "hello " },
    { str: "world" },
  ]);
  expect(ranges).toEqual([
    { index: 0, start: 0, end: 6 },
    { index: 1, start: 6, end: 11 },
  ]);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL (function missing)

**Step 3: Write minimal implementation**

Implement:
- `getTextItemRanges(items)` returns cumulative `[start, end)` for each item
- `findIntersectingItems(ranges, charRange)` returns indices that overlap

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS

**Step 5: Commit**

```bash
git add lib/extraction/pdf-highlight.ts tests/citations.test.ts
git commit -m "feat: add pdf highlight range helpers"
```

---

### Task 5: Build PdfViewer component with exact highlights

**Files:**
- Create: `components/extraction/pdf-viewer.tsx`
- Modify: `package.json` (add `react-pdf` dependency)

**Step 1: Write the failing test**

Manual verification (no UI test harness): add a temporary render in a sandbox page to ensure the viewer loads.

**Step 2: Run test to verify it fails**

Run: open the sandbox page and expect missing module errors before adding `react-pdf`.

**Step 3: Write minimal implementation**

Implement `PdfViewer`:
- Configure pdf.js worker using `pdfjs.GlobalWorkerOptions.workerSrc` per react-pdf docs
- Render `<Document file={pdfUrl}>` and `<Page pageNumber={pageNumber} renderTextLayer />`
- On page load success, call `page.getTextContent()` and build highlight rectangles using `viewport` + text items
- Render absolute highlight overlay divs for intersecting text items
- Scroll the page container into view on `pageNumber` change

Import react-pdf CSS for text/annotation layers in the component:

```ts
import "react-pdf/dist/esm/Page/TextLayer.css";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
```

**Step 4: Run test to verify it passes**

Manual: open the sandbox and confirm PDF loads and highlight appears for a known citation.

**Step 5: Commit**

```bash
git add components/extraction/pdf-viewer.tsx package.json
git commit -m "feat: add pdf viewer with highlight overlay"
```

---

### Task 6: Build right-side drawer and wire “Cite” action

**Files:**
- Create: `components/extraction/pdf-citation-drawer.tsx`
- Modify: `components/extraction/results-table.tsx`

**Step 1: Write the failing test**

Manual: click “Cite” in results table; expect no drawer before implementation.

**Step 2: Run test to verify it fails**

Manual: confirm there is no drawer and no PDF view.

**Step 3: Write minimal implementation**

Implement drawer:
- Use `Dialog` to render a right-side panel (fixed, full height)
- Use `useQuery(api.extraction.queries.getPaperPdfUrl)` to resolve URL
- Parse top citation from `result.contextChunks?.[0]`
- Render citation text + `<PdfViewer>` with `pageNumber` and `charRange`

Wire “Cite” button:
- Add a small button in `ResultCell` when `result.contextChunks?.length`
- Store drawer state in `ResultsTable` (`selectedPaper`, `selectedCitation`, `open`)
- Open drawer with top citation only (per requirement)

**Step 4: Run test to verify it passes**

Manual: click “Cite” and verify drawer opens, PDF loads, and highlight is visible.

**Step 5: Commit**

```bash
git add components/extraction/pdf-citation-drawer.tsx components/extraction/results-table.tsx
git commit -m "feat: add citation drawer and cite action"
```

---

### Task 7: Final manual verification

**Files:** none

**Step 1: Manual checks**

- Run a job with PDFs and ensure at least one answer has `contextChunks`
- Click “Cite” → drawer opens → page jumps → highlight shows
- Open a paper without PDF → drawer shows “PDF unavailable”
- Check that “Abstract/Abstract Only/No Content” badges still look correct

**Step 2: Commit**

Only if requested.

---

**Notes**
- If you hit PDF rendering issues, check React-PDF worker config and, if needed, set `swcMinify: false` in `next.config.js` per docs.
- Keep highlight colors in theme tokens (e.g., `bg-primary/20 border-primary/30`) to avoid one-off colors.
