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
    pdfStorageId: v.optional(v.id("_storage")),
    fullText: v.optional(v.string()),
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
});
