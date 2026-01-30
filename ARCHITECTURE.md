# Convex Paper Import Architecture

## Executive Summary

A complete Convex-based architecture for importing, indexing, and extracting insights from research papers. The system supports both Zotero integration and direct paper search, with robust background processing, real-time progress tracking, and pause/resume functionality.

**Key Features:**
- Background PDF downloads with real-time progress bars
- RAG indexing with page numbers and character positions
- AI-powered question answering with batched processing
- Pause/resume functionality at phase level
- 5 concurrent downloads maximum, 5 retries per operation
- 5GB storage quota per user

---

## Architecture Overview

### Core Components

1. **Workflow System** - One workflow per paper for maximum parallelism and isolation
2. **Batch Orchestrator** - Manages multiple papers with concurrency control
3. **PDF Download Pipeline** - Stream downloads with progress tracking
4. **RAG Indexing Pipeline** - Page-level indexing with position metadata
5. **AI Extraction Pipeline** - Batched question answering
6. **Real-time Progress** - Live updates via Convex subscriptions

### Data Flow

```
User clicks "Import"
  ↓
Create Batch + Papers (metadata only, URLs provided by external code)
  ↓
Start Workflows (max 5 concurrent)
  ↓
Phase 1: Download PDF → Update progress per paper
  ↓
Check pause flag
  ↓
Phase 2: Index with RAG → Update progress per page
  ↓
Check pause flag
  ↓
Phase 3: Extract answers → All questions in one AI call
  ↓
Complete / Mark as failed
```

---

## Database Schema

### Tables

#### `importBatches`

Tracks overall import job state.

```typescript
{
  _id: Id<"importBatches">,
  userId: Id<"users">,
  source: "zotero" | "search",
  status: "pending" | "downloading" | "indexing" | "extracting" | "completed" | "partial" | "failed",
  totalPapers: number,
  completedPapers: number,
  failedPapers: number,
  progress: number, // 0-100
  startedAt: number,
  completedAt?: number,
  error?: string,
}
```

**Indexes:**
- `by_user`: ["userId"]
- `by_status`: ["status"]

#### `papers`

Individual paper processing state.

```typescript
{
  _id: Id<"papers">,
  batchId: Id<"importBatches">,
  userId: Id<"users">,
  
  // Metadata (provided by external code)
  externalId: string,
  title: string,
  authors: string[],
  doi?: string,
  url?: string,
  
  // Download state
  downloadStatus: "pending" | "downloading" | "completed" | "failed",
  storageId?: Id<"_storage">,
  downloadProgress: number,
  downloadError?: string,
  fileSize?: number,
  
  // Indexing state
  indexingStatus: "pending" | "processing" | "completed" | "failed",
  indexedPages: number,
  totalPages?: number,
  indexingProgress: number,
  indexingError?: string,
  
  // Extraction state
  extractionStatus: "pending" | "processing" | "completed" | "failed",
  extractionProgress: number,
  extractedData?: {
    answers: Array<{
      questionId: string,
      question: string,
      answer: string,
      confidence: number,
      sourceChunks: Id<"paperChunks">[],
    }>,
    processedAt: number,
  },
  extractionError?: string,
  
  // Pause/resume
  isPaused: boolean,
  resumeFrom?: "download" | "index" | "extract",
  failureCount: number,
  lastError?: string,
  
  createdAt: number,
  updatedAt: number,
}
```

**Indexes:**
- `by_batch`: ["batchId"]
- `by_user`: ["userId"]
- `by_download_status`: ["downloadStatus"]
- `by_indexing_status`: ["indexingStatus"]
- `by_extraction_status`: ["extractionStatus"]

#### `paperChunks`

RAG chunks with position metadata (manual implementation, not RAG component).

```typescript
{
  _id: Id<"paperChunks">,
  paperId: Id<"papers">,
  batchId: Id<"importBatches">,
  userId: Id<"users">,
  text: string,
  pageNumber: number,
  charStart: number,
  charEnd: number,
  embedding: number[], // text-embedding-3-small (1536 dimensions)
}
```

**Indexes:**
- `by_paper`: ["paperId"]
- `by_batch`: ["batchId"]
- `by_user`: ["userId"]

**Vector Index:**
```typescript
.vectorIndex("by_embedding", {
  vectorField: "embedding",
  dimensions: 1536,
})
```

#### `userStorage`

Tracks storage quota (5GB per user, PDFs only).

```typescript
{
  _id: Id<"userStorage">,
  userId: Id<"users">,
  totalBytes: number,
  paperCount: number,
}
```

**Indexes:**
- `by_user`: ["userId"]

#### `questions`

User-defined questions for extraction.

```typescript
{
  _id: Id<"questions">,
  userId: Id<"users">,
  text: string,
  order: number,
  createdAt: number,
}
```

**Indexes:**
- `by_user`: ["userId"]

---

## Workflow Design

### One Workflow Per Paper

Each paper gets its own durable workflow for:
- Maximum parallelism (5 concurrent via scheduler)
- Isolation (one failure doesn't block others)
- Pause/resume support
- Independent retry logic

```typescript
// convex/workflows/paperProcessing.ts
export const processPaperWorkflow = workflow.define({
  id: "process-paper",
  args: { paperId: v.id("papers"), userId: v.id("users") },
  handler: async (step, { paperId, userId }) => {
    const paper = await step.runQuery(internal.papers.get, { paperId });
    
    // Phase 1: Download
    if (paper.downloadStatus === "pending") {
      await step.runAction(internal.pdf.downloadWithRetry, { 
        paperId, 
        maxRetries: 5 
      });
    }
    
    // Check pause between phases
    if (await step.runQuery(internal.papers.isPaused, { paperId })) {
      await step.runMutation(internal.papers.setResumePoint, {
        paperId, phase: "index"
      });
      return { status: "paused" };
    }
    
    // Phase 2: Index
    if (paper.downloadStatus === "completed" && paper.indexingStatus === "pending") {
      await step.runAction(internal.rag.indexWithRetry, { 
        paperId, 
        maxRetries: 5 
      });
    }
    
    // Check pause
    if (await step.runQuery(internal.papers.isPaused, { paperId })) {
      await step.runMutation(internal.papers.setResumePoint, {
        paperId, phase: "extract"
      });
      return { status: "paused" };
    }
    
    // Phase 3: Extract
    if (paper.indexingStatus === "completed" && paper.extractionStatus === "pending") {
      await step.runAction(internal.extraction.extractWithRetry, { 
        paperId, 
        maxRetries: 5 
      });
    }
    
    return { status: "completed" };
  },
});
```

### Batch Orchestrator

Starts workflows in batches of 5 to control concurrency:

```typescript
const CONCURRENCY = 5;
for (let i = 0; i < paperIds.length; i += CONCURRENCY) {
  const batch = paperIds.slice(i, i + CONCURRENCY);
  await Promise.all(
    batch.map(paperId => 
      ctx.scheduler.runAfter(0, internal.workflows.startPaperWorkflow, {
        paperId,
        userId,
      })
    )
  );
}
```

---

## Phase 1: PDF Download Pipeline

### Key Features

1. **Storage Quota Check** (5GB per user)
2. **Streaming Download** with progress updates
3. **5 Retries** with exponential backoff (2s, 4s, 8s, 16s, 32s)
4. **Real-time Progress** via database patches

### Implementation

```typescript
// convex/pdf/download.ts
export const downloadWithRetry = action({
  args: { paperId: v.id("papers"), maxRetries: v.number() },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    for (let attempt = 1; attempt <= args.maxRetries; attempt++) {
      try {
        // 1. Check quota
        const paper = await ctx.runQuery(internal.papers.get, { paperId: args.paperId });
        const storage = await ctx.runQuery(internal.storage.getUsage, { userId: paper!.userId });
        
        if (storage.totalBytes >= FIVE_GB) {
          throw new ConvexError({
            code: "STORAGE_QUOTA_EXCEEDED",
            message: "Storage limit reached",
          });
        }
        
        // 2. Stream download with progress
        const response = await fetch(paper!.url!);
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let receivedSize = 0;
        
        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;
          
          chunks.push(value);
          receivedSize += value.length;
          
          // Update progress every 10%
          const progress = Math.round((receivedSize / totalSize) * 100);
          if (progress % 10 === 0) {
            await ctx.runMutation(internal.papers.updateDownloadProgress, {
              paperId: args.paperId,
              progress,
            });
          }
        }
        
        // 3. Store in Convex
        const blob = new Blob(chunks, { type: "application/pdf" });
        const storageId = await ctx.storage.store(blob);
        
        // 4. Update storage usage
        await ctx.runMutation(internal.storage.incrementUsage, {
          userId: paper!.userId,
          bytes: receivedSize,
        });
        
        // 5. Mark complete
        await ctx.runMutation(internal.papers.completeDownload, {
          paperId: args.paperId,
          storageId,
          fileSize: receivedSize,
        });
        
        return { success: true };
      } catch (error) {
        if (attempt === args.maxRetries) {
          await ctx.runMutation(internal.papers.failDownload, {
            paperId: args.paperId,
            error: String(error),
          });
          return { success: false, error: String(error) };
        }
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  },
});
```

---

## Phase 2: RAG Indexing Pipeline

### Manual RAG Implementation

**Why manual?** The `@convex-dev/rag` component doesn't support custom metadata (page numbers, char positions). We need these for citations.

### Chunking Strategy

- **Size:** 1000 characters
- **Overlap:** 200 characters (maintains context between chunks)
- **Metadata:** Page number, char start, char end

### Implementation

```typescript
// convex/rag/index.ts
export const indexWithRetry = action({
  args: { paperId: v.id("papers"), maxRetries: v.number() },
  returns: v.object({ success: v.boolean(), chunksIndexed: v.number() }),
  handler: async (ctx, args) => {
    for (let attempt = 1; attempt <= args.maxRetries; attempt++) {
      try {
        // 1. Get PDF from storage
        const paper = await ctx.runQuery(internal.papers.get, { paperId: args.paperId });
        const fileUrl = await ctx.storage.getUrl(paper!.storageId!);
        const pdfBuffer = await fetch(fileUrl!).then(r => r.arrayBuffer());
        
        // 2. Parse PDF with page tracking
        const pdfData = await pdfParse(Buffer.from(pdfBuffer), {
          pagerender: (pageData) => {
            // Custom renderer to get text + positions
            return pageData.getTextContent().then((textContent) => {
              let text = "";
              let charOffset = 0;
              
              textContent.items.forEach((item) => {
                text += item.str;
                charOffset += item.str.length;
              });
              
              return { text, charCount: charOffset };
            });
          },
        });
        
        // 3. Process each page
        let totalChunks = 0;
        for (let pageNum = 1; pageNum <= pdfData.numpages; pageNum++) {
          const pageText = pdfData.text[pageNum - 1];
          
          // Create chunks with overlap
          const chunks = createChunks(pageText.text, pageText.charCount);
          
          // Generate embeddings and store
          for (const chunk of chunks) {
            const embedding = await generateEmbedding(chunk.text); // text-embedding-3-small
            
            await ctx.runMutation(internal.rag.createChunk, {
              paperId: args.paperId,
              text: chunk.text,
              pageNumber: pageNum,
              charStart: chunk.charStart,
              charEnd: chunk.charEnd,
              embedding,
            });
          }
          
          totalChunks += chunks.length;
          
          // Update progress per page
          const progress = Math.round((pageNum / pdfData.numpages) * 100);
          await ctx.runMutation(internal.papers.updateIndexingProgress, {
            paperId: args.paperId,
            progress,
            indexedPages: pageNum,
            totalPages: pdfData.numpages,
          });
        }
        
        // Mark complete
        await ctx.runMutation(internal.papers.completeIndexing, {
          paperId: args.paperId,
          chunksIndexed: totalChunks,
        });
        
        return { success: true, chunksIndexed: totalChunks };
      } catch (error) {
        if (attempt === args.maxRetries) {
          await ctx.runMutation(internal.papers.failIndexing, {
            paperId: args.paperId,
            error: String(error),
          });
          return { success: false, chunksIndexed: 0 };
        }
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  },
});

// Helper: Create chunks with overlap
function createChunks(text: string, totalChars: number) {
  const CHUNK_SIZE = 1000;
  const CHUNK_OVERLAP = 200;
  const chunks = [];
  
  let start = 0;
  while (start < totalChars) {
    const end = Math.min(start + CHUNK_SIZE, totalChars);
    chunks.push({
      text: text.slice(start, end),
      charStart: start,
      charEnd: end,
    });
    start = end - CHUNK_OVERLAP; // Overlap for context
  }
  
  return chunks;
}
```

### Search Implementation

```typescript
// convex/rag/search.ts
export const searchChunks = query({
  args: { 
    paperId: v.id("papers"), 
    query: v.string(), 
    limit: v.optional(v.number()) 
  },
  returns: v.array(v.object({
    _id: v.id("paperChunks"),
    text: v.string(),
    pageNumber: v.number(),
    charStart: v.number(),
    charEnd: v.number(),
    score: v.number(),
  })),
  handler: async (ctx, args) => {
    // 1. Generate embedding for query
    const queryEmbedding = await generateEmbedding(args.query);
    
    // 2. Vector search
    const results = await ctx.db
      .query("paperChunks")
      .withIndex("by_embedding", (q) =>
        q.searchVector("embedding", queryEmbedding)
      )
      .filter((q) => q.eq(q.field("paperId"), args.paperId))
      .take(args.limit ?? 10);
    
    return results.map(r => ({
      ...r,
      score: calculateCosineSimilarity(queryEmbedding, r.embedding),
    }));
  },
});
```

---

## Phase 3: AI Extraction Pipeline

### Batched Question Processing

All user questions answered in **one AI call** per paper for efficiency.

### Implementation

```typescript
// convex/extraction/extract.ts
export const extractWithRetry = action({
  args: { paperId: v.id("papers"), maxRetries: v.number() },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    for (let attempt = 1; attempt <= args.maxRetries; attempt++) {
      try {
        const paper = await ctx.runQuery(internal.papers.get, { paperId: args.paperId });
        const questions = await ctx.runQuery(internal.questions.listForUser, { 
          userId: paper!.userId 
        });
        
        // 1. Get relevant chunks
        const chunks = await ctx.runQuery(internal.rag.getChunksForPaper, {
          paperId: args.paperId,
          limit: 20,
        });
        
        // 2. Single AI call for all questions
        const response = await agent.chat(ctx, {
          threadId: await agent.createThread(ctx, { userId: paper!.userId }),
          messages: [{
            role: "user",
            content: `Answer these questions based on the research paper:

${questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')}

Paper content:
${chunks.map(c => `[Page ${c.pageNumber}, Chars ${c.charStart}-${c.charEnd}]: ${c.text}`).join('\n\n')}

Return ONLY valid JSON:
{
  "answers": [
    {
      "questionId": "${questions[0]?._id}",
      "answer": "string",
      "confidence": 0.95,
      "sourcePages": [1, 3]
    }
  ]
}`,
          }],
        });
        
        // 3. Parse and store answers
        const parsed = JSON.parse(response.content);
        
        await ctx.runMutation(internal.extraction.saveAnswers, {
          paperId: args.paperId,
          answers: parsed.answers.map((a: any) => ({
            questionId: a.questionId,
            question: questions.find(q => q._id === a.questionId)?.text || "",
            answer: a.answer,
            confidence: a.confidence,
            sourceChunks: chunks
              .filter(c => a.sourcePages?.includes(c.pageNumber))
              .map(c => c._id),
          })),
        });
        
        // 4. Mark complete
        await ctx.runMutation(internal.papers.completeExtraction, {
          paperId: args.paperId,
        });
        
        return { success: true };
      } catch (error) {
        if (attempt === args.maxRetries) {
          await ctx.runMutation(internal.papers.failExtraction, {
            paperId: args.paperId,
            error: String(error),
          });
          return { success: false };
        }
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  },
});
```

---

## Pause/Resume Implementation

### How It Works

1. **Pause Request:** Sets `isPaused = true` on paper
2. **Current Phase Completes:** Workflow checks flag between phases
3. **Resume Point Saved:** Stores which phase to resume from
4. **Resume:** Resets pause flag and restarts workflow

### Code

```typescript
// convex/papers/pause.ts
export const pausePaper = mutation({
  args: { paperId: v.id("papers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paperId, { isPaused: true });
    return null;
  },
});

export const resumePaper = mutation({
  args: { paperId: v.id("papers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper?.isPaused) return null;
    
    // Reset failed states so they retry
    await ctx.db.patch(args.paperId, {
      isPaused: false,
      downloadStatus: paper.downloadStatus === "failed" ? "pending" : paper.downloadStatus,
      indexingStatus: paper.indexingStatus === "failed" ? "pending" : paper.indexingStatus,
      extractionStatus: paper.extractionStatus === "failed" ? "pending" : paper.extractionStatus,
    });
    
    // Restart workflow
    await ctx.scheduler.runAfter(0, internal.workflows.startPaperWorkflow, {
      paperId: paper._id,
      userId: paper.userId,
    });
    
    return null;
  },
});
```

---

## Real-time Progress UI

### React Component

```typescript
// components/ImportProgress.tsx
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

function ImportProgress({ batchId }: { batchId: Id<"importBatches"> }) {
  const batch = useQuery(api.batches.get, { batchId });
  const papers = useQuery(api.papers.listByBatch, { batchId });

  if (!batch) return <div>Loading...</div>;

  return (
    <div className="import-progress">
      <h2>Import: {batch.status}</h2>
      
      {/* Overall progress */}
      <div className="progress-bar">
        <div className="fill" style={{ width: `${batch.progress}%` }} />
      </div>
      <p>{batch.completedPapers} / {batch.totalPapers} papers</p>
      
      {/* Individual papers */}
      <div className="papers">
        {papers?.map(paper => (
          <PaperCard key={paper._id} paper={paper} />
        ))}
      </div>
    </div>
  );
}

function PaperCard({ paper }: { paper: Doc<"papers"> }) {
  return (
    <div className="paper-card">
      <h4>{paper.title}</h4>
      
      {/* Download */}
      <div className="stage">
        <span className={paper.downloadStatus}>Download</span>
        <progress value={paper.downloadProgress} max={100} />
      </div>
      
      {/* Indexing */}
      <div className="stage">
        <span className={paper.indexingStatus}>Indexing</span>
        <progress value={paper.indexingProgress} max={100} />
        <small>{paper.indexedPages} / {paper.totalPages} pages</small>
      </div>
      
      {/* Extraction */}
      <div className="stage">
        <span className={paper.extractionStatus}>Extraction</span>
        <progress value={paper.extractionProgress} max={100} />
      </div>
      
      {/* Pause/Resume */}
      {paper.isPaused ? (
        <button onClick={() => resumePaper(paper._id)}>Resume</button>
      ) : (
        <button onClick={() => pausePaper(paper._id)}>Pause</button>
      )}
      
      {/* Questions & Answers (when ready) */}
      {paper.extractionStatus === "completed" && (
        <QuestionsList paperId={paper._id} />
      )}
    </div>
  );
}
```

---

## File Structure

```
convex/
├── _generated/
├── schema.ts                    # Database schema
├── convex.config.ts             # Agent + Workflow components
├── agent.ts                     # Deepseek setup
│
├── workflows/
│   └── paperProcessing.ts       # Main workflow definition
│
├── batch/
│   ├── start.ts                 # Start batch + orchestrate
│   ├── queries.ts               # Get batch, list by user
│   └── mutations.ts             # Update progress
│
├── papers/
│   ├── queries.ts               # Get paper, list by batch/user
│   ├── mutations.ts             # Status updates
│   └── pause.ts                 # Pause/resume logic
│
├── pdf/
│   ├── download.ts              # Download with retry
│   └── parse.ts                 # PDF parsing utilities
│
├── rag/
│   ├── index.ts                 # Index with retry
│   ├── chunks.ts                # Chunk creation
│   ├── search.ts                # Vector search
│   └── embedding.ts             # text-embedding-3-small
│
├── extraction/
│   ├── extract.ts               # Extract with retry
│   └── questions.ts             # Question management
│
├── storage/
│   ├── quota.ts                 # 5GB quota checks
│   └── tracking.ts              # Usage tracking
│
└── utils/
    ├── sleep.ts                 # Exponential backoff
    └── errors.ts                # ConvexError helpers
```

---

## Environment Variables

```env
# .env.local
OPENAI_API_KEY=sk-...          # For text-embedding-3-small
DEEPSEEK_API_KEY=sk-...        # For chat/completion
CONVEX_DEPLOYMENT=...          # Auto-generated
```

---

## Error Handling

### ConvexError Pattern

```typescript
import { ConvexError } from "convex/values";

// Quota exceeded
throw new ConvexError({
  code: "STORAGE_QUOTA_EXCEEDED",
  message: `Storage limit reached: ${formatBytes(used)} / 5GB`,
  currentUsage: usedBytes,
  limit: FIVE_GB,
});

// Download failed
throw new ConvexError({
  code: "DOWNLOAD_FAILED",
  message: "Failed to download PDF after 5 retries",
  paperId: args.paperId,
  url: paper.url,
});
```

### Idempotent Updates

```typescript
// Always check current state before updating
export const updateDownloadProgress = internalMutation({
  args: { paperId: v.id("papers"), progress: v.number() },
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    // Only update if actually changed (prevents write conflicts)
    if (paper && paper.downloadProgress !== args.progress) {
      await ctx.db.patch(args.paperId, {
        downloadProgress: args.progress,
        updatedAt: Date.now(),
      });
    }
  },
});
```

---

## Performance Considerations

1. **Concurrency:** Max 5 parallel workflows via scheduler batching
2. **Chunking:** 1000 char chunks with 200 char overlap
3. **Embeddings:** text-embedding-3-small (1536 dims, fast + cheap)
4. **Vector Search:** Top 20 chunks per paper for extraction context
5. **Retries:** 5 attempts with exponential backoff
6. **Database:** Index on every query field to avoid filters

---

## Security

1. **User Isolation:** All queries filter by `userId`
2. **Internal Functions:** Status updates via `internal.*` only
3. **Storage Quota:** Checked before every download
4. **URL Validation:** (Handled by external code providing URLs)

---

## Future Enhancements

- [ ] Cancel in-progress phase (vs wait for completion)
- [ ] Parallel question processing (if question count > 10)
- [ ] Caching for repeated questions across papers
- [ ] Export results to various formats
- [ ] Collaborative batches (shared between users)

---

## Summary

This architecture provides:

✅ **Durable Background Processing** - Workflows survive restarts  
✅ **Real-time Progress** - Live updates via Convex subscriptions  
✅ **Pause/Resume** - Phase-level granularity  
✅ **Parallel Processing** - 5 concurrent downloads  
✅ **Retry Logic** - 5 attempts with exponential backoff  
✅ **Storage Quotas** - 5GB per user  
✅ **Manual RAG** - Page + char position metadata  
✅ **Batched Questions** - Single AI call per paper  
✅ **Proper Error Handling** - ConvexError + idempotent updates  

**Ready for implementation.**
