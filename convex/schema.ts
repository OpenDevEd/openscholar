import { defineSchema, defineTable } from "convex/server";
import { exportFormatValidator, exportSourceValidator } from "./exportValidators";
import { libraryItemFields, removedItemValidator } from "./library/validators";
import { MAX_COLLECTIONS_PER_USER } from "./lib/queryBounds";
import { v } from "convex/values";
import { rateLimitTables } from "convex-helpers/server/rateLimit";
import {
  MAX_AUTHORS, MAX_COUNT_BUCKETS, MAX_METADATA_FIELDS, MAX_QUESTIONS,
  MAX_TOPIC_KEYWORDS, capped,
} from "./lib/listCaps";
import { screeningAnswersValidator, paperSetValidator, screeningAuthorsValidator, screeningOutcomeValidator, screeningQuestionsValidator, screeningScoringConfigValidator, screeningTalliesValidator } from "./screening/validators";
import { searchSnapshotValidator } from "./paperSets/openalex";
import {
  errorCodeValidator,
  extractionEvidenceUnitFields,
  extractionJobFields,
  extractionPaperErrorFields,
  extractionPaperFields,
  extractionPaperQueueFields,
  extractionQuestionFields,
  extractionResultFields,
  storedSearchFiltersValidator,
} from "./extraction/validators";
import {
  chatGenerationUsageFields,
  chatPaperFields,
  creditsFields,
  creditTransactionFields,
  subscriptionFields,
  userFields,
} from "./lib/validators";
import {
  clerkEventLogFields,
  evidenceLibraryReaderDeletionFields,
  evidenceLibraryOAuthClientFields,
  clerkDeletedUserFields,
  evidenceLibraryConfigDraftFields,
  evidenceLibraryConfigRevisionFields,
  evidenceLibraryConfigSectionValidator,
  evidenceLibraryCredentialFields,
  evidenceLibraryDigestJobFields,
  evidenceLibraryDomainFields,
  evidenceLibraryDomainRouteLeaseFields,
  evidenceLibraryFields,
  evidenceLibraryOperationFields,
  evidenceLibraryRuntimeBindingValidator,
  evidenceLibraryRuntimeReleaseFields,
  organizationFields,
  organizationMembershipFields,
} from "./evidenceLibraries/validators";
import { evidenceLibraryZoteroGroupFields } from "./zotero/libraryGroupValidators";
import { evidenceLibraryCollectionSourceFields } from "./evidenceLibraries/collectionSourceValidators";
import { evidenceLibrarySourceStatusFields } from "./evidenceLibraries/sourceStatusValidators";

import { authorContentFields } from "./authors/validators";

import { topicNodeFields, metadataValidator, recordTopicIdsValidator } from "./topics/validators";
import { billingAccountFields, billingCatalogValidator, billingUsageFields } from "./billing/validators";
import { assistantThreadAccessFields, assistantThreadFields, assistantStepFields } from "./assistant/validators";
import { customPicksValidator, effortValidator, modelChoiceValidator, modelEffortsValidator, modelModalitiesValidator, modelParametersValidator } from "./aiModelConfig/validators";
import { fieldValidator, paperAnswersValidator, removalsValidator, shortcutValidator, ratingValidator, storedSearchValidator } from "../lib/research/records";

export default defineSchema({
  searches: defineTable({ userId: v.id("users"), localId: v.string(), revision: v.number(), data: storedSearchValidator })
    .index("by_user", ["userId"])
    .index("by_user_and_createdAt", ["userId", "data.createdAt"])
    .index("by_user_and_count", ["userId", "data.count"])
    .index("by_user_and_localId", ["userId", "localId"]),
  // How many saved searches, shortcuts and screening jobs a person has, kept by the triggers on those tables
  // (research/recordCounts.ts), for page totals. While a first count is being taken,
  // `countedTo` is the creation time it has reached.
  recordCounts: defineTable({ userId: v.id("users"), table: v.union(v.literal("searches"), v.literal("queryShortcuts"), v.literal("screeningJobs"), v.literal("extractionJobs")), count: v.number(), countedTo: v.optional(v.number()) })
    .index("by_user_and_table", ["userId", "table"]),
  searchRevisions: defineTable({
    userId: v.id("users"), searchId: v.id("searches"), revision: v.number(),
    author: v.union(v.literal("user"), v.literal("assistant")),
    data: storedSearchValidator, deleted: v.boolean(), createdAt: v.number(),
    // The screening version this revision saw; its answers are the history up to it.
    answersVersion: v.optional(v.number()),
  }).index("by_search_and_revision", ["searchId", "revision"]),
  // A search's earlier queries and research questions, in the order they were made (#354).
  searchHistory: defineTable({
    userId: v.id("users"), searchId: v.id("searches"), kind: v.union(v.literal("query"), v.literal("question")),
    text: v.string(), field: v.optional(fieldValidator), timestamp: v.string(), position: v.number(),
  }).index("by_search_and_kind_and_position", ["searchId", "kind", "position"])
    .index("by_search_and_kind_and_timestamp", ["searchId", "kind", "timestamp"]),
  // A screening's answers, one row per paper, and an append-only history of each paper's
  // answers that old revisions are rebuilt from. A saved search has one screening, which its
  // page and its Screen all jobs both answer into; a Screen all job run before #334 has its
  // own, with no search. `version` counts the writes to its answers, so a revision finds its
  // answers exactly.
  screenings: defineTable({ userId: v.id("users"), searchId: v.optional(v.id("searches")), version: v.number(), createdAt: v.number(), removals: removalsValidator })
    .index("by_search", ["searchId"]),
  // `version`: the screening's when the row was last written; a row from before this was kept owes every removal.
  screeningAnswers: defineTable({ screeningId: v.id("screenings"), paperId: v.string(), answers: paperAnswersValidator, version: v.optional(v.number()) })
    .index("by_screening_and_paper", ["screeningId", "paperId"]),
  // A paper's answers after each change; an empty list means its answers were removed.
  screeningAnswerHistory: defineTable({ screeningId: v.id("screenings"), paperId: v.string(), answers: paperAnswersValidator, version: v.number(), at: v.number() })
    .index("by_screening_and_version", ["screeningId", "version"])
    // A paper's answers as of a version: what a Screen all job answered, for its export.
    .index("by_screening_and_paper_and_version", ["screeningId", "paperId", "version"]),
  // `sortName` is the name as the Bookmarks page orders it (lower case); optional until migrations/pagedRecords has run.
  queryShortcuts: defineTable({ userId: v.id("users"), data: shortcutValidator, sortName: v.optional(v.string()) })
    .index("by_user_and_createdAt", ["userId", "data.createdAt"])
    .index("by_user_and_sortName", ["userId", "sortName"])
    .index("by_user", ["userId"])
    .index("by_user_and_shorthand", ["userId", "data.shorthand"]),
  paperRatings: defineTable({ userId: v.id("users"), data: ratingValidator })
    .index("by_user", ["userId"])
    .index("by_user_and_paperId", ["userId", "data.paperId"]),
  researchReceipts: defineTable({ userId: v.id("users"), key: v.string(), fingerprint: v.optional(v.string()) })
    .index("by_user_and_key", ["userId", "key"]),
  topicCatalog: defineTable(topicNodeFields)
    .index("by_external_id", ["id"]).index("by_parent_and_name", ["parent", "name"])
    .searchIndex("search_text", { searchField: "searchText" }),
  topicCatalogState: defineTable({revision: v.string(), complete: v.boolean()}).index("by_revision", ["revision"]),
  // `refreshRequestedAt`: when a reader last asked for this stale topic to be fetched again (#355).
  topicDetails: defineTable({id: v.string(), description: v.string(), keywords: capped(v.array(v.string()), MAX_TOPIC_KEYWORDS), worksCount: v.number(), fetchedAt: v.number(), revision: v.string(), refreshRequestedAt: v.optional(v.number())}).index("by_external_id", ["id"]),
  topicLocations: defineTable({
    libraryId: v.id("evidenceLibraries"), itemKey: v.string(), generation: v.number(), publishedRevision: v.number(),
    state: v.union(v.literal("published"), v.literal("unpublished")),
    topicIds: recordTopicIdsValidator, doi: v.union(v.string(), v.null()), openalexId: v.union(v.string(), v.null()),
    metadata: v.union(metadataValidator, v.null()), groupKey: v.string(),
  }).index("by_libraryId_and_itemKey", ["libraryId", "itemKey"])
    .index("by_openalexId_and_doi", ["openalexId", "doi"])
    .index("by_groupKey_and_libraryId_and_itemKey", ["groupKey", "libraryId", "itemKey"]),
  topicDeliveryReceipts: defineTable({libraryId: v.id("evidenceLibraries"), idempotencyKey: v.string(), digest: v.string(), generation: v.number(), status: v.union(v.literal("applied"), v.literal("superseded"))})
    .index("by_libraryId_and_idempotencyKey", ["libraryId", "idempotencyKey"]),
  topicOpenAlexDois: defineTable({openalexId: v.string(), doi: v.string(), count: v.number()})
    .index("by_openalexId_and_doi", ["openalexId", "doi"]),
  topicPublicationGroups: defineTable({topicId: v.string(), groupKey: v.string(), count: v.number()})
    .index("by_topicId_and_groupKey", ["topicId", "groupKey"]),
  topicProjectionState: defineTable({key: v.literal("publications"), pending: v.number()}).index("by_key", ["key"]),

  authorPublicationReceipts: defineTable({
    libraryId: v.id("evidenceLibraries"),
    itemKey: v.string(),
    revision: v.number(),
  }).index("by_libraryId_and_itemKey", ["libraryId", "itemKey"]),

  authorPublications: defineTable({
    profileId: v.id("authorProfiles"),
    libraryId: v.id("evidenceLibraries"),
    itemKey: v.string(),
    rank: v.optional(v.number()),
  }).index("by_profileId", ["profileId"])
    .index("by_profileId_and_rank", ["profileId", "rank"])
    .index("by_libraryId_and_itemKey", ["libraryId", "itemKey"]),

  authorProfiles: defineTable({
    ...authorContentFields,
    ownerId: v.id("users"),
    photoId: v.optional(v.id("_storage")),
    revision: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerId", ["ownerId"])
    .searchIndex("search_name", {searchField: "name"}),

  authorProfileMembers: defineTable({
    profileId: v.id("authorProfiles"),
    userId: v.id("users"),
  }).index("by_profileId_and_userId", ["profileId", "userId"])
    .index("by_userId", ["userId"]),

  authorProfileInvitations: defineTable({
    profileId: v.id("authorProfiles"),
    email: v.string(),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    state: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("cancelled"), v.literal("expired")),
    delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")),
  }).index("by_profileId_and_email", ["profileId", "email"])
    .index("by_email_and_state", ["email", "state"]),

  clerkEventLogs: defineTable(clerkEventLogFields)
    .index("by_instanceId_and_eventId", ["instanceId", "eventId"])
    .index("by_entity_outcome_time_and_eventId", [
      "instanceId",
      "entityType",
      "entityId",
      "outcome",
      "occurredAt",
      "eventId",
    ]),

  organizations: defineTable(organizationFields)
    .index("by_clerkOrganizationId", ["clerkOrganizationId"])
    .index("by_slug", ["slug"])
    .index("by_state", ["state"]),

  organizationMemberships: defineTable(organizationMembershipFields)
    .index("by_clerkMembershipId", ["clerkMembershipId"])
    .index("by_organizationId_and_clerkUserId_and_state", [
      "organizationId",
      "clerkUserId",
      "state",
    ])
    .index("by_organizationId_and_state", ["organizationId", "state"])
    .index("by_clerkUserId_and_state", ["clerkUserId", "state"]),

  // ═══════════════════════════════════════════════════════════════
  // ASSISTANT CHATS (#324) - a chat, and who it is shared with
  // ═══════════════════════════════════════════════════════════════
  assistantThreads: defineTable(assistantThreadFields)
    .index("by_agentThreadId", ["agentThreadId"])
    // An account's chats, for deleting them with it.
    .index("by_owner", ["ownerId"])
    // The replies being written for a person, which are limited.
    .index("by_replySender", ["reply.senderId"])
    // Every chat writing a reply, oldest first, for releasing the ones whose action died.
    .index("by_replyStartedAt", ["reply.startedAt"]),
  // The actions a chat's replies ran, each found by the model's ID for the call.
  assistantSteps: defineTable(assistantStepFields).index("by_thread_and_toolCallId", ["threadId", "toolCallId"]),
  assistantThreadAccess: defineTable(assistantThreadAccessFields)
    // A person's chats, newest first, through each of their principals.
    .index("by_principal_and_lastMessageAt", ["principal", "lastMessageAt"])
    .index("by_thread_and_principal", ["threadId", "principal"]),

  // Each approved OpenAlex query version a library has published, with its query's
  // fingerprint, so a sources save checks versions without reading every revision (#357).
  evidenceLibraryApprovedQueries: defineTable({ libraryId: v.id("evidenceLibraries"), version: v.string(), fingerprint: v.string() })
    .index("by_libraryId_and_version", ["libraryId", "version"]),
  evidenceLibraries: defineTable(evidenceLibraryFields)
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_name_and_state", [
      "organizationId",
      "name",
      "state",
    ])
    .index("by_organizationId_and_slug", ["organizationId", "slug"])
    .index("by_organizationId_and_state", ["organizationId", "state"]),

  evidenceLibraryInvitations: defineTable({
    libraryId: v.id("evidenceLibraries"),
    email: v.string(),
    role: v.union(v.literal("editor"), v.literal("creator")),
    invitedBy: v.string(),
    expiresAt: v.number(),
    state: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("cancelled"), v.literal("expired")),
    delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")),
  }).index("by_libraryId_and_email_and_state", ["libraryId", "email", "state"])
    .index("by_libraryId_and_state", ["libraryId", "state"])
    .index("by_email_and_state", ["email", "state"]),

  evidenceLibraryMembers: defineTable({
    libraryId: v.id("evidenceLibraries"),
    clerkUserId: v.string(),
    role: v.union(v.literal("editor"), v.literal("creator")),
    grantedBy: v.string(),
    grantedAt: v.number(),
  })
    .index("by_libraryId_and_clerkUserId", ["libraryId", "clerkUserId"])
    .index("by_clerkUserId", ["clerkUserId"]),

  evidenceLibraryConfigDrafts: defineTable(evidenceLibraryConfigDraftFields)
    .index("by_libraryId", ["libraryId"])
    .index("by_ownerConfigurationVersion", ["ownerConfigurationVersion"]),

  evidenceLibraryConfigRevisions: defineTable(
    evidenceLibraryConfigRevisionFields,
  )
    .index("by_libraryId_and_revisionKey", ["libraryId", "revisionKey"])
    .index("by_libraryId_and_revisionNumber", ["libraryId", "revisionNumber"])
    .index("by_ownerConfigurationVersion", ["ownerConfigurationVersion"]),

  evidenceLibraryConfigSections: defineTable(
    evidenceLibraryConfigSectionValidator,
  )
    .index("by_draftId_and_sectionKey", ["draftId", "sectionKey"])
    .index("by_revisionId_and_sectionKey", ["revisionId", "sectionKey"])
    .index("by_libraryId_and_kind_and_sectionKey", [
      "libraryId",
      "kind",
      "sectionKey",
    ]),

  evidenceLibraryCredentials: defineTable(evidenceLibraryCredentialFields)
    .index("by_credentialDigest", ["credentialDigest"])
    .index("by_libraryId", ["libraryId"])
    .index("by_libraryId_and_credentialKey", ["libraryId", "credentialKey"]),

  evidenceLibraryRuntimeBindings: defineTable(
    evidenceLibraryRuntimeBindingValidator,
  )
    .index("by_libraryId", ["libraryId"])
    .index("by_targetRuntimeId", ["targetRuntimeId"])
    .index("by_targetBaseUrl", ["targetBaseUrl"])
    .index("by_state", ["state"]),

  // One row per custom domain. `by_host` is the platform-wide claim: no two
  // libraries may hold the same name.
  evidenceLibraryDomains: defineTable(evidenceLibraryDomainFields)
    .index("by_host", ["host"])
    .index("by_libraryId", ["libraryId"])
    // The sweep walks working domains oldest check first, so none starves.
    .index("by_state_and_checkedAt", ["state", "checkedAt"]),

  clerkDeletedUsers: defineTable(clerkDeletedUserFields).index("by_clerkId", ["clerkId"]),

  // One row per library: its Clerk OAuth application.
  evidenceLibraryOAuthClients: defineTable(evidenceLibraryOAuthClientFields)
    .index("by_libraryId", ["libraryId"]),

  // Reader data a library still has to drop for a deleted OpenScholar account.
  evidenceLibraryReaderDeletions: defineTable(evidenceLibraryReaderDeletionFields)
    .index("by_libraryId", ["libraryId"])
    .index("by_libraryId_and_clerkUserId", ["libraryId", "clerkUserId"]),

  evidenceLibraryDomainRouteLeases: defineTable(
    evidenceLibraryDomainRouteLeaseFields,
  ).index("by_libraryId", ["libraryId"]),

  evidenceLibraryRuntimeReleases: defineTable(
    evidenceLibraryRuntimeReleaseFields,
  ).index("by_running", ["running"]),

  // One digest written for a library edition. The library polls until the
  // result is ready; the row expires a day after it was started.
  evidenceLibraryDigestJobs: defineTable(evidenceLibraryDigestJobFields).index(
    "by_libraryId_and_editionId",
    ["libraryId", "editionId"],
  ),

  // Rewritten every few seconds while a library imports, so it has its own table.
  evidenceLibrarySourceStatus: defineTable(evidenceLibrarySourceStatusFields).index(
    "by_libraryId",
    ["libraryId"],
  ),

  evidenceLibraryZoteroGroups: defineTable(evidenceLibraryZoteroGroupFields)
    .index("by_libraryId", ["libraryId"])
    .index("by_libraryId_and_groupId", ["libraryId", "groupId"]),

  evidenceLibraryCollectionSources: defineTable(evidenceLibraryCollectionSourceFields)
    .index("by_libraryId_and_collectionId", ["libraryId", "collectionId"]),

  // The hosts Coolify served when it was last asked: one row per host per listing, and the
  // current listing. `listing` is a refresh's own ID; `startedAt`, when it began, orders
  // refreshes and ages the cache. Rows of older or discarded listings are pruned.
  evidenceLibraryServedHostRows: defineTable({ listing: v.string(), host: v.string(), startedAt: v.number() })
    .index("by_listing_and_host", ["listing", "host"])
    .index("by_startedAt", ["startedAt"]),
  evidenceLibraryServedHostsListing: defineTable({ source: v.literal("coolify"), listing: v.string(), startedAt: v.number() })
    .index("by_source", ["source"]),

  evidenceLibraryConfigOperations: defineTable(evidenceLibraryOperationFields)
    .index("by_libraryId_and_idempotencyKey", ["libraryId", "idempotencyKey"])
    .index("by_libraryId_and_activationEditVersion", [
      "libraryId",
      "activationEditVersion",
    ])
    .index("by_libraryId_and_createdAt", ["libraryId", "createdAt"])
    // Publish operations newest first, where configuration deployments are found (#357).
    .index("by_libraryId_and_kind_and_createdAt", ["libraryId", "kind", "createdAt"])
    // Queued work that already ran, which blocks a teardown (#357).
    .index("by_libraryId_and_status_and_attemptCount", ["libraryId", "status", "attemptCount"])
    .index("by_libraryId_and_status_and_startedAt", ["libraryId", "status", "startedAt"])
    .index("by_libraryId_and_status_and_updatedAt", [
      "libraryId",
      "status",
      "updatedAt",
    ])
    // The queued or running operations of one kind, which the guards ask about (#427).
    .index("by_libraryId_and_status_and_kind", ["libraryId", "status", "kind"])
    .index("by_libraryId_and_failed_runtime", [
      "libraryId",
      "status",
      "runtimeUpdate.to",
      "runtimeUpdate.toImage",
    ]),

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
    inputModalities: modelModalitiesValidator,
    outputModalities: modelModalitiesValidator,
    tokenizer: v.optional(v.string()),
    instructType: v.optional(v.string()),

    // ── Pricing (USD per million tokens) ──
    inputPricePerMillion: v.number(),
    outputPricePerMillion: v.number(),
    cacheReadPricePerMillion: v.optional(v.number()),
    cacheWritePricePerMillion: v.optional(v.number()),
    reasoningPricePerMillion: v.optional(v.number()),
    // Cleared by migrations/clearModelWebSearchPrice; drop once it has run everywhere.
    webSearchPrice: v.optional(v.number()),
    imagePricePerMillion: v.optional(v.number()),
    audioPricePerMillion: v.optional(v.number()),

    // ── Context & Limits ──
    contextLength: v.optional(v.number()),
    maxCompletionTokens: v.optional(v.number()),
    isModerated: v.optional(v.boolean()),

    // ── Capabilities ──
    supportedParameters: modelParametersValidator,
    // Reasoning effort levels the model takes, lowest first; absent when it doesn't reason.
    reasoningEfforts: modelEffortsValidator,
    defaultEffort: v.optional(effortValidator),
    /** Reasoning can't be turned off ("none" is refused). */
    reasoningMandatory: v.optional(v.boolean()),
    /** Artificial Analysis Intelligence Index, as OpenRouter reports it; absent when unmeasured. */
    intelligenceIndex: v.optional(v.number()),

    // ── Lifecycle ──
    knowledgeCutoff: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    createdOnOpenRouter: v.optional(v.number()),
    retiredAt: v.optional(v.number()),

    // ── Defaults ──
    defaultTemperature: v.optional(v.number()),
    defaultTopP: v.optional(v.number()),
    defaultTopK: v.optional(v.number()),

    // ── Business layer (our overrides) ──
    isServed: v.boolean(),
    /** Set by an admin to keep the model out of users' pickers. */
    hidden: v.optional(v.boolean()),
    costMarkup: v.number(),
    sortOrder: v.number(),
    category: v.optional(v.string()),

    // ── Timestamps ──
    syncedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_model_id", ["modelId"])
    .index("by_provider_and_retiredAt", ["provider", "retiredAt"])
    .index("by_retiredAt", ["retiredAt"])
    .index("by_isServed_and_retiredAt_and_sortOrder", ["isServed", "retiredAt", "sortOrder"])
    .index("by_synced", ["syncedAt"]),

  // ═══════════════════════════════════════════════════════════════
  // ADMINS - who can change OpenScholar's live settings. A row without a
  // user is an invite; it links to the user who signs up with its email.
  // ═══════════════════════════════════════════════════════════════
  admins: defineTable({
    /** Lowercase. */
    email: v.string(),
    userId: v.optional(v.id("users")),
    /** Absent for an admin granted from the command line. */
    addedBy: v.optional(v.id("users")),
    /** Whether the last invite email went out. */
    delivery: v.optional(v.union(v.literal("sent"), v.literal("failed"))),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_userId", ["userId"]),

  // ═══════════════════════════════════════════════════════════════
  // FEATURE FLAGS - Database-driven feature gating
  // ═══════════════════════════════════════════════════════════════
  featureFlags: defineTable({
    key: v.string(),
    enabled: v.boolean(),
    /** An Autumn feature the user's plan must grant, such as "extraction". */
    planFeature: v.optional(v.string()),
    /** Retired: the plan tier gate. `featureFlags/internal:adoptPlanFeatures` clears it. */
    minimumTier: v.optional(v.number()),
    description: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // ═══════════════════════════════════════════════════════════════
  // AI_MODEL_CONFIG - global curated model config: each preset's pick
  // for each task (preset.<preset>.<task>) and the per-provider defaults
  // for browser keys (default.<provider>).
  // ═══════════════════════════════════════════════════════════════
  aiModelConfig: defineTable({
    key: v.string(),
    modelId: v.string(), // model slug the key resolves to
    /** Reasoning effort for preset picks; none means the model's default. */
    effort: v.optional(effortValidator),
    label: v.optional(v.string()),
    blurb: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // ═══════════════════════════════════════════════════════════════
  // USER_AI_CONFIG - what a user's AI tasks run on: a preset, or Custom
  // with their own pick for each task.
  // ═══════════════════════════════════════════════════════════════
  userAiConfig: defineTable({
    userId: v.id("users"),
    /** A preset, or "custom"; no row means the default preset. */
    choice: modelChoiceValidator,
    custom: v.optional(customPicksValidator),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════
  // USERS - synced from Clerk, single source of truth in Convex
  // ═══════════════════════════════════════════════════════════════
  users: defineTable(userFields)
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    // Active users by email, for the picker that adds an admin (admins/queries.ts).
    .index("by_state_and_email", ["state", "email"])
    .index("by_state", ["state"]),

  // ═══════════════════════════════════════════════════════════════
  // BILLING - balances and plans live in Autumn (convex/billing).
  // billingAccounts caches each user's plan, features and balance;
  // billingCatalog caches Autumn's plans and features;
  // billingUsage records every settled charge; billingHolds the Autumn
  // locks still held, with the release scheduled for each one's expiry.
  // ═══════════════════════════════════════════════════════════════
  billingAccounts: defineTable(billingAccountFields)
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),
  billingCatalog: defineTable({ ...billingCatalogValidator.fields, syncedAt: v.number() }),
  billingUsage: defineTable({
    ...billingUsageFields,
    // Set when the charge is recorded, in commit order, while it waits for the ledger
    // worker (convex/billing/ledger.ts), which clears it once it's counted.
    queuedAt: v.optional(v.commitTs()),
  })
    .index("by_charge", ["chargeId"])
    .index("by_queuedAt", ["queuedAt"])
    .index("by_user_and_createdAt", ["userId", "createdAt"])
    // `by_job` stays for the chat's tests, which go with chat mode (#325); the charge list reads `by_job_and_createdAt`.
    .index("by_job", ["jobId"])
    .index("by_job_and_createdAt", ["jobId", "createdAt"])
    .index("by_stripe_charge", ["stripeChargeId"]),
  billingHolds: defineTable({
    userId: v.id("users"),
    chargeId: v.string(),
    credits: v.number(),
    release: v.id("_scheduled_functions"),
    // Set before a settle confirms the hold as it stands and charges the rest
    // separately, so a retry finishes that path instead of confirming again.
    rest: v.optional(v.literal(true)),
  }).index("by_charge", ["chargeId"]),

  // Retired billing tables: credits, creditTransactions, subscriptions,
  // billingCustomers, stripeEventLogs, and chatGenerationUsages. Only
  // convex/billing/migrate.ts reads them. Drop them once production has been
  // imported into Autumn.
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
      v.literal("ignored"),
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
    metadata: capped(v.optional(v.record(v.string(), v.string())), MAX_METADATA_FIELDS),
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
      v.literal("openrouter"),
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
    encryptedApiKey: v.string(), // Required: encrypted API key (only storage form after Phase 43 migration)
    keyPrefix: v.string(), // Required: first chars for display (e.g. "zot_xxxx...")
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
    // Where to send the person after Zotero returns (a path on this app).
    returnTo: v.optional(v.string()),
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
    // The job list ordered by name.
    .index("by_user_and_sortName", ["userId", "sortName"])
    // Unified history list + single-mode scoping (count user's chats).
    .index("by_user_mode_updated", ["userId", "mode", "updatedAt"])
    // Cross-user iteration by mode (admin backfills, ops tooling).
    .index("by_mode", ["mode"])
    // Chats generating now, per user and across users, oldest first: the concurrency
    // check and the stale lock sweep read only these (#355).
    .index("by_user_and_mode_and_isGenerating_and_generatingStartedAt", ["userId", "mode", "isGenerating", "generatingStartedAt"])
    .index("by_mode_and_isGenerating_and_generatingStartedAt", ["mode", "isGenerating", "generatingStartedAt"])
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
      v.literal("upload"),
    ),
    sourceRefId: v.string(),
    title: v.string(),
    authors: capped(v.array(v.string()), MAX_AUTHORS),
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
    searchFilters: v.optional(storedSearchFiltersValidator),
    // zotero context (libraryType/groupId resolve the OAuth target at queue setup)
    libraryType: v.optional(v.union(v.literal("user"), v.literal("group"))),
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
    // A job's processable papers in the orders its results list in.
    .index("by_job_processable_and_sortTitle", ["jobId", "processable", "sortTitle"])
    .index("by_job_processable_and_avgConfidence", ["jobId", "processable", "avgConfidence"])
    .index("by_job_status", ["jobId", "status"])
    // A job's papers of one status from the earliest started; `by_job_status` reads them as they were added.
    .index("by_job_status_and_startedAt", ["jobId", "status", "startedAt"])
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
  // An extraction job's counts (convex/extraction/counts.ts): every write that changes a
  // count appends its change, and one worker folds them into the job's counts row.
  extractionCountChanges: defineTable({
    jobId: v.id("extractionJobs"),
    deltas: capped(v.record(v.string(), v.number()), MAX_COUNT_BUCKETS),
    queuedAt: v.commitTs(),
  })
    .index("by_queuedAt", ["queuedAt"])
    .index("by_job", ["jobId"]),
  extractionJobCounts: defineTable({
    jobId: v.id("extractionJobs"),
    counts: capped(v.record(v.string(), v.number()), MAX_COUNT_BUCKETS),
  }).index("by_job", ["jobId"]),
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
    .index("by_work", ["workId"])
    .index("by_releasedAt", ["releasedAt"]),

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
      v.literal("creditsExhausted"),
    ),
    totalPapers: v.number(),
    questions: screeningQuestionsValidator,
    scoringConfig: screeningScoringConfigValidator,
    targetCollectionId: v.optional(v.id("collections")),
    // Where its papers came from (#341), as the screening page shows it: the set, the set's
    // name when it started (a search's query, a collection's or a job's name), and which of
    // its papers, counting from 1. Jobs from before the page have none.
    set: v.optional(paperSetValidator),
    label: v.optional(v.string()),
    first: v.optional(v.number()),
    last: v.optional(v.number()),
    // The last paper of the whole request when one job can't hold it: the job for the next
    // papers starts when this one completes.
    through: v.optional(v.number()),
    // Where a collection, the saved papers or a job's papers go on after this job's (./paperSets/held.ts).
    resume: v.optional(v.string()),
    // The search as it was when the request began, which its later jobs read their papers from.
    snapshot: v.optional(searchSnapshotValidator),
    // Its included papers aren't saved anywhere.
    unsaved: v.optional(v.literal(true)),
    // Papers that end excluded or failed leave the collection it read (`set`).
    prune: v.optional(v.literal(true)),
    // Papers its search's page had already answered every question for: done on those
    // answers, without asking the model.
    reused: v.optional(v.number()),
    // The screening its answers go to.
    screeningId: v.id("screenings"),
    // Resolved per-user server model for this bulk screening run (credits path).
    serverModelId: v.optional(v.id("models")),
    serverEffort: v.optional(effortValidator),
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
    authors: screeningAuthorsValidator,
    publicationYear: v.optional(v.number()),
    doi: v.optional(v.string()),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    // A finished paper's answers by question key, with the model's confidence in each, waiting
    // (`pendingAnswers`) to move to the job's screening (convex/screening/drain.ts).
    answers: screeningAnswersValidator,
    confidences: capped(v.optional(v.record(v.string(), v.number())), MAX_QUESTIONS),
    pendingAnswers: v.optional(v.literal(true)),
    // The screening's version once this paper's answers moved there; its export reads the
    // job's answers as of it, whatever has changed since.
    answersVersion: v.optional(v.number()),
    score: v.optional(v.number()),
    stars: v.optional(v.number()),
    qualified: v.optional(v.boolean()),
    // Where the paper landed (./screening/scoring.ts), set as it settles and again when an
    // answer of its is changed; a job's list reads its papers by it. Results from before it
    // was kept get theirs from migrations/screeningOutcomes.
    outcome: v.optional(screeningOutcomeValidator),
    // What the paper has added to its job's kept counts (./screening/accounting.ts), so a
    // later change adds only the difference. Missing while it waits for the bookkeeping
    // worker, and on a paper counted before outcomes were kept.
    counted: v.optional(
      v.object({
        qualified: v.boolean(),
        outcome: screeningOutcomeValidator,
        // The answers it was scored on, by question key, and the keys of those a person or the assistant set.
        answers: screeningAnswersValidator,
        changed: capped(v.optional(v.array(v.string())), MAX_QUESTIONS),
      }),
    ),
    venue: v.optional(v.string()),
    citedByCount: v.optional(v.number()),
    aiMetadata: v.optional(
      v.object({
        reasoning: v.optional(v.string()),
        confidence: v.optional(v.number()),
        model: v.optional(v.string()),
        provider: v.optional(v.string()),
      }),
    ),
    creditsUsed: v.optional(v.number()),
    savedToLibrary: v.optional(v.boolean()),
    // Taken from the collection its pruning job read, and not put back since.
    pruned: v.optional(v.literal(true)),
    libraryItemId: v.optional(v.id("libraryItems")),
    workId: v.optional(v.string()),
    // Set while the paper waits for one of its person's paper slots (#335), whose papers
    // start oldest first across their jobs; cleared when it starts and gets its `workId`.
    waitingUser: v.optional(v.id("users")),
    waitingSince: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    // Set when the paper finishes, in commit order, while it waits for the bookkeeping
    // worker (convex/screening/bookkeeping.ts), which clears it.
    doneAt: v.optional(v.commitTs()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_job", ["jobId"])
    .index("by_job_openalexId", ["jobId", "openalexId"])
    // A job's papers of one outcome, in the order the job took them.
    .index("by_job_and_outcome", ["jobId", "outcome"])
    // A job's papers the model is reading: processing, and no longer waiting for a slot.
    .index("by_job_and_status_and_waitingUser", ["jobId", "status", "waitingUser"])
    .index("by_waitingUser_and_waitingSince", ["waitingUser", "waitingSince"])
    .index("by_doneAt", ["doneAt"]),
  // How many of a person's Screen all papers are running (#335). Written by job creation and
  // the bookkeeping worker, which start a person's waiting papers while this is under their
  // plan's limit, as Firecrawl's per-team semaphore does.
  screeningSlots: defineTable({ userId: v.id("users"), running: v.number() }).index("by_user", ["userId"]),
  // A Screen all job's finished papers, counted by the bookkeeping worker alone.
  screeningJobProgress: defineTable({
    jobId: v.id("screeningJobs"),
    completed: v.number(),
    skipped: v.number(),
    failed: v.number(),
    qualified: v.number(),
    // Completed papers that aren't included but could be, and each question's answers.
    // Missing on a job counted before they were kept, until migrations/screeningOutcomes.
    unclear: v.optional(v.number()),
    tallies: screeningTalliesValidator,
    // Credits its counted papers cost.
    credits: v.optional(v.number()),
    // Papers it saved for the first time, and papers it took from the collection it read
    // that are still out of it.
    saved: v.optional(v.number()),
    removed: v.optional(v.number()),
  }).index("by_job", ["jobId"]),

  // How many papers a person has saved. It has its own row, not a field on `users`, because
  // every mutation of the person's reads their user row: a bulk save rewriting it would make
  // their other edits conflict (#383). `users.libraryItemCount` is read until
  // migrations/moveLibraryCounts gives everyone a row.
  libraryCounts: defineTable({ userId: v.id("users"), count: v.number() }).index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════
  // LIBRARY ITEMS - User's saved paper library
  // ═══════════════════════════════════════════════════════════════
  libraryItems: defineTable(libraryItemFields)
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

  // A paper removed from a library, with the collections it was in, kept a day so Undo
  // (the page's or the assistant's) can put it back by this record's ID.
  libraryRemovals: defineTable({
    userId: v.id("users"),
    item: removedItemValidator,
    collectionIds: capped(v.array(v.id("collections")), MAX_COLLECTIONS_PER_USER),
    expiresAt: v.number(),
  }),

  // ═══════════════════════════════════════════════════════════════
  // COLLECTIONS - Named groups for organizing library items
  // ═══════════════════════════════════════════════════════════════
  collections: defineTable({
    userId: v.id("users"),
    name: v.string(),
    // `name` folded for ordering (collectionSortName); optional until migrations/pagedCollections has run.
    sortName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    itemCount: v.optional(v.number()),
    // Goes up on every item added or removed; libraries following the collection compare it.
    membershipRevision: v.optional(v.number()),
  })
    .index("by_user_sortName", ["userId", "sortName"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["userId"] }),

  // An export a browser is downloading in parts: its token's SHA-256 digest, what it writes,
  // the next part to serve and where it starts, whether a part failed, and when the link expires.
  exports: defineTable({
    userId: v.id("users"),
    digest: v.string(),
    format: exportFormatValidator,
    source: exportSourceValidator,
    part: v.number(),
    cursor: v.union(v.string(), v.null()),
    serving: v.boolean(),
    failed: v.boolean(),
    expiresAt: v.number(),
  }).index("by_digest", ["digest"]),

  // How many collections a person has, kept as they make and delete them, for page totals.
  collectionCounts: defineTable({ userId: v.id("users"), count: v.number() }).index("by_user", ["userId"]),

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
    kind: v.union(v.literal("batch_screening"), v.literal("batch_translation")),
    acquiredAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_user_kind", ["userId", "kind"])
    .index("by_user_kind_expires", ["userId", "kind", "expiresAt"]),
});
