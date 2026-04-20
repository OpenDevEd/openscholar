import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { rateLimitTables } from "convex-helpers/server/rateLimit";
import {
  errorCodeValidator,
  searchFiltersValidator,
  structuredErrorValidator,
} from "./extraction/validators";

export default defineSchema({
  // Rate limiting (convex-helpers)
  ...rateLimitTables,

  // ═══════════════════════════════════════════════════════════════
  // MODELS - Unified AI model catalog, auto-synced from OpenRouter
  // ═══════════════════════════════════════════════════════════════
  models: defineTable({
    // ── Identity ──
    modelId: v.string(),
    name: v.string(),
    provider: v.string(),
    description: v.optional(v.string()),
    canonicalSlug: v.optional(v.string()),
    huggingFaceId: v.optional(v.string()),

    // ── Architecture ──
    modality: v.optional(v.string()),
    inputModalities: v.optional(v.array(v.string())),
    outputModalities: v.optional(v.array(v.string())),
    tokenizer: v.optional(v.string()),
    instructType: v.optional(v.string()),

    // ── Pricing (USD per million tokens) ──
    inputPricePerMillion: v.number(),
    outputPricePerMillion: v.number(),
    cacheReadPricePerMillion: v.optional(v.number()),
    cacheWritePricePerMillion: v.optional(v.number()),
    reasoningPricePerMillion: v.optional(v.number()),
    webSearchPrice: v.optional(v.number()),
    imagePricePerMillion: v.optional(v.number()),
    audioPricePerMillion: v.optional(v.number()),

    // ── Context & Limits ──
    contextLength: v.optional(v.number()),
    maxCompletionTokens: v.optional(v.number()),
    isModerated: v.optional(v.boolean()),

    // ── Capabilities ──
    supportedParameters: v.optional(v.array(v.string())),

    // ── Lifecycle ──
    knowledgeCutoff: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    createdOnOpenRouter: v.optional(v.number()),

    // ── Defaults ──
    defaultTemperature: v.optional(v.number()),
    defaultTopP: v.optional(v.number()),
    defaultTopK: v.optional(v.number()),

    // ── Business layer (our overrides) ──
    isServed: v.boolean(),
    costMarkup: v.number(),
    sortOrder: v.number(),
    category: v.optional(v.string()),

    // ── Timestamps ──
    syncedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_model_id", ["modelId"])
    .index("by_provider", ["provider"])
    .index("by_served_sort", ["isServed", "sortOrder"])
    .index("by_synced", ["syncedAt"]),

  // ═══════════════════════════════════════════════════════════════
  // FEATURE FLAGS - Database-driven feature gating
  // ═══════════════════════════════════════════════════════════════
  featureFlags: defineTable({
    key: v.string(),
    enabled: v.boolean(),
    minimumTier: v.number(),
    description: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // ═══════════════════════════════════════════════════════════════
  // USERS - synced from Clerk, single source of truth in Convex
  // ═══════════════════════════════════════════════════════════════
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    state: v.union(
      v.literal("active"),
      v.literal("suspended"),
      v.literal("deleted")
    ),
    lastLoginAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    libraryItemCount: v.optional(v.number()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_state", ["state"]),

  // ═══════════════════════════════════════════════════════════════
  // CREDITS - per-user credit balance
  // ═══════════════════════════════════════════════════════════════
  credits: defineTable({
    userId: v.id("users"),
    freeBalance: v.number(),
    paidBalance: v.number(),
    lifetimeUsed: v.number(),
    lastUpdatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════
  // CREDIT_TRANSACTIONS - audit log for credit changes
  // ═══════════════════════════════════════════════════════════════
  creditTransactions: defineTable({
    creditsId: v.id("credits"),
    userId: v.optional(v.id("users")),
    type: v.union(
      v.literal("purchase"),
      v.literal("usage"),
      v.literal("grant"),
      v.literal("refund"),
      v.literal("expiry")
    ),
    creditType: v.union(v.literal("free"), v.literal("paid")), // Which pool was affected
    amount: v.number(),
    balanceAfter: v.number(),
    description: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
    stripeInvoiceId: v.optional(v.string()), // For idempotency
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_credits", ["creditsId"])
    .index("by_stripe_invoice", ["stripeInvoiceId"])
    .index("by_stripe_payment_intent", ["stripePaymentIntentId"])
    .index("by_stripe_charge", ["stripeChargeId"])
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_user", ["userId"])
    .index("by_type_date", ["type", "createdAt"]),

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS - Stripe billing integration ready
  // ═══════════════════════════════════════════════════════════════
  subscriptions: defineTable({
    userId: v.id("users"),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    plan: v.union(
      v.literal("free"),
      v.literal("go"),
      v.literal("pro"),
      v.literal("enterprise")
    ),
    status: v.union(
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("trialing"),
      v.literal("incomplete"),
      v.literal("incomplete_expired"),
      v.literal("unpaid"),
      v.literal("paused")
    ),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    canceledAt: v.optional(v.number()),
    pastDueSince: v.optional(v.number()),
    creditsPerMonth: v.optional(v.number()),
    seats: v.optional(v.number()),
    // Pending plan change state (BILL-02) -- source of truth in Convex, not Stripe metadata
    pendingFromPlan: v.optional(v.union(v.literal("free"), v.literal("go"), v.literal("pro"), v.literal("enterprise"))),
    pendingToPlan: v.optional(v.union(v.literal("free"), v.literal("go"), v.literal("pro"), v.literal("enterprise"))),
    pendingChangeTimestamp: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_sub", ["stripeSubscriptionId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_status", ["status"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // Durable user -> Stripe customer identity mapping.
  billingCustomers: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    linkedFrom: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  // Stripe webhook event audit + retry control
  stripeEventLogs: defineTable({
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeObjectId: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
    classification: v.optional(v.string()),
    status: v.union(
      v.literal("received"),
      v.literal("processed"),
      v.literal("retrying"),
      v.literal("failed"),
      v.literal("ignored")
    ),
    attemptCount: v.number(),
    lastError: v.optional(v.string()),
    nextRetryAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastProcessedAt: v.optional(v.number()),
  })
    .index("by_stripe_event_id", ["stripeEventId"])
    .index("by_status_next_retry", ["status", "nextRetryAt"])
    .index("by_object_created", ["stripeObjectId", "createdAt"])
    .index("by_event_type_created", ["eventType", "createdAt"]),

  // ═══════════════════════════════════════════════════════════════
  // AUDIT LOGS - Persistent security audit trail
  // ═══════════════════════════════════════════════════════════════
  auditLogs: defineTable({
    action: v.string(),
    userId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
    timestamp: v.number(),
  })
    .index("by_action", ["action"])
    .index("by_action_timestamp", ["action", "timestamp"])
    .index("by_timestamp", ["timestamp"]),

  // ═══════════════════════════════════════════════════════════════
  // WALLET ALLOWED ORIGINS - registered origins for /connect flow
  // ═══════════════════════════════════════════════════════════════
  walletAllowedOrigins: defineTable({
    origin: v.string(),
    appName: v.string(),
    createdAt: v.number(),
  }).index("by_origin", ["origin"]),

  // ═══════════════════════════════════════════════════════════════
  // WALLET KEYS - API keys for external site AI gateway access
  // ═══════════════════════════════════════════════════════════════
  walletKeys: defineTable({
    userId: v.id("users"),
    hashedKey: v.string(),
    keyPrefix: v.string(),
    appName: v.string(),
    redirectOrigin: v.string(),
    isActive: v.boolean(),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_hashed_key", ["hashedKey"])
    .index("by_user", ["userId"])
    .index("by_user_active", ["userId", "isActive"]),

  // ═══════════════════════════════════════════════════════════════
  // API KEYS - BYOK (Bring Your Own Key) storage
  // ═══════════════════════════════════════════════════════════════
  apiKeys: defineTable({
    userId: v.id("users"),
    provider: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("google"),
      v.literal("openrouter")
    ),
    encryptedKey: v.string(),
    keyPrefix: v.string(), // First chars for display (sk-xxxx...)
    lastUsedAt: v.optional(v.number()),
    lastValidatedAt: v.optional(v.number()),
    isValid: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_provider", ["userId", "provider"]),

  // ═══════════════════════════════════════════════════════════════
  // ZOTERO INTEGRATION - OAuth connections (auth only)
  // ═══════════════════════════════════════════════════════════════

  zoteroConnections: defineTable({
    userId: v.id("users"),
    zoteroUserId: v.string(),
    encryptedApiKey: v.string(),  // Required: encrypted API key (only storage form after Phase 43 migration)
    keyPrefix: v.string(),       // Required: first chars for display (e.g. "zot_xxxx...")
    username: v.optional(v.string()),
    connectedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_zotero_user", ["zoteroUserId"]),

  // Temporary storage for OAuth request tokens (short-lived)
  zoteroOAuthTokens: defineTable({
    token: v.string(),
    tokenSecret: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"])
    .index("by_expiry", ["expiresAt"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION JOBS - Dual-mode job rows: "extraction" (data pipeline)
  //                   and "chat" (conversational Q&A over papers).
  //                   One table, one set of URLs, mode-discriminated.
  // ═══════════════════════════════════════════════════════════════
  extractionJobs: defineTable({
    userId: v.id("users"),

    // Required discriminator. Every field below that is mode-specific is
    // optional in the schema; the mode is what tells the reader which
    // subset to expect.
    mode: v.union(v.literal("extraction"), v.literal("chat")),

    // Source type classifier. Present for both modes — chat also pins a
    // paper set. Actual per-row source payloads live in
    // `extractionJobSources` (below).
    sourceType: v.optional(
      v.union(
        v.literal("history"),
        v.literal("zotero"),
        v.literal("manual"),
        v.literal("mixed")
      )
    ),

    // ─── Extraction-only fields ───────────────────────────────────
    // Status / counters / workflowId only apply to the data-extraction
    // pipeline. Unset on chat rows.
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("downloading_pdfs"),
        v.literal("indexing"),
        v.literal("extracting"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    totalPapers: v.optional(v.number()),
    processedPapers: v.optional(v.number()),
    failedPapers: v.optional(v.number()),
    workflowId: v.optional(v.string()),
    // Per-job PDF opt-in. Replaces the old global `extraction.pdf` flag
    // as the *default*; the flag remains as an admin capability gate.
    usePdfs: v.optional(v.boolean()),

    // ─── Chat-only fields ─────────────────────────────────────────
    // @convex-dev/agent thread id (component-owned).
    chatThreadId: v.optional(v.string()),
    // Current model choice — picker seeds from models table (isServed).
    chatModelId: v.optional(v.id("models")),
    // Denormalised for list rendering + sort.
    lastMessageAt: v.optional(v.number()),
    messageCount: v.optional(v.number()),
    // Per-thread concurrency lock — one in-flight generation per chat.
    isGenerating: v.optional(v.boolean()),
    generatingStartedAt: v.optional(v.number()),
    // Mid-stream abort flag. Set by abortGeneration, polled every
    // 500ms by generateResponse's AbortController-poll loop, cleared
    // by releaseThreadLock in the action's finally.
    shouldAbort: v.optional(v.boolean()),

    // ─── Shared metadata ──────────────────────────────────────────
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),

    // Populated by the workflow onComplete handler when the workflow
    // terminates with kind: "failed", or by any catch site that wants
    // to surface a structured failure reason. The taxonomy code lets
    // the UI pick localized title/body without parsing the message.
    error: v.optional(structuredErrorValidator),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    // Unified history list + single-mode scoping (count user's chats).
    .index("by_user_mode_updated", ["userId", "mode", "updatedAt"])
    // Cross-user iteration by mode (admin backfills, ops tooling).
    .index("by_mode", ["mode"])
    // Reverse lookup: thread -> job (auth + lock acquisition).
    .index("by_chatThread", ["chatThreadId"])
    .index("by_workflow", ["workflowId"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION JOB SOURCES - one row per bucket item
  // Stores a frozen copy of the BucketItem that produced each paper,
  // so a job's inputs can be reconstructed exactly after submission.
  // ═══════════════════════════════════════════════════════════════
  extractionJobSources: defineTable({
    jobId: v.id("extractionJobs"),
    position: v.number(),
    bucketKey: v.string(),
    source: v.union(
      v.literal("history"),
      v.literal("library"),
      v.literal("collection"),
      v.literal("zotero"),
      v.literal("upload")
    ),
    sourceRefId: v.string(),
    title: v.string(),
    authors: v.array(v.string()),
    year: v.optional(v.number()),
    doi: v.optional(v.string()),
    openalexId: v.optional(v.string()),
    abstract: v.optional(v.string()),
    pdfUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    // history: saved-search placeholder that expands at workflow time
    searchFilters: v.optional(searchFiltersValidator),
    // zotero context (libraryType/groupId resolve the OAuth target at workflow time)
    libraryType: v.optional(
      v.union(v.literal("user"), v.literal("group"))
    ),
    groupId: v.optional(v.string()),
    zoteroUserId: v.optional(v.string()),
    collectionKey: v.optional(v.string()),
    includeDescendants: v.optional(v.boolean()),
  })
    .index("by_job_and_position", ["jobId", "position"])
    .index("by_job_and_source", ["jobId", "source"]),

  // ═══════════════════════════════════════════════════════════════
  // CHAT PAPERS - Live inclusion bridge for chat-mode jobs.
  // 1:1 with extractionJobSources (for chat jobs only). Seeded
  // included=true at ensureThreadForJob; toggled by the Sources panel;
  // read at every stream-start to filter the <papers> prompt block.
  // Kept separate so the frozen source snapshot stays immutable and
  // high-frequency toggle writes do not touch the audit table.
  // ═══════════════════════════════════════════════════════════════
  chatPapers: defineTable({
    jobId: v.id("extractionJobs"),
    sourceId: v.id("extractionJobSources"),
    included: v.boolean(),
  })
    .index("by_job", ["jobId"])
    .index("by_job_included", ["jobId", "included"])
    .index("by_job_source", ["jobId", "sourceId"])
    .index("by_source", ["sourceId"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION QUESTIONS - User-defined questions for data extraction
  // ═══════════════════════════════════════════════════════════════
  extractionQuestions: defineTable({
    jobId: v.id("extractionJobs"),
    key: v.string(), // Unique identifier for this question within the job
    question: v.string(), // The actual question text
    type: v.union(
      v.literal("string"),
      v.literal("boolean"),
      v.literal("number"),
      v.literal("array")
    ),
    description: v.optional(v.string()), // Help text for the AI
    order: v.number(), // Display order
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_job_key", ["jobId", "key"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION PAPERS - Individual papers being processed
  // ═══════════════════════════════════════════════════════════════
  extractionPapers: defineTable({
    jobId: v.id("extractionJobs"),

    // Paper metadata (from OpenAlex)
    openalexId: v.string(),
    title: v.string(),
    doi: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
    abstract: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
    isOpenAccess: v.optional(v.boolean()),
    processable: v.optional(v.boolean()),

    // Processing status
    status: v.union(
      v.literal("pending"),
      v.literal("downloading"),
      v.literal("download_failed"),
      v.literal("indexing"),
      v.literal("indexing_failed"),
      v.literal("extracting"),
      v.literal("completed"),
      v.literal("failed")
    ),

    // PDF handling
    pdfUrl: v.optional(v.string()), // Source URL
    storageId: v.optional(v.id("_storage")), // Convex file storage ID
    pdfDownloadError: v.optional(v.string()),
    sourceType: v.optional(v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"))),
    sourceId: v.optional(v.string()),

    // RAG indexing
    ragEntryId: v.optional(v.string()), // RAG component entry ID (actual entry ID from callback)
    isIndexed: v.optional(v.boolean()), // true when PDF was successfully indexed in RAG
    indexedAt: v.optional(v.number()),
    // Idempotency flag: true once embedding credits have been deducted.
    // Prevents double-billing if indexPaperAction is retried after a crash
    // that occurred between rag.add() and the credit-deduction mutation.
    indexingBilled: v.optional(v.boolean()),

    // Processing metadata
    workId: v.optional(v.string()), // Workpool work ID for tracking
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    // Most recent structured failure for this paper. Append-only history
    // of every attempt is kept in `extractionPaperErrors` (see below).
    lastError: v.optional(structuredErrorValidator),
    // Number of completed attempts (success or failure). Bumped on every
    // terminal transition by markPaperTerminalTx.
    attemptCount: v.optional(v.number()),

    // Cost tracking. Plan-02 billing-idempotency lives on the per-question
    // extractionResults.billed flag; per-paper creditsUsed is just the
    // running aggregate of recordOneAnswer's debits.
    creditsUsed: v.optional(v.number()),

    // Content usage tracking
    pdfContentUsed: v.optional(v.boolean()), // true if PDF content was actually used for extraction (any question)
  })
    .index("by_job", ["jobId"])
    .index("by_job_processable", ["jobId", "processable"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_openalex", ["openalexId"])
    .index("by_work", ["workId"])
    .index("by_status_completedAt", ["status", "completedAt"])
    .index("by_ragEntryId_isIndexed", ["ragEntryId", "isIndexed"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION PAPER ERRORS - Append-only failure history per paper
  //
  // One row inserted on every terminal failure (download, indexing, or
  // extraction). Lets us paginate the full retry trail per paper and
  // diagnose flaky upstream behavior without bloating extractionPapers.
  // Plan-01 § "Persistence hooks".
  // ═══════════════════════════════════════════════════════════════
  extractionPaperErrors: defineTable({
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    // 1-indexed attempt number; matches the attemptCount on the paper
    // *after* this row is written.
    attempt: v.number(),
    at: v.number(),
    code: errorCodeValidator,
    message: v.string(),
    httpStatus: v.optional(v.number()),
    providerName: v.optional(v.string()),
    // Capped at 4 KB by classifyUnknownError before insert.
    context: v.optional(v.any()),
  })
    .index("by_paper", ["paperId"])
    .index("by_job", ["jobId"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION EVIDENCE UNITS - Anchored sentence evidence (V3)
  // ═══════════════════════════════════════════════════════════════
  extractionEvidenceUnits: defineTable({
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    evidenceId: v.string(),
    page: v.number(),
    charRange: v.array(v.number()),
    text: v.string(),
    section: v.optional(v.string()),
    tokens: v.array(v.string()),
    anchorConfidence: v.number(),
    source: v.string(),
    createdAt: v.number(),
  })
    .index("by_paper", ["paperId"])
    .index("by_paper_evidence", ["paperId", "evidenceId"])
    .index("by_paper_page", ["paperId", "page"])
    .index("by_job", ["jobId"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION RESULTS - Extracted data for each paper/question combo
  // ═══════════════════════════════════════════════════════════════
  extractionResults: defineTable({
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    questionKey: v.string(),

    // Answer value (type depends on question type, null if not found)
    answer: v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()),

    // AI metadata
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    citations: v.array(
      v.object({
        evidenceId: v.string(),
        page: v.number(),
        charRange: v.array(v.number()),
        quote: v.string(),
        retrieval: v.object({
          denseScore: v.optional(v.number()),
          lexicalScore: v.optional(v.number()),
          fusedScore: v.optional(v.number()),
          rerankScore: v.optional(v.number()),
        }),
        validated: v.boolean(),
      })
    ),
    citationStatus: v.union(
      v.literal("grounded"),
      v.literal("best_effort"),
      v.literal("insufficient_evidence"),
      v.literal("extraction_error")
    ),
    retrievalDiagnostics: v.optional(
      v.object({
        denseCandidates: v.number(),
        lexicalCandidates: v.number(),
        fusedCandidates: v.number(),
        rerankedCandidates: v.number(),
        validatedCitations: v.number(),
        strictNull: v.boolean(),
      })
    ),

    // Per-question lifecycle status. Plan-02 moves the orchestration from
    // per-paper to per-(paper, question) so every question gets its own
    // workflow step, its own retry budget, and its own billing gate.
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("extracting"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    // Idempotency gate: true once the LLM credits for this question have
    // been deducted atomically with persisting the answer. This is the
    // per-question billing flag plan-02 uses in place of any per-paper
    // equivalent.
    billed: v.optional(v.boolean()),
    // Per-question retry counter. Bumped every time the workflow step
    // terminates (success or failure) so `aggregatePaperStatus` can decide
    // whether a retryable failure has exhausted its budget.
    attemptCount: v.optional(v.number()),
    // Most recent structured failure for this question, classified by
    // `lib/errors/taxonomy`. Paper-level `extractionPapers.lastError`
    // still exists as the coarse per-paper fallback used by the
    // download/index stages.
    lastError: v.optional(structuredErrorValidator),

    // Source tracking
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    pdfContentUsed: v.optional(v.boolean()), // Whether PDF content was actually used for this answer
    processedAt: v.number(),
  })
    .index("by_paper", ["paperId"])
    .index("by_paper_question", ["paperId", "questionKey"])
    .index("by_job", ["jobId"])
    .index("by_job_question", ["jobId", "questionKey"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION RESULT REVIEWS - Human QA state and corrections
  // ═══════════════════════════════════════════════════════════════
  extractionResultReviews: defineTable({
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    resultId: v.id("extractionResults"),
    questionKey: v.string(),
    state: v.union(
      v.literal("unreviewed"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("needs_followup")
    ),
    note: v.optional(v.string()),
    correctedAnswer: v.optional(
      v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null())
    ),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_result", ["resultId"])
    .index("by_paper", ["paperId"])
    .index("by_job", ["jobId"])
    .index("by_job_state", ["jobId", "state"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION SAVED VIEWS - Persisted filtering and sorting presets
  // ═══════════════════════════════════════════════════════════════
  extractionSavedViews: defineTable({
    jobId: v.id("extractionJobs"),
    userId: v.id("users"),
    name: v.string(),
    filters: v.object({
      searchQuery: v.string(),
      confidenceRange: v.array(v.number()),
      statusFilters: v.array(v.string()),
    }),
    sortBy: v.optional(v.string()),
    viewMode: v.optional(v.string()),
    selectedQuestionKeys: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_user", ["userId"])
    .index("by_job_name", ["jobId", "name"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION WORKFLOW TEMPLATES - Reusable extraction configs
  // ═══════════════════════════════════════════════════════════════
  extractionWorkflowTemplates: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    sourceType: v.union(
      v.literal("history"),
      v.literal("zotero"),
      v.literal("manual"),
      v.literal("mixed")
    ),
    // Frozen bucket snapshot — the exact paper set the template re-runs on.
    bucketItems: v.array(
      v.object({
        bucketKey: v.string(),
        source: v.union(
          v.literal("history"),
          v.literal("library"),
          v.literal("collection"),
          v.literal("zotero"),
          v.literal("upload")
        ),
        sourceRefId: v.string(),
        title: v.string(),
        authors: v.array(v.string()),
        year: v.optional(v.number()),
        doi: v.optional(v.string()),
        openalexId: v.optional(v.string()),
        abstract: v.optional(v.string()),
        pdfUrl: v.optional(v.string()),
        storageId: v.optional(v.id("_storage")),
        searchFilters: v.optional(searchFiltersValidator),
        libraryType: v.optional(v.union(v.literal("user"), v.literal("group"))),
        groupId: v.optional(v.string()),
        zoteroUserId: v.optional(v.string()),
        collectionKey: v.optional(v.string()),
        includeDescendants: v.optional(v.boolean()),
      })
    ),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION REPORT SNAPSHOTS - Generated report artifacts
  // ═══════════════════════════════════════════════════════════════
  extractionReportSnapshots: defineTable({
    jobId: v.id("extractionJobs"),
    userId: v.id("users"),
    name: v.string(),
    scope: v.object({
      filteredPaperIds: v.optional(v.array(v.id("extractionPapers"))),
      selectedQuestionKeys: v.optional(v.array(v.string())),
      viewName: v.optional(v.string()),
    }),
    sections: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        body: v.string(),
      })
    ),
    metrics: v.object({
      totalPapers: v.number(),
      answeredRate: v.number(),
      groundedRate: v.number(),
      bestEffortRate: v.number(),
    }),
    generatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_user", ["userId"])
    .index("by_job_generated", ["jobId", "generatedAt"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION RUN DIFFS - Rerun change summaries for alerts
  // ═══════════════════════════════════════════════════════════════
  extractionRunDiffs: defineTable({
    jobId: v.id("extractionJobs"),
    baselineJobId: v.id("extractionJobs"),
    userId: v.id("users"),
    summary: v.object({
      newAnswers: v.number(),
      changedAnswers: v.number(),
      removedAnswers: v.number(),
      confidenceShifts: v.number(),
      newlyInsufficientEvidence: v.number(),
      totalCompared: v.number(),
    }),
    changes: v.array(
      v.object({
        openalexId: v.string(),
        title: v.string(),
        questionKey: v.string(),
        changeType: v.union(
          v.literal("new"),
          v.literal("changed"),
          v.literal("removed"),
          v.literal("confidence_shift"),
          v.literal("newly_insufficient_evidence")
        ),
        previousAnswer: v.optional(
          v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null())
        ),
        nextAnswer: v.optional(
          v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null())
        ),
        previousConfidence: v.optional(v.number()),
        nextConfidence: v.optional(v.number()),
      })
    ),
    generatedAt: v.number(),
    createdAt: v.number(),
    isTruncated: v.optional(v.boolean()),
    totalChanges: v.optional(v.number()),
  })
    .index("by_job", ["jobId"])
    .index("by_baseline", ["baselineJobId"])
    .index("by_job_generated", ["jobId", "generatedAt"]),

  // ═══════════════════════════════════════════════════════════════
  // SCREENING JOBS - bulk screening job records
  // ═══════════════════════════════════════════════════════════════
  screeningJobs: defineTable({
    userId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("failed"),
      v.literal("creditsExhausted")
    ),
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
    qualifiedPapers: v.number(),
    questions: v.array(
      v.object({ key: v.string(), question: v.string() })
    ),
    scoringConfig: v.object({
      rules: v.array(
        v.object({
          questionKey: v.string(),
          yesPoints: v.number(),
          noPoints: v.number(),
          nullPoints: v.number(),
        })
      ),
      starThresholds: v.array(
        v.object({
          minScore: v.number(),
          stars: v.number(),
        })
      ),
      minimumScore: v.optional(v.number()),
    }),
    targetCollectionId: v.optional(v.id("collections")),
    workflowId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_workflow", ["workflowId"]),

  // ═══════════════════════════════════════════════════════════════
  // SCREENING RESULTS - individual paper screening outcomes
  // ═══════════════════════════════════════════════════════════════
  screeningResults: defineTable({
    jobId: v.id("screeningJobs"),
    openalexId: v.string(),
    title: v.string(),
    abstract: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
    publicationYear: v.optional(v.number()),
    doi: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    answers: v.optional(
      v.record(v.string(), v.union(v.boolean(), v.null()))
    ),
    score: v.optional(v.number()),
    stars: v.optional(v.number()),
    qualified: v.optional(v.boolean()),
    aiMetadata: v.optional(
      v.object({
        reasoning: v.optional(v.string()),
        confidence: v.optional(v.number()),
        model: v.optional(v.string()),
        provider: v.optional(v.string()),
      })
    ),
    creditsUsed: v.optional(v.number()),
    savedToLibrary: v.optional(v.boolean()),
    libraryItemId: v.optional(v.id("libraryItems")),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_job", ["jobId"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_job_openalexId", ["jobId", "openalexId"]),

  // ═══════════════════════════════════════════════════════════════
  // LIBRARY ITEMS - User's saved paper library (rated papers)
  // ═══════════════════════════════════════════════════════════════
  libraryItems: defineTable({
    userId: v.id("users"),
    openalexId: v.string(), // e.g. "https://openalex.org/W1234567890"
    rating: v.number(), // 0-5
    title: v.string(),
    authors: v.optional(v.string()), // Flattened: "John Doe, Jane Smith"
    doi: v.optional(v.string()),
    abstract: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
    journal: v.optional(v.string()), // primary_location.source.display_name
    citedByCount: v.optional(v.number()),
    isOpenAccess: v.optional(v.boolean()),
    oaStatus: v.optional(v.string()), // "gold" | "green" | "bronze" | "hybrid" | "closed"
    paperData: v.optional(v.string()), // Full PaperResult JSON for rich card rendering
    searchableText: v.string(), // title + abstract + authors (for Phase 23 search index)
    savedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_openalexId", ["userId", "openalexId"])
    .index("by_user_rating", ["userId", "rating"])
    .index("by_user_savedAt", ["userId", "savedAt"])
    .index("by_user_year", ["userId", "publicationYear"])
    .index("by_user_citedByCount", ["userId", "citedByCount"])
    .index("by_user_title", ["userId", "title"])
    .searchIndex("search_library", {
      searchField: "searchableText",
      filterFields: ["userId", "rating"],
    }),

  // ═══════════════════════════════════════════════════════════════
  // COLLECTIONS - Named groups for organizing library items
  // ═══════════════════════════════════════════════════════════════
  collections: defineTable({
    userId: v.id("users"),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    itemCount: v.optional(v.number()),
  })
    .index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════
  // LIBRARY ITEM COLLECTIONS - Junction table for many-to-many
  // ═══════════════════════════════════════════════════════════════
  libraryItemCollections: defineTable({
    userId: v.id("users"),
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
    assignedAt: v.number(),
  })
    .index("by_collection", ["collectionId"])
    .index("by_item", ["libraryItemId"])
    .index("by_collection_item", ["collectionId", "libraryItemId"])
    .index("by_user", ["userId"]),
});
