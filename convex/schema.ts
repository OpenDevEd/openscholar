import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { rateLimitTables } from "convex-helpers/server/rateLimit";

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
