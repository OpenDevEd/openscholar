import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ═══════════════════════════════════════════════════════════════
  // USERS - synced from WorkOS, single source of truth in Convex
  // ═══════════════════════════════════════════════════════════════
  users: defineTable({
    workosId: v.string(),
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
  })
    .index("by_workos_id", ["workosId"])
    .index("by_email", ["email"])
    .index("by_state", ["state"]),

  // ═══════════════════════════════════════════════════════════════
  // ORGANIZATIONS - synced from WorkOS
  // ═══════════════════════════════════════════════════════════════
  organizations: defineTable({
    workosId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    settings: v.optional(
      v.object({
        allowByok: v.optional(v.boolean()),
        creditPooling: v.optional(v.boolean()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workos_id", ["workosId"])
    .index("by_slug", ["slug"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  // ═══════════════════════════════════════════════════════════════
  // MEMBERSHIPS - user ↔ organization join table with roles
  // ═══════════════════════════════════════════════════════════════
  memberships: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    permissions: v.array(v.string()),
    joinedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_organization", ["organizationId"])
    .index("by_user_org", ["userId", "organizationId"]),

  // ═══════════════════════════════════════════════════════════════
  // CREDITS - per-user or per-org credit balance (dual system)
  // Free credits: from subscriptions, capped at 10k
  // Paid credits: from purchases, no cap
  // ═══════════════════════════════════════════════════════════════
  credits: defineTable({
    ownerId: v.string(), // Store as string for flexibility
    ownerType: v.union(v.literal("user"), v.literal("organization")),
    freeBalance: v.number(), // From subscriptions, capped at 10k
    paidBalance: v.number(), // From purchases, no cap
    lifetimeUsed: v.number(),
    lastUpdatedAt: v.number(),
  }).index("by_owner", ["ownerId", "ownerType"]),

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
    metadata: v.optional(v.record(v.string(), v.string())), // Use specific validator instead of any
    stripeInvoiceId: v.optional(v.string()), // For idempotency
    createdAt: v.number(),
  })
    .index("by_credits", ["creditsId"])
    .index("by_stripe_invoice", ["stripeInvoiceId"]) // Index for idempotency checks
    .index("by_user", ["userId"])
    .index("by_type_date", ["type", "createdAt"]),

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS - Stripe billing integration ready
  // ═══════════════════════════════════════════════════════════════
  subscriptions: defineTable({
    ownerId: v.string(),
    ownerType: v.union(v.literal("user"), v.literal("organization")),
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
      v.literal("trialing")
    ),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    canceledAt: v.optional(v.number()),
    creditsPerMonth: v.optional(v.number()),
    seats: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId", "ownerType"])
    .index("by_stripe_sub", ["stripeSubscriptionId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_status", ["status"]),

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
  // USAGE LOGS - AI token usage tracking
  // ═══════════════════════════════════════════════════════════════
  usageLogs: defineTable({
    userId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costCredits: v.number(),
    featureId: v.optional(v.string()),
    keySource: v.union(v.literal("platform"), v.literal("byok")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["organizationId"])
    .index("by_user_date", ["userId", "createdAt"])
    .index("by_org_date", ["organizationId", "createdAt"]),

  // ═══════════════════════════════════════════════════════════════
  // DATA EXTRACTION - Analyses, sources, documents, results
  // ═══════════════════════════════════════════════════════════════

  analyses: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    extractionQuestions: v.array(
      v.object({
        id: v.string(),
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("text"),
          v.literal("number"),
          v.literal("boolean")
        ),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"]),

  analysisSources: defineTable({
    analysisId: v.id("analyses"),
    sourceType: v.union(
      v.literal("search_history"),
      v.literal("zotero"),
      v.literal("upload"),
      v.literal("manual")
    ),
    sourceRef: v.string(),
    sourceMeta: v.optional(
      v.object({
        query: v.optional(v.string()),
        count: v.optional(v.number()),
        name: v.optional(v.string()),
      })
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("importing"),
      v.literal("ready"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
    documentCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_analysis", ["analysisId"])
    .index("by_status", ["status"]),

  documents: defineTable({
    analysisId: v.id("analyses"),
    sourceId: v.id("analysisSources"),
    externalId: v.string(),
    title: v.string(),
    abstract: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
    year: v.optional(v.number()),
    doi: v.optional(v.string()),
    openAccessUrl: v.optional(v.string()), // URL to open access PDF
    pdfStorageId: v.optional(v.id("_storage")),
    fullText: v.optional(v.string()),
    // PDF page boundaries for citation tracking
    pdfPages: v.optional(
      v.array(
        v.object({
          pageNumber: v.number(),
          startChar: v.number(),
          endChar: v.number(),
        })
      )
    ),
    // RAG indexing
    ragEntryId: v.optional(v.string()), // RAG component entry ID
    ragIndexedAt: v.optional(v.number()), // When content was indexed
    processingStatus: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("error")
    ),
    createdAt: v.number(),
  })
    .index("by_analysis", ["analysisId"])
    .index("by_source", ["sourceId"])
    .index("by_external_id", ["externalId"]),

  extractionResults: defineTable({
    documentId: v.id("documents"),
    analysisId: v.id("analyses"),
    questionId: v.string(),
    value: v.union(v.string(), v.number(), v.boolean(), v.null()),
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    // Citation sources for this extraction
    sources: v.optional(
      v.array(
        v.object({
          quote: v.string(), // Exact text snippet (max ~200 chars)
          sourceType: v.union(v.literal("abstract"), v.literal("pdf")),
          pageNumber: v.optional(v.number()), // Only for PDF sources
          startChar: v.number(), // Character start in source
          endChar: v.number(), // Character end in source
        })
      )
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_analysis", ["analysisId"])
    .index("by_analysis_question", ["analysisId", "questionId"]),

  // ═══════════════════════════════════════════════════════════════
  // UNIVERSAL JOB SYSTEM
  // Robust, type-safe job processing with watchdog recovery
  // ═══════════════════════════════════════════════════════════════

  jobs: defineTable({
    // Identity
    type: v.union(
      v.literal("pdf_download"),
      v.literal("rag_indexing"),
      v.literal("extraction")
    ),
    analysisId: v.id("analyses"),
    userId: v.optional(v.id("users")), // For credit tracking (extraction)

    // Status
    status: v.union(
      v.literal("pending"), // Waiting for dependency
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),

    // Configuration
    concurrencyLimit: v.number(),
    itemTimeoutMs: v.number(), // Default: 2 min
    jobTimeoutMs: v.number(), // Default: 30 min
    maxAttempts: v.number(), // Default: 3

    // Counters
    totalItems: v.number(),
    processed: v.number(),
    succeeded: v.number(),
    failed: v.number(),
    skipped: v.number(),

    // Dependency chain
    dependsOn: v.optional(v.id("jobs")), // Parent job that must complete first
    chainId: v.optional(v.string()), // Groups jobs in a chain
    chainPosition: v.optional(v.number()), // Order in chain

    // Timestamps
    startedAt: v.number(),
    lastActivityAt: v.number(),
    completedAt: v.optional(v.number()),

    // Metadata (job-type-specific config)
    metadata: v.optional(v.any()),

    // Error tracking (last 100 errors)
    errors: v.array(v.string()),
  })
    .index("by_analysis", ["analysisId"])
    .index("by_status", ["status"])
    .index("by_type_status", ["type", "status"])
    .index("by_depends_on", ["dependsOn"])
    .index("by_chain", ["chainId"]),

  jobItems: defineTable({
    jobId: v.id("jobs"),
    index: v.number(), // Position in job for ordering

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("skipped")
    ),

    // Payload - type-safe discriminated union
    payload: v.union(
      v.object({
        type: v.literal("pdf_download"),
        documentId: v.id("documents"),
      }),
      v.object({
        type: v.literal("rag_indexing"),
        documentId: v.id("documents"),
      }),
      v.object({
        type: v.literal("extraction"),
        documentId: v.id("documents"),
        questionId: v.string(),
      })
    ),

    // Tracking
    attempts: v.number(),
    claimedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),

    // Result summary (not full data, just references)
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  })
    .index("by_job", ["jobId"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_job_index", ["jobId", "index"]),

  // ═══════════════════════════════════════════════════════════════
  // ZOTERO INTEGRATION - OAuth connections
  // ═══════════════════════════════════════════════════════════════

  zoteroConnections: defineTable({
    userId: v.id("users"),
    zoteroUserId: v.string(),
    apiKey: v.string(),
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
    .index("by_user", ["userId"]),
});
