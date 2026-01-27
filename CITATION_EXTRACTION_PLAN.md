# Citation-Aware Extraction System Implementation Plan

## Overview

Transform the extraction system to track and display **exact source locations** (character ranges) for every extracted value - whether from the abstract or PDF full text.

## Current State (After Data Clearing)

| Table | Status |
|-------|--------|
| `extractionResults` | Cleared (2 rows deleted) |
| `indexingJobs` | Cleared (1 row deleted) |
| `pdfDownloadJobs` | Cleared (13 rows deleted) |
| `documents` (RAG fields) | Reset (21 documents reset) |

## Target User Experience

### Before (Current)
```
| Document | Sample Size | Study Type |
|----------|-------------|------------|
| Paper A  | 150         | RCT        |
```

### After (With Citations)
```
| Document | Sample Size                              | Study Type                    |
|----------|------------------------------------------|-------------------------------|
| Paper A  | 150 [2 sources]                          | RCT [1 source]                |
|          | > Abstract [145-312]: "enrolled 150..."  | > Page 3 [1204-1456]: "RCT..." |
|          | > Page 3 [5201-5400]: "150 patients..."  |                               |
```

---

## Implementation Phases

### Phase 1: Schema Updates
**Files:** `convex/schema.ts`

Add `sources` field to `extractionResults`:
```typescript
extractionResults: defineTable({
  // ... existing fields ...
  sources: v.optional(v.array(v.object({
    quote: v.string(),                    // Exact text snippet (max ~200 chars)
    sourceType: v.union(v.literal("abstract"), v.literal("pdf")),
    pageNumber: v.optional(v.number()),   // Only for PDF sources
    startChar: v.number(),                // Character start in source
    endChar: v.number(),                  // Character end in source
  }))),
})
```

Add `pdfPages` field to `documents` for page boundary tracking:
```typescript
documents: defineTable({
  // ... existing fields ...
  pdfPages: v.optional(v.array(v.object({
    pageNumber: v.number(),
    startChar: v.number(),
    endChar: v.number(),
  }))),
})
```

---

### Phase 2: Page-Aware PDF Text Extraction
**Files:** `convex/rag/actions.ts`

#### Current Implementation
```typescript
// Line 584
const result = await extractText(bufferCopy, { mergePages: true });
return result.text;  // Single string, no page info
```

#### New Implementation
```typescript
interface PageExtraction {
  text: string;
  pageNumber: number;
  startChar: number;
  endChar: number;
}

interface ExtractedPdf {
  fullText: string;
  pages: PageExtraction[];
}

async function extractTextWithPages(pdfData: ArrayBuffer): Promise<ExtractedPdf> {
  const result = await extractText(pdfData, { mergePages: false });
  
  const pages: PageExtraction[] = [];
  let currentChar = 0;
  
  for (let i = 0; i < result.pages.length; i++) {
    const pageText = result.pages[i].text;
    pages.push({
      pageNumber: i + 1,
      text: pageText,
      startChar: currentChar,
      endChar: currentChar + pageText.length,
    });
    currentChar += pageText.length + 1; // +1 for newline between pages
  }
  
  const fullText = result.pages.map(p => p.text).join('\n');
  return { fullText, pages };
}
```

#### Store Page Boundaries
```typescript
// In processPdfBuffer:
await ctx.runMutation(internal.rag.mutations.savePdfWithPages, {
  documentId: doc._id,
  pdfStorageId: storageId,
  fullText,
  pdfPages: pages.map(p => ({
    pageNumber: p.pageNumber,
    startChar: p.startChar,
    endChar: p.endChar,
  })),
});
```

---

### Phase 3: Position-Tracked Chunking
**Files:** `convex/rag/index.ts`

#### New Chunk Type
```typescript
export interface ChunkWithPosition {
  text: string;
  sourceType: 'abstract' | 'pdf';
  pageNumber: number | null;      // null for abstract
  startChar: number;              // Start in original source
  endChar: number;                // End in original source
  chunkIndex: number;
}
```

#### New Chunking Function
```typescript
export function chunkTextWithPositions(
  text: string,
  sourceType: 'abstract' | 'pdf',
  pdfPages?: { pageNumber: number; startChar: number; endChar: number }[],
  options: { maxChunkSize?: number; overlap?: number } = {}
): ChunkWithPosition[] {
  const { maxChunkSize = 1500, overlap = 200 } = options;
  const chunks: ChunkWithPosition[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChunkSize, text.length);
    
    // Try to break at sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + 100) {
        end = breakPoint + 1;
      }
    }

    const chunkText = text.slice(start, end).trim();
    if (chunkText.length >= 100) {
      // Determine page number for PDF chunks
      let pageNumber: number | null = null;
      if (sourceType === 'pdf' && pdfPages) {
        const page = pdfPages.find(p => start >= p.startChar && start < p.endChar);
        pageNumber = page?.pageNumber ?? null;
      }

      chunks.push({
        text: chunkText,
        sourceType,
        pageNumber,
        startChar: start,
        endChar: end,
        chunkIndex,
      });
      chunkIndex++;
    }

    start = end - overlap;
    if (start <= 0) start = end;
  }

  return chunks;
}
```

#### Update prepareDocumentContent
```typescript
export function prepareDocumentContentWithPositions(doc: {
  title: string;
  abstract?: string;
  fullText?: string;
  pdfPages?: { pageNumber: number; startChar: number; endChar: number }[];
}): {
  abstractChunks: ChunkWithPosition[];
  pdfChunks: ChunkWithPosition[];
} {
  const abstractChunks = doc.abstract 
    ? chunkTextWithPositions(doc.abstract, 'abstract')
    : [];
  
  const pdfChunks = doc.fullText
    ? chunkTextWithPositions(doc.fullText, 'pdf', doc.pdfPages)
    : [];

  return { abstractChunks, pdfChunks };
}
```

---

### Phase 4: Enhanced RAG Indexing
**Files:** `convex/rag/actions.ts`

#### Store Position Metadata
```typescript
// In indexDocumentContent:
for (const chunk of [...abstractChunks, ...pdfChunks]) {
  await rag.add(ctx, {
    namespace,
    key: `${documentKey}:${chunk.chunkIndex}`,
    text: chunk.text,
    title: doc.title,
    metadata: {
      documentId: doc.documentId,
      analysisId: doc.analysisId,
      title: doc.title,
      contentType: chunk.sourceType,
      sourceType: chunk.sourceType,
      pageNumber: chunk.pageNumber,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
      chunkIndex: chunk.chunkIndex,
    },
    filterValues: {
      analysisId: doc.analysisId,
      documentId: doc.documentId,
      contentType: chunk.sourceType,
    },
  });
}
```

---

### Phase 5: Enhanced Search Results
**Files:** `convex/rag/actions.ts`

#### Update searchContext Return Type
```typescript
export const searchContext = action({
  args: {
    analysisId: v.id("analyses"),
    query: v.string(),
    limit: v.optional(v.number()),
    documentId: v.optional(v.id("documents")),
  },
  returns: v.object({
    text: v.string(),
    chunks: v.array(v.object({
      text: v.string(),
      score: v.number(),
      documentId: v.string(),
      title: v.string(),
      sourceType: v.union(v.literal("abstract"), v.literal("pdf")),
      pageNumber: v.optional(v.number()),
      startChar: v.number(),
      endChar: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    // ... existing search logic ...
    
    const chunks = results.map((r: any) => {
      const entry = entries.find((e: any) => e.entryId === r.entryId);
      const metadata = entry?.metadata || {};
      
      return {
        text: r.content?.map((c: any) => c.text).join('\n') || '',
        score: r.score,
        documentId: metadata.documentId || '',
        title: metadata.title || '',
        sourceType: metadata.sourceType || 'abstract',
        pageNumber: metadata.pageNumber,
        startChar: metadata.startChar || 0,
        endChar: metadata.endChar || 0,
      };
    });

    return { text, chunks };
  },
});
```

---

### Phase 6: Citation-Aware LLM Extraction
**Files:** `lib/ai/core/prompts.ts`, `convex/extraction/actions.ts`

#### Updated System Prompt
```typescript
const systemPrompt = `You are an expert at extracting structured data from academic papers.

CRITICAL: You must cite your sources with EXACT quotes.

Return JSON:
{
  "value": <extracted value>,
  "confidence": <0-1>,
  "reasoning": "<brief explanation>",
  "sources": [
    {
      "quote": "<EXACT text from content, max 200 chars>",
      "location": "<copy the [SOURCE: ...] marker exactly>"
    }
  ]
}

Rules:
1. Include 1-3 source quotes that DIRECTLY support your answer
2. Quotes must be VERBATIM - do not paraphrase
3. Copy the [SOURCE: ...] marker exactly as shown
4. If information not found, return value=null with empty sources
5. ALL sources that support your answer should be included`;
```

#### Updated User Prompt with Source Markers
```typescript
function buildUserPromptWithSources(
  input: ExtractionInput,
  ragChunks: ChunkWithPosition[]
): string {
  let prompt = `Extract from this academic paper:\n\nTITLE: "${input.title}"\n\n`;

  if (input.abstract) {
    // For abstract, we'll track position within the abstract
    prompt += `[SOURCE: abstract, chars 0-${input.abstract.length}]\n`;
    prompt += `ABSTRACT: "${input.abstract}"\n\n`;
  }

  if (ragChunks.length > 0) {
    prompt += `RELEVANT EXCERPTS:\n\n`;
    for (const chunk of ragChunks) {
      if (chunk.sourceType === 'pdf') {
        prompt += `[SOURCE: pdf, page ${chunk.pageNumber}, chars ${chunk.startChar}-${chunk.endChar}]\n`;
      } else {
        prompt += `[SOURCE: abstract, chars ${chunk.startChar}-${chunk.endChar}]\n`;
      }
      prompt += `"${chunk.text}"\n\n`;
    }
  }

  prompt += `QUESTION: "${input.question}"\n`;
  prompt += `EXPECTED TYPE: ${input.type}\n`;

  return prompt;
}
```

#### Parse LLM Response Sources
```typescript
function parseSourceLocation(location: string): {
  sourceType: 'abstract' | 'pdf';
  pageNumber: number | null;
  startChar: number;
  endChar: number;
} | null {
  // Match: "abstract, chars 0-450" or "pdf, page 3, chars 5201-6800"
  const abstractMatch = location.match(/abstract,?\s*chars?\s*(\d+)-(\d+)/i);
  if (abstractMatch) {
    return {
      sourceType: 'abstract',
      pageNumber: null,
      startChar: parseInt(abstractMatch[1]),
      endChar: parseInt(abstractMatch[2]),
    };
  }

  const pdfMatch = location.match(/pdf,?\s*page\s*(\d+),?\s*chars?\s*(\d+)-(\d+)/i);
  if (pdfMatch) {
    return {
      sourceType: 'pdf',
      pageNumber: parseInt(pdfMatch[1]),
      startChar: parseInt(pdfMatch[2]),
      endChar: parseInt(pdfMatch[3]),
    };
  }

  return null;
}
```

---

### Phase 7: Store Sources in Results
**Files:** `convex/extraction/results.ts`

#### Update saveResult Mutation
```typescript
export const saveResult = internalMutation({
  args: {
    documentId: v.id("documents"),
    analysisId: v.id("analyses"),
    questionId: v.string(),
    value: v.union(v.string(), v.number(), v.boolean(), v.null()),
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    sources: v.optional(v.array(v.object({
      quote: v.string(),
      sourceType: v.union(v.literal("abstract"), v.literal("pdf")),
      pageNumber: v.optional(v.number()),
      startChar: v.number(),
      endChar: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    // Check for existing result
    const existing = await ctx.db
      .query("extractionResults")
      .withIndex("by_analysis_question", q => 
        q.eq("analysisId", args.analysisId).eq("questionId", args.questionId)
      )
      .filter(q => q.eq(q.field("documentId"), args.documentId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        confidence: args.confidence,
        reasoning: args.reasoning,
        sources: args.sources,
        status: "completed",
      });
    } else {
      await ctx.db.insert("extractionResults", {
        ...args,
        status: "completed",
        createdAt: Date.now(),
      });
    }
  },
});
```

---

### Phase 8: UI Citation Display
**Files:** `components/extraction/results-table.tsx`

#### Add Citation Popover
```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileText, BookOpen } from "lucide-react";

function SourceBadge({ sources }: { sources: Source[] }) {
  if (!sources?.length) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 ml-1">
          <FileText className="h-3 w-3 mr-1" />
          {sources.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-80 overflow-y-auto">
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Sources</h4>
          {sources.map((source, i) => (
            <div key={i} className="text-sm space-y-1">
              <div className="flex items-center gap-1 font-medium text-muted-foreground">
                {source.sourceType === 'pdf' ? (
                  <>
                    <FileText className="h-3 w-3" />
                    Page {source.pageNumber} [{source.startChar}-{source.endChar}]
                  </>
                ) : (
                  <>
                    <BookOpen className="h-3 w-3" />
                    Abstract [{source.startChar}-{source.endChar}]
                  </>
                )}
              </div>
              <blockquote className="border-l-2 border-primary/50 pl-3 italic text-xs">
                "{source.quote.length > 150 
                  ? source.quote.slice(0, 150) + '...' 
                  : source.quote}"
              </blockquote>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

#### Update Cell Renderer
```tsx
function ExtractionCell({ result }: { result: ExtractionResult }) {
  return (
    <div className="flex items-center">
      <span>{formatValue(result.value)}</span>
      <SourceBadge sources={result.sources} />
    </div>
  );
}
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `convex/schema.ts` | Add `sources` to extractionResults, `pdfPages` to documents |
| `convex/rag/actions.ts` | Page-aware extraction, enhanced search, store position metadata |
| `convex/rag/index.ts` | Position-tracked chunking functions |
| `convex/rag/mutations.ts` | New mutation to save PDF with pages |
| `convex/extraction/actions.ts` | Pass source markers to LLM, parse citations |
| `convex/extraction/results.ts` | Save sources with results, update queries |
| `lib/ai/core/prompts.ts` | Citation-aware prompts with source markers |
| `lib/ai/core/schemas.ts` | Add sources schema |
| `lib/ai/core/batch.ts` | Parse sources from LLM response |
| `components/extraction/results-table.tsx` | Display citations with popover |

---

## Implementation Order

| Step | Phase | Description | Est. Time |
|------|-------|-------------|-----------|
| 1 | Schema | Add `sources` and `pdfPages` fields | 30 min |
| 2 | PDF Extraction | Page-aware text extraction | 1.5 hrs |
| 3 | Chunking | Position-tracked chunking | 1.5 hrs |
| 4 | RAG Indexing | Store position metadata | 1 hr |
| 5 | Search | Return position metadata | 30 min |
| 6 | LLM Prompts | Citation-aware prompts | 1.5 hrs |
| 7 | Response Parsing | Parse sources from LLM | 1 hr |
| 8 | Results Storage | Save sources | 30 min |
| 9 | UI | Display citations | 1.5 hrs |
| 10 | Testing | End-to-end verification | 1 hr |

**Total: ~10 hours**

---

## Testing Checklist

- [ ] PDF extraction returns page boundaries
- [ ] Chunks have correct startChar/endChar
- [ ] RAG search returns position metadata
- [ ] LLM prompt includes source markers
- [ ] LLM response includes source citations
- [ ] Sources stored in extractionResults
- [ ] UI displays sources with popover
- [ ] Abstract sources show [Abstract X-Y]
- [ ] PDF sources show [Page N, chars X-Y]
- [ ] Quote truncation works correctly
- [ ] Multiple sources display correctly

---

## Notes

1. **Character ranges are relative to source**: For abstract, ranges are within the abstract text. For PDF, ranges are within the full extracted text.

2. **Page numbers are approximate**: Due to PDF rendering differences, page detection uses the page boundary from extraction, not visual layout.

3. **Quote matching**: LLM may slightly paraphrase despite instructions. UI should still display the quote as returned.

4. **Fallback behavior**: If LLM fails to return sources, result is still valid - just without citations.
