# SEO and Metadata Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement comprehensive, best-practice SEO and metadata across the entire Next.js application, including dynamic pages, structured data (JSON-LD), sitemaps, and robots.txt.

**Architecture:** Utilize Next.js App Router's `Metadata` API for head management. Refactor necessary Client Components to Server Components to support server-side metadata generation. Implement `sitemap.ts` and `robots.ts` for crawler guidance.

**Tech Stack:** Next.js (App Router), TypeScript, React, JSON-LD.

---

### Task 1: Refactor History Page for SEO

**Files:**
- Create: `app/history/history-page-client.tsx`
- Modify: `app/history/page.tsx`

**Step 1: Create Client Component**
Move the client-side logic (Suspense, fallback, Command Center) from `app/history/page.tsx` to `app/history/history-page-client.tsx`.

**Step 2: Update Server Page**
Update `app/history/page.tsx` to:
1.  Remove `"use client"`.
2.  Import `Metadata` from `next`.
3.  Export `metadata` object (Title: "Search History | OpenScholar", Description: "View and manage your past search queries.").
4.  Import and render `HistoryPageClient`.

### Task 2: Enhance Root Layout Metadata

**Files:**
- Modify: `app/layout.tsx`

**Step 1: Add MetadataBase**
Add `metadataBase: new URL("https://openscholar.ai"),` to the `metadata` object.

**Step 2: Add OpenGraph**
Add `openGraph` object:
- title: "OpenScholar - Academic Paper Search"
- description: (Existing description)
- url: "https://openscholar.ai"
- siteName: "OpenScholar"
- locale: "en_US"
- type: "website"

**Step 3: Add Twitter Card**
Add `twitter` object:
- card: "summary_large_image"
- title: "OpenScholar - Academic Paper Search"
- description: (Existing description)
- creator: "@OpenScholarAI" (Placeholder, verify if exists)

**Step 4: Add Robots & Alternates**
- Add `robots: { index: true, follow: true }`.
- Add `alternates: { canonical: "/" }`.

### Task 3: Enhance Home Page SEO

**Files:**
- Modify: `app/page.tsx`

**Step 1: Add Metadata**
Export `metadata` with:
- title: "OpenScholar - Academic Paper Search" (Explicitly set to override/merge correctly)
- alternates: { canonical: "https://openscholar.ai" }

**Step 2: Add JSON-LD**
Add a script tag with `SearchAction` JSON-LD data to the page component.

### Task 4: Dynamic Results Page SEO

**Files:**
- Modify: `app/results/[searchId]/page.tsx`

**Step 1: Implement generateMetadata**
Add `generateMetadata` function:
- Return title: "Search Results | OpenScholar"
- (Optional) If `searchId` can be resolved to a query on the server, use it. Otherwise, static title.
- Add `robots: { index: false }` (Usually search results shouldn't be indexed to prevent spam/duplicate content, but user said "amazing for SEO". Often internal search results are `noindex`. I will verify user intent or default to `noindex` for best practice, OR `index` if they really want it. I'll stick to "Search Results" title and `index: false` as best practice, or `index: true` if they want deep linking. I'll default to `index: false` for search results to save crawl budget, but maybe the user wants them indexed. I'll add a comment in the code.)
*Correction:* I'll assume they want the pages to look good when shared, so I'll add OpenGraph tags even if `noindex`.

### Task 5: Standardize Other Pages

**Files:**
- Modify: `app/bookmarks/page.tsx`
- Modify: `app/ai-enhancement/page.tsx`

**Step 1: Update Titles**
Ensure titles use the format `"${PageName} | OpenScholar"`.
- Bookmarks: "Bookmarks | OpenScholar"
- AI Enhancement: "AI Enhancement | OpenScholar"

### Task 6: Sitemap and Robots

**Files:**
- Create: `app/sitemap.ts`
- Create: `app/robots.ts`

**Step 1: Create sitemap.ts**
Export default function `sitemap()` returning:
- `/`
- `/history`
- `/bookmarks`
- `/ai-enhancement`
With current date as `lastModified`.

**Step 2: Create robots.ts**
Export default function `robots()`:
- allow: `/`
- disallow: [`/api/`, `/results/`] (If we decided search results shouldn't be crawled)
- sitemap: `https://openscholar.ai/sitemap.xml`
