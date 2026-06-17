import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { rateLimitTables } from "convex-helpers/server/rateLimit";
import {
  errorCodeValidator,
  extractionEvidenceUnitFields,
  extractionJobFields,
  extractionPaperErrorFields,
  extractionPaperFields,
  extractionPaperQueueFields,
  extractionQuestionFields,
  extractionResultFields,
  searchFiltersValidator,
} from "./extraction/validators";
import {
  chatGenerationUsageFields,
  chatPaperFields,
  creditsFields,
  creditTransactionFields,
  subscriptionFields,
  userFields,
} from "./lib/validators";

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
  // AI_MODEL_CONFIG - global curated model config: credit presets
  // (preset.fast/balanced/intelligent) + per-provider defaults
  // (default.openai/anthropic/google/openrouter). Decoupled from the
  // OpenRouter sync; mirrors the featureFlags key-keyed pattern.
  // ═══════════════════════════════════════════════════════════════
  aiModelConfig: defineTable({
    key: v.string(), // "preset.fast" | "preset.balanced" | "preset.intelligent" | "default.<provider>"
    modelId: v.string(), // model slug the key resolves to
    label: v.optional(v.string()),
    blurb: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // ═══════════════════════════════════════════════════════════════
  // USER_AI_CONFIG - per-user server-model choice (credits path).
  // serverModelId is sticky: only read when serverPreset === "custom",
  // and never cleared when switching to a named preset.
  // ═══════════════════════════════════════════════════════════════
  userAiConfig: defineTable({
    userId: v.id("users"),
    serverPreset: v.union(
      v.literal("fast"),
      v.literal("balanced"),
      v.literal("intelligent"),
      v.literal("custom"),
    ),
    serverModelId: v.optional(v.id("models")),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════
  // USERS - synced from Clerk, single source of truth in Convex
  // ═══════════════════════════════════════════════════════════════
  users: defineTable(userFields)
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_state", ["state"]),

  // ═══════════════════════════════════════════════════════════════
  // CREDITS - per-user credit balance
  // ═══════════════════════════════════════════════════════════════
  credits: defineTable(creditsFields).index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════
  // CREDIT_TRANSACTIONS - audit log for credit changes
  // ═══════════════════════════════════════════════════════════════
  creditTransactions: defineTable(creditTransactionFields)
    .index("by_credits", ["creditsId"])
    .index("by_stripe_invoice", ["stripeInvoiceId"])
    .index("by_stripe_payment_intent", ["stripePaymentIntentId"])
    .index("by_stripe_charge", ["stripeChargeId"])
    .index("by_stripe_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_user", ["userId"])
    .index("by_type_date", ["type", "createdAt"])
    // plan-04: per-job transaction ledger + breakdown queries.
    .index("by_job", ["jobId"])
    // billing-txn plan-01: user-scoped type filter for paginated ledger.
    .index("by_credits_type", ["creditsId", "type"])
    // billing-txn-perf plan-02: server-side narrowing for the filter
    // dropdowns. Trailing createdAt lets each index also satisfy the
    // date-range clause in one traversal.
    .index("by_credits_creditType", ["creditsId", "creditType", "createdAt"])
    .index("by_credits_billingType", ["creditsId", "billingType", "createdAt"])
    .index("by_credits_createdAt", ["creditsId", "createdAt"])
    // billing-txn-perf plan-02: full-text search across searchableText,
    // filter-narrowed by creditsId + the facet dimensions so the search
    // path stays user-scoped. Replaces the client-side substring scan.
    .searchIndex("search_transactions", {
      searchField: "searchableText",
      filterFields: ["creditsId", "type", "billingType", "creditType"],
    }),

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS - Stripe billing integration ready
  // ═══════════════════════════════════════════════════════════════
  subscriptions: defineTable(subscriptionFields)
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
  //
  // Field-object SSOT lives in convex/extraction/validators.ts as
  // `extractionJobFields`; spread there into the row-mirror validator
  // and here into `defineTable(...)`. Drift fails compile-time via
  // `AssertExactDoc<"extractionJobs", ...>`.
  // ═══════════════════════════════════════════════════════════════
  extractionJobs: defineTable(extractionJobFields)
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    // Unified history list + single-mode scoping (count user's chats).
    .index("by_user_mode_updated", ["userId", "mode", "updatedAt"])
    // Cross-user iteration by mode (admin backfills, ops tooling).
    .index("by_mode", ["mode"])
    // Reverse lookup: thread -> job (auth + lock acquisition).
    .index("by_chatThread", ["chatThreadId"]),

  // ═══════════════════════════════════════════════════════════════
  // CHAT GENERATION USAGE - Provider-authoritative chat billing ledger
  // ═══════════════════════════════════════════════════════════════
  chatGenerationUsages: defineTable(chatGenerationUsageFields)
    .index("by_generation_id", ["generationId"])
    .index("by_job", ["jobId"])
    .index("by_thread", ["threadId"])
    .index("by_status_and_next_retry", ["status", "nextRetryAt"])
    .index("by_user_and_createdAt", ["userId", "createdAt"]),

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
    // Per-paper signals surfaced to the chat-mode AI context. Optional
    // because non-OpenAlex sources (zotero/upload) cannot populate them.
    citedByCount: v.optional(v.number()),
    venueName: v.optional(v.string()), // primary_location.source.display_name
    workType: v.optional(v.string()),
    // history: saved-search placeholder that expands during queue setup
    searchFilters: v.optional(searchFiltersValidator),
    // zotero context (libraryType/groupId resolve the OAuth target at queue setup)
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
  chatPapers: defineTable(chatPaperFields)
    .index("by_job", ["jobId"])
    .index("by_job_included", ["jobId", "included"])
    .index("by_job_source", ["jobId", "sourceId"])
    .index("by_source", ["sourceId"]),

  // ═══════════════════════════════════════════════════════════════
  // CHAT SOURCE EVENTS - app-owned timeline boundaries.
  // Inserted when a Continue Chat source refresh changes the ordered
  // OpenAlex id set. The UI uses boundaryOrder to render all earlier
  // assistant citations as historical/deprecated.
  // ═══════════════════════════════════════════════════════════════
  chatSourceEvents: defineTable({
    jobId: v.id("extractionJobs"),
    threadId: v.string(),
    kind: v.literal("sources_updated"),
    boundaryOrder: v.number(),
    createdAt: v.number(),
  })
    .index("by_job_createdAt", ["jobId", "createdAt"])
    .index("by_thread_createdAt", ["threadId", "createdAt"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION QUESTIONS - User-defined questions for data extraction
  //
  // Field-object SSOT: `extractionQuestionFields` in
  // convex/extraction/validators.ts. The `type` union pulls the
  // existing `questionTypeValidator` rather than re-declaring inline.
  // ═══════════════════════════════════════════════════════════════
  extractionQuestions: defineTable(extractionQuestionFields)
    .index("by_job", ["jobId"])
    .index("by_job_key", ["jobId", "key"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION PAPERS - Individual papers being processed
  // ═══════════════════════════════════════════════════════════════
  extractionPapers: defineTable(extractionPaperFields)
    .index("by_job", ["jobId"])
    .index("by_job_processable", ["jobId", "processable"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_openalex", ["openalexId"])
    .index("by_work", ["workId"])
    .index("by_status_completedAt", ["status", "completedAt"])
    .index("by_ragEntryId_isIndexed", ["ragEntryId", "isIndexed"])
    .searchIndex("search_by_job_text", {
      searchField: "searchText",
      filterFields: ["jobId", "processable"],
    }),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION PAPER ERRORS - Append-only failure history per paper
  //
  // One row inserted on every terminal failure (download, indexing, or
  // extraction). Lets us paginate the full retry trail per paper and
  // diagnose flaky upstream behavior without bloating extractionPapers.
  // Plan-01 § "Persistence hooks".
  // ═══════════════════════════════════════════════════════════════
  extractionPaperErrors: defineTable(extractionPaperErrorFields)
    .index("by_paper", ["paperId"])
    .index("by_job", ["jobId"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION PAPER QUEUE - App-owned execution state for paper work
  // ═══════════════════════════════════════════════════════════════
  extractionPaperQueue: defineTable(extractionPaperQueueFields)
    .index("by_job_and_status", ["jobId", "status"])
    .index("by_job_and_epoch_and_status", ["jobId", "runEpoch", "status"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_job_and_epoch_and_status_and_priority_and_createdAt", [
      "jobId",
      "runEpoch",
      "status",
      "priority",
      "createdAt",
    ])
    .index("by_paper_and_epoch_and_kind", ["paperId", "runEpoch", "kind"])
    .index("by_status_and_priority", ["status", "priority"])
    .index("by_work", ["workId"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION EVIDENCE UNITS - Anchored sentence evidence (V3)
  // ═══════════════════════════════════════════════════════════════
  extractionEvidenceUnits: defineTable(extractionEvidenceUnitFields)
    .index("by_paper", ["paperId"])
    .index("by_paper_evidence", ["paperId", "evidenceId"])
    .index("by_paper_page", ["paperId", "page"])
    .index("by_job", ["jobId"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION RESULTS - Extracted data for each paper/question combo
  //
  // Field-object SSOT lives in convex/extraction/validators.ts as
  // `extractionResultFields`. Inline citation / retrievalDiagnostics
  // shapes that used to be duplicated here are now sourced from the
  // named `citationValidator` / `retrievalDiagnosticsValidator`
  // validators via the field object.
  // ═══════════════════════════════════════════════════════════════
  extractionResults: defineTable(extractionResultFields)
    .index("by_paper", ["paperId"])
    .index("by_paper_question", ["paperId", "questionKey"])
    .index("by_job", ["jobId"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_job_question", ["jobId", "questionKey"]),

  // ═══════════════════════════════════════════════════════════════
  // SCREENING JOBS - bulk screening job records
  // ═══════════════════════════════════════════════════════════════
  screeningJobs: defineTable({
    userId: v.id("users"),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("failed"),
      v.literal("creditsExhausted")
    ),
    totalPapers: v.number(),
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
    // Resolved per-user server model for this bulk screening run (credits path).
    serverModelId: v.optional(v.id("models")),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"]),

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
    workId: v.optional(v.string()),
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
    workType: v.optional(v.string()), // OpenAlex `type` — "article" | "review" | "book-chapter" | ...
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

  // ═══════════════════════════════════════════════════════════════
  // USER RESOURCE LOCKS - Per-user concurrency gate for interactive
  // batch AI actions (batch screening, batch translation). One row
  // per active acquisition; deleted on release; GC'd ad-hoc on the
  // next acquire of the same (userId, kind). TTL is 10 minutes —
  // long enough for the longest realistic batch, short enough that a
  // hung action self-recovers within a session. The `kind`
  // discriminator ships as a closed two-literal union from day one:
  // future kinds widen the union explicitly, never via v.string().
  // ═══════════════════════════════════════════════════════════════
  userResourceLocks: defineTable({
    userId: v.id("users"),
    kind: v.union(
      v.literal("batch_screening"),
      v.literal("batch_translation"),
    ),
    acquiredAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_user_kind", ["userId", "kind"])
    .index("by_user_kind_expires", ["userId", "kind", "expiresAt"]),
}, {
  schemaValidation: false,
});
