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
    metadata: v.optional(v.record(v.string(), v.string())),
    stripeInvoiceId: v.optional(v.string()), // For idempotency
    createdAt: v.number(),
  })
    .index("by_credits", ["creditsId"])
    .index("by_stripe_invoice", ["stripeInvoiceId"])
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
  // ZOTERO INTEGRATION - OAuth connections (auth only)
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

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION JOBS - Data extraction from papers (Elicit-style)
  // ═══════════════════════════════════════════════════════════════
  extractionJobs: defineTable({
    userId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),

    // Source information
    sourceType: v.union(
      v.literal("history"),
      v.literal("zotero"),
      v.literal("manual")
    ),
    sourceHistoryId: v.optional(v.string()), // For history-based extractions
    sourceZoteroCollection: v.optional(v.string()), // For future Zotero import

    // Search reproduction data (when sourceType === "history")
    searchFilters: v.optional(v.record(v.string(), v.any())),

    // Job status
    status: v.union(
      v.literal("pending"),
      v.literal("downloading_pdfs"),
      v.literal("indexing"),
      v.literal("extracting"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),

    // Progress tracking
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),

    // Workflow tracking
    workflowId: v.optional(v.string()),

    // Metadata
    name: v.string(), // User-friendly job name
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_workflow", ["workflowId"]),

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

    // RAG indexing
    ragEntryId: v.optional(v.string()), // RAG component entry ID (actual entry ID from callback)
    isIndexed: v.optional(v.boolean()), // true when PDF was successfully indexed in RAG
    indexedAt: v.optional(v.number()),

    // Processing metadata
    workId: v.optional(v.string()), // Workpool work ID for tracking
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),

    // Cost tracking
    creditsUsed: v.optional(v.number()),

    // Content usage tracking
    pdfContentUsed: v.optional(v.boolean()), // true if PDF content was actually used for extraction (any question)
  })
    .index("by_job", ["jobId"])
    .index("by_job_processable", ["jobId", "processable"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_openalex", ["openalexId"])
    .index("by_work", ["workId"]),

  // ═══════════════════════════════════════════════════════════════
  // EXTRACTION RESULTS - Extracted data for each paper/question combo
  // ═══════════════════════════════════════════════════════════════
  extractionResults: defineTable({
    paperId: v.id("extractionPapers"),
    questionKey: v.string(),

    // Answer value (type depends on question type, null if not found)
    answer: v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()),

    // AI metadata
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    contextChunks: v.optional(v.array(v.string())), // RAG context used

    // Source tracking
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    pdfContentUsed: v.optional(v.boolean()), // Whether PDF content was actually used for this answer
    processedAt: v.number(),
  })
    .index("by_paper", ["paperId"])
    .index("by_paper_question", ["paperId", "questionKey"]),
});
