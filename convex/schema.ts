import { defineSchema, defineTable } from "convex/server";
import { exportFormatValidator, exportSourceValidator } from "./exportValidators";
import { libraryItemFields, removedItemValidator } from "./library/validators";
import { v } from "convex/values";
import { sourceMetadataFields } from "./lib/paperMetadata";
import { paperIdentityFields } from "./lib/paperRef";
import { rateLimitTables } from "convex-helpers/server/rateLimit";
import {
  MAX_AUTHORS, MAX_COUNT_BUCKETS, MAX_LIST_CAP, MAX_METADATA_FIELDS, MAX_QUESTIONS, MAX_STARS,
  MAX_TOPIC_KEYWORDS, capped,
} from "./lib/listCaps";
import { criteriaValidator, decisionValidator, everyValidator, leftOutWhyValidator, libraryDestinationValidator, libraryWriteProblemValidator, libraryWriteValidator, paperResultValidator, reviewerCountsValidator, ruleValidator, screeningAnswersValidator, screeningDecisionSourcesValidator, paperSetValidator, screeningAuthorsValidator, screeningOutcomeValidator, screeningQuestionsValidator, screeningScoringConfigValidator, screeningTalliesValidator, sourceFactsValidator, sourceSetValidator, voteAnswersValidator, votePassagesValidator, voteStatusValidator } from "./screening/validators";
import { searchSnapshotValidator } from "./paperSets/openalex";
import { activityFields } from "./activity/validators";
import { appKindValidator, redirectUrisValidator } from "./developerApps/validators";
import { searchSuggestionFields } from "./research/suggestionValidators";
import { overviewPrefsFields, overviewSharedFields, searchOverviewFields } from "./research/overviewValidators";
import { itemAccessFields, itemInvitationFields } from "./sharing/validators";
import {
  errorCodeValidator,
  extractionEvidenceUnitFields,
  extractionJobFields,
  extractionPaperErrorFields,
  extractionPaperFields,
  screeningSelectionValidator,
  extractionPaperQueueFields,
  extractionQuestionFields,
  extractionResultFields, extractionAnswerRowFields, extractionPaperFactFields,
  storedSearchFiltersValidator, librarySetValidator, evidenceLibrarySetValidator,
} from "./extraction/validators";
import {
  chatGenerationUsageFields,
  creditsFields,
  creditTransactionFields,
  subscriptionFields,
  userFields,
} from "./lib/validators";
import {
  libraryApplicationFields,
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
  paperSubmissionFields,
  pendingSubmissionStatusFields,
  evidenceLibraryRuntimeBindingValidator,
  evidenceLibraryRuntimeReleaseFields,
  evidenceLibraryReleaseCatalogFields,
  evidenceLibraryRolloutFields,
  organizationFields,
  organizationMembershipFields,
  organizationInvitationFields,
  evidenceLibraryReaderFields,
  evidenceLibraryHandoffFields,
  libraryOrganizationGrantFields,
} from "./evidenceLibraries/validators";
import { evidenceLibraryZoteroGroupFields } from "./zotero/libraryGroupValidators";
import { evidenceLibraryCollectionSourceFields } from "./evidenceLibraries/collectionSourceValidators";
import { evidenceLibrarySourceStatusFields, screeningRequestFields } from "./evidenceLibraries/sourceStatusValidators";

import { authorContentFields } from "./authors/validators";

import { topicNodeFields, metadataValidator, recordTopicIdsValidator } from "./topics/validators";
import { billingAccountFields, billingCatalogValidator, billingUsageFields } from "./billing/validators";
import { assistantLimitFields, assistantSpenderFields, assistantThreadFields, assistantStepFields, assistantStepResultFields, assistantJobEndFields, assistantJobFields, assistantStepUndoFields, assistantFileFields } from "./assistant/validators";
import { customPicksValidator, effortValidator, modelChoiceValidator, modelEffortsValidator, modelModalitiesValidator, modelParametersValidator } from "./aiModelConfig/validators";
import { checksValidator, payWithValidator, reportDetailFields, reportFields, reportFileFields, reportReviewFields, reportSettingsFields, reportEmailFields } from "./reports/validators";
import { fieldValidator, paperAnswersValidator, removalsValidator, shortcutValidator, storedSearchValidator, undoCommandValidator } from "../lib/research/records";


export default defineSchema({
  // `searchText`: what its list's search matches, kept by a trigger (convex/lib/searchText.ts); missing until migrations/searchText reaches a row from before.
  // The workspace a search is in and who made it (#650). `userId` is the person it belonged to
  // before workspaces, which migrations/narrowResearch.ts clears before it goes.
  searches: defineTable({ workspaceId: v.id("workspaces"), createdBy: v.id("users"), localId: v.string(), revision: v.number(), data: storedSearchValidator, searchText: v.optional(v.string()) })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_createdAt", ["workspaceId", "data.createdAt"])
    .index("by_workspace_and_count", ["workspaceId", "data.count"])
    .index("by_workspace_and_localId", ["workspaceId", "localId"])
    // One person's searches (#656): counted, and listed newest or most results first.
    .index("by_workspace_and_createdBy", ["workspaceId", "createdBy"])
    .index("by_workspace_and_createdBy_and_createdAt", ["workspaceId", "createdBy", "data.createdAt"])
    .index("by_workspace_and_createdBy_and_count", ["workspaceId", "createdBy", "data.count"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["workspaceId", "createdBy"] }),
  // How many saved searches, shortcuts and screening jobs a workspace has, kept by the triggers on those tables
  // (research/recordCounts.ts), for page totals; with `createdBy`, how many of a table one person made there,
  // for a list's Run by (#656). While a first count is being taken, `countedTo` is the creation time it has reached.
  recordCounts: defineTable({ workspaceId: v.id("workspaces"), table: v.union(v.literal("searches"), v.literal("queryShortcuts"), v.literal("screeningJobs"), v.literal("extractionJobs"), v.literal("collections"), v.literal("assistantThreads")), createdBy: v.optional(v.id("users")), count: v.number(), countedTo: v.optional(v.number()) })
    .index("by_workspace_and_table_and_createdBy", ["workspaceId", "table", "createdBy"]),
  // `createdBy`: who made the revision; `userId`, from before, goes once migrations/narrowResearch.ts has copied it.
  searchRevisions: defineTable({
    createdBy: v.id("users"), searchId: v.id("searches"), revision: v.number(),
    author: v.union(v.literal("user"), v.literal("assistant")),
    data: storedSearchValidator, deleted: v.boolean(), createdAt: v.number(),
    // The screening version this revision saw; its answers are the history up to it.
    answersVersion: v.optional(v.number()),
  }).index("by_search_and_revision", ["searchId", "revision"]),
  // Each person's suggested searches in a workspace, for the home page (#964; ./research/suggestionValidators.ts).
  searchSuggestions: defineTable(searchSuggestionFields).index("by_workspace_and_user", ["workspaceId", "userId"]),
  // AI overviews of a search (#967; ./research/overviewValidators.ts): each person's lenses and view, a workspace's shared
  // lenses, and the overviews written, by the search's request and the lens.
  overviewPrefs: defineTable(overviewPrefsFields).index("by_workspace_and_user", ["workspaceId", "userId"]),
  overviewShared: defineTable(overviewSharedFields).index("by_workspace", ["workspaceId"]),
  searchOverviews: defineTable(searchOverviewFields).index("by_workspace_and_request_and_lens", ["workspaceId", "request", "lens"]),
  // A search's earlier queries and research questions, in the order they were made (#354).
  searchHistory: defineTable({
    searchId: v.id("searches"), kind: v.union(v.literal("query"), v.literal("question")),
    text: v.string(), field: v.optional(fieldValidator), timestamp: v.string(), position: v.number(),
  }).index("by_search_and_kind_and_position", ["searchId", "kind", "position"])
    .index("by_search_and_kind_and_timestamp", ["searchId", "kind", "timestamp"]),
  // A screening's answers, one row per paper, and an append-only history of each paper's
  // answers that old revisions are rebuilt from. A saved search has one screening, which its
  // page and its Screen all jobs both answer into; a Screen all job run before #334 has its
  // own, with no search. `version` counts the writes to its answers, so a revision finds its
  // answers exactly.
  screenings: defineTable({ workspaceId: v.id("workspaces"), searchId: v.optional(v.id("searches")), version: v.number(), createdAt: v.number(), removals: removalsValidator })
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
  // Bookmarks, by workspace from #650 as searches are.
  queryShortcuts: defineTable({ workspaceId: v.id("workspaces"), createdBy: v.id("users"), data: shortcutValidator, sortName: v.optional(v.string()), searchText: v.optional(v.string()) })
    .index("by_workspace_and_createdAt", ["workspaceId", "data.createdAt"])
    .index("by_workspace_and_sortName", ["workspaceId", "sortName"])
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_shorthand", ["workspaceId", "data.shorthand"])
    // One member's in an organization (#656), in each of the list's orders, and for their count.
    .index("by_workspace_and_createdBy", ["workspaceId", "createdBy"])
    .index("by_workspace_and_createdBy_and_createdAt", ["workspaceId", "createdBy", "data.createdAt"])
    .index("by_workspace_and_createdBy_and_sortName", ["workspaceId", "createdBy", "sortName"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["workspaceId", "createdBy"] }),
  // A person's rating of a paper, from 0 to 5 (#655): their own, the same everywhere, or theirs within a
  // collection, which its people see.
  ratings: defineTable({ userId: v.id("users"), paperId: v.string(), collectionId: v.optional(v.id("collections")), rating: v.number() })
    .index("by_user_and_collection_and_paper", ["userId", "collectionId", "paperId"])
    .index("by_collection_and_paper", ["collectionId", "paperId"]),
  // `undo` is what reverses the change a request made, kept so a retry of it answers the same (#342).
  researchReceipts: defineTable({ userId: v.id("users"), key: v.string(), fingerprint: v.optional(v.string()), undo: v.optional(undoCommandValidator) })
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
  // `rebuilding`: a full recount is running (migrations/communityMoveCounts), and deliveries wait for it.
  topicProjectionState: defineTable({key: v.literal("publications"), pending: v.number(), rebuilding: v.optional(v.boolean())}).index("by_key", ["key"]),

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
    // The workspace that owns it, and who made it (#650). A profile whose owner's account was purged
    // before workspaces has neither: it stays in the directory, owned by nobody.
    workspaceId: v.optional(v.id("workspaces")),
    createdBy: v.optional(v.id("users")),
    photoId: v.optional(v.id("_storage")),
    revision: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"])
    .index("by_openalex", ["openalex"])
    .searchIndex("search_name", {searchField: "name"}),

  // The author records that are a profile's person (./authors/links.ts). A record belongs to one profile at most.
  authorRecordLinks: defineTable({
    profileId: v.id("authorProfiles"),
    authorId: v.string(),
  }).index("by_authorId", ["authorId"])
    .index("by_profileId", ["profileId"]),

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
    // A deleted organization keeps its row, and Clerk lets another take its address: one at an address is its active one.
    .index("by_slug_and_state", ["slug", "state"])
    .index("by_state", ["state"])
    .index("by_state_and_name", ["state", "name"])
    .index("by_state_and_evidenceLibraries_and_name", ["state", "evidenceLibraries", "name"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["state", "evidenceLibraries"] }),

  // Invitations to organizations, as Clerk's webhook and the actions that send them project them (#651).
  organizationInvitations: defineTable(organizationInvitationFields)
    .index("by_clerkInvitationId", ["clerkInvitationId"])
    .index("by_email_and_state", ["email", "state"])
    .index("by_organizationId_and_state", ["organizationId", "state"]),

  // `searchText`: the member's name and email, which a library's team picker searches (convex/lib/searchText.ts).
  organizationMemberships: defineTable({ ...organizationMembershipFields, searchText: v.optional(v.string()) })
    .index("by_clerkMembershipId", ["clerkMembershipId"])
    .index("by_organizationId_and_state_and_role", ["organizationId", "state", "role"])
    .searchIndex("search_member_text", { searchField: "searchText", filterFields: ["organizationId", "state"] })
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
    // A workspace's chats, newest first.
    .index("by_workspace_and_lastMessageAt", ["workspaceId", "lastMessageAt"])
    // One person's chats there (#656): counted, and listed newest first.
    .index("by_workspace_and_createdBy", ["workspaceId", "createdBy"])
    .index("by_workspace_and_createdBy_and_lastMessageAt", ["workspaceId", "createdBy", "lastMessageAt"])
    // The replies being written in a workspace, which are limited.
    .index("by_replyWorkspace", ["reply.workspaceId"])
    // Every chat writing a reply, oldest first, for releasing the ones whose action died.
    .index("by_replyStartedAt", ["reply.startedAt"]),
  // The actions a chat's replies ran, each found by the model's ID for the call.
  assistantSteps: defineTable(assistantStepFields)
    // The steps that wait for the person, or for the reply to run them (convex/assistant/steps.ts).
    .index("by_thread_and_status", ["threadId", "status"]).index("by_thread_and_order", ["threadId", "order"])
    .index("by_thread_order_status", ["threadId", "order", "status"])
    // A person's steps in a chat that hold credits, by how much (convex/assistant/spending.ts).
    .index("by_thread_user_credits", ["threadId", "userId", "credits"]),
  assistantStepResults: defineTable(assistantStepResultFields).index("by_step", ["stepId"]).index("by_thread", ["threadId"]),
  // Jobs replies started that have ended, each told to its chat once (convex/assistant/jobs.ts).
  // Jobs replies started that are still running, which their chats dock (convex/assistant/jobEnds.ts keeps them).
  assistantJobs: defineTable(assistantJobFields).index("by_job", ["jobId"]).index("by_step", ["stepId"]).index("by_thread", ["threadId"]),
  assistantJobEnds: defineTable(assistantJobEndFields).index("by_job", ["jobId"]).index("by_thread_and_pending", ["threadId", "pending"]).index("by_thread_and_order", ["threadId", "order"]),
  // What reverses each change of a bulk change (convex/assistant/bulk.ts).
  assistantStepUndos: defineTable(assistantStepUndoFields).index("by_step", ["stepId"]),
  // A big bulk change's changes, waiting for the person's answer (convex/assistant/bulkPapers.ts).
  assistantBulkPapers: defineTable({ userId: v.id("users"), key: v.string(), first: v.number(), items: v.string(), runningSince: v.optional(v.number()) }).index("by_key_and_first", ["key", "first"]),
  // What each person lets the assistant spend in a chat, and each person's own record (convex/assistant/spending.ts).
  assistantLimits: defineTable(assistantLimitFields).index("by_thread_and_user", ["threadId", "userId"]).index("by_user", ["userId"]),
  assistantSpenders: defineTable(assistantSpenderFields).index("by_user", ["userId"]).index("by_workspace_and_user", ["workspaceId", "userId"]),
  // Files attached to chats (convex/assistant/files.ts): a message's, a chat's and a person's, and the ones due to expire.
  assistantFiles: defineTable(assistantFileFields)
    .index("by_message", ["messageId"])
    .index("by_thread", ["threadId"])
    .index("by_user_and_state", ["userId", "state"])
    .index("by_uploadDigest", ["uploadDigest"])
    .index("by_state_and_usedAt", ["state", "usedAt"])
    .index("by_parent_and_range", ["parentId", "range"])
    .index("by_thread_and_name", ["threadId", "name"]),

  // Each approved OpenAlex query version a library has published, with its query's
  // fingerprint, so a sources save checks versions without reading every revision (#357).
  evidenceLibraryApprovedQueries: defineTable({ libraryId: v.id("evidenceLibraries"), version: v.string(), fingerprint: v.string() })
    .index("by_libraryId_and_version", ["libraryId", "version"]),
  pendingSubmissionStatus: defineTable(pendingSubmissionStatusFields).index("by_library_and_itemKey", ["libraryId", "itemKey"]),
  paperSubmissions: defineTable(paperSubmissionFields)
    .index("by_user_and_sentAt", ["userId", "sentAt"])
    .index("by_user_and_status_and_sentAt", ["userId", "status", "sentAt"])
    .index("by_user_and_library_and_itemKey", ["userId", "libraryId", "itemKey"])
    .index("by_library_and_itemKey", ["libraryId", "itemKey"])
    .index("by_user_and_openalexId", ["userId", "openalexId"])
    // A paper with no OpenAlex work, such as an Openscholar Report, is sent by its DOI.
    .index("by_user_and_doi", ["userId", "doi"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["userId", "status"] }),
  evidenceLibraries: defineTable(evidenceLibraryFields)
    // A workspace's libraries, in the order they were made.
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_state", ["workspaceId", "state"])
    .index("by_workspace_and_name_and_state", ["workspaceId", "name", "state"])
    .index("by_workspace_and_slug", ["workspaceId", "slug"])
    // The public directory (./evidenceLibraries/directory.ts): live and not unlisted, by each of its sorts.
    .index("by_state_and_unlisted_and_liveAt", ["state", "unlisted", "liveAt"])
    .index("by_state_and_unlisted_and_cardName", ["state", "unlisted", "card.nameKey"])
    .index("by_state_and_unlisted_and_records", ["state", "unlisted", "records"]),

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

  clerkDeletedUsers: defineTable(clerkDeletedUserFields).index("by_clerkId", ["clerkId"]).index("by_userId", ["userId"]),

  // One row per library: its Clerk OAuth application.
  evidenceLibraryOAuthClients: defineTable(evidenceLibraryOAuthClientFields)
    .index("by_libraryId", ["libraryId"]),

  // The Evidence Libraries a person reads (./evidenceLibraries/readers.ts).
  evidenceLibraryReaders: defineTable(evidenceLibraryReaderFields)
    .index("by_library_and_user", ["libraryId", "userId"])
    .index("by_user_and_lastAt", ["userId", "lastAt"]),

  // What a library handed over for a reader to screen or extract from, until it expires (./evidenceLibraries/handoffs.ts).
  evidenceLibraryHandoffs: defineTable(evidenceLibraryHandoffFields).index("by_libraryId", ["libraryId"]),

  // The record keys a job reads from an Evidence Library, kept when it starts, a page each (./paperSets/libraryKeys.ts).
  // `part` is the job's source it belongs to: an extraction can read several.
  paperSetKeys: defineTable({ job: v.union(v.id("screeningJobs"), v.id("extractionJobs")), part: v.number(), page: v.number(), keys: capped(v.array(v.string()), MAX_LIST_CAP) })
    .index("by_job_and_part_and_page", ["job", "part", "page"]),

  // Papers waiting to go into, or come out of, a library collection for a screening (./evidenceLibraries/writes.ts).
  // `prune`: the paper leaves, or comes back to, the collection the job read, which counts as removed once the library confirms it.
  // `attempts`: times its library didn't answer it.
  libraryWrites: defineTable({ job: v.id("screeningJobs"), result: v.id("screeningResults"), change: v.union(v.literal("add"), v.literal("remove")), libraryId: v.id("evidenceLibraries"), collection: v.string(), prune: v.optional(v.literal(true)), attempts: v.optional(v.number()) })
    .index("by_job", ["job"])
    .index("by_result", ["result"]),

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

  evidenceLibraryReleaseCatalog: defineTable(evidenceLibraryReleaseCatalogFields)
    .index("by_publishedAt", ["publishedAt"])
    .index("by_commit", ["commit"]),

  // One row at most: the rollout under way, or the last one until an admin dismisses it.
  evidenceLibraryRollouts: defineTable(evidenceLibraryRolloutFields),

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
  evidenceLibraryScreeningRequests: defineTable(screeningRequestFields).index(
    "by_library_source",
    ["libraryId", "sourceKey"],
  ),

  evidenceLibraryZoteroGroups: defineTable(evidenceLibraryZoteroGroupFields)
    .index("by_libraryId", ["libraryId"])
    .index("by_libraryId_and_groupId", ["libraryId", "groupId"]),

  // The organizations a community is shared with (#1091).
  libraryOrganizationGrants: defineTable(libraryOrganizationGrantFields)
    .index("by_library_and_organization", ["libraryId", "organizationId"])
    .index("by_organization_and_grantedAt", ["organizationId", "grantedAt"]),
  evidenceLibraryCollectionSources: defineTable(evidenceLibraryCollectionSourceFields)
    .index("by_libraryId_and_collectionId", ["libraryId", "collectionId"])
    // Whether any library follows a collection, which makes a change to it show outside the account.
    .index("by_collectionId", ["collectionId"]),

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
    /** Name and email, which the admin list's search matches (convex/lib/searchText.ts). */
    searchText: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_userId", ["userId"])
    .searchIndex("search_text", { searchField: "searchText" }),

  // ═══════════════════════════════════════════════════════════════
  // FEATURE FLAGS - Database-driven feature gating
  // ═══════════════════════════════════════════════════════════════
  featureFlags: defineTable({
    key: v.string(),
    enabled: v.boolean(),
    /** An Autumn feature the user's plan must grant, such as "extraction". */
    planFeature: v.optional(v.string()),
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

  // Openscholar Reports (plans/publish-reports), the series Openscholar publishes itself. Its settings are one row,
  // once an admin changes something.
  reportSettings: defineTable(reportSettingsFields),
  // Each version of the checks and of the agreement, kept because a report records which it was checked and signed under.
  reportCheckVersions: defineTable({ version: v.number(), checks: checksValidator }).index("by_version", ["version"]),
  reportAgreementVersions: defineTable({ version: v.number(), text: v.string() }).index("by_version", ["version"]),
  // Emptied by migrations/publicationBalance, which moves each number to the workspace's balance in Autumn; then dropped.
  reportLimits: defineTable({ workspaceId: v.id("workspaces"), perDay: v.number(), updatedAt: v.number(), updatedBy: v.id("users") }).index("by_workspaceId", ["workspaceId"]),
  // One row per report started, which is what a workspace's day is counted against its plan's: a discarded report keeps its row.
  reportStarts: defineTable({ workspaceId: v.id("workspaces"), at: v.number() }).index("by_workspaceId_and_at", ["workspaceId", "at"]),
  // One row per activation (#1261), each paying its report's price from the workspace's publication balance in Autumn.
  // Its id is the idempotency key of what a card buys of that balance for it, whose invoice it keeps. `pending` is a
  // payment still to be made: on Stripe's page, or one the bank asked to confirm. It goes live once that is paid.
  reportActivations: defineTable({
    workspaceId: v.id("workspaces"),
    reportId: v.id("reports"),
    at: v.number(),
    by: v.id("users"),
    // `charging`: under way, from before Autumn is asked anything. One that comes to nothing goes.
    // `unused`: bought, but the report had moved on (declined, say) when the charge came back: what was bought stays
    // in the balance.
    // `refused`: the bank didn't confirm the payment, or the card refused it, after it waited on the bank: nothing was
    // charged, and the report says so until it's activated again.
    state: v.union(v.literal("charging"), v.literal("pending"), v.literal("live"), v.literal("unused"), v.literal("refused")),
    /** The promotion code it was asked with. */
    code: v.optional(v.string()),
    charge: v.optional(v.object({ invoice: v.string(), total: v.number(), currency: v.string(), /** What the account's credit at Stripe paid of `total`. */ credit: v.optional(v.number()) })),
    /** What pays for it: the balance, with a card for the rest, or a card alone, which leaves the balance as it is. */
    payWith: v.optional(payWithValidator),
    /** What the report costs, in US dollars, and how many of them a card buys for it. */
    price: v.optional(v.number()),
    bought: v.optional(v.number()),
    /** Stripe's page for a pending payment: its checkout, or the bank's confirmation. */
    payUrl: v.optional(v.string()),
    /** The hold at Autumn the report went live by: that hold alone takes its price from the balance. */
    hold: v.optional(v.string()),
    /** When that hold was last finished at Autumn: the balance read before then may show the price not yet taken (billing/accounts.ts `payingForReport`). */
    finishedAt: v.optional(v.number()),
    /** When a paid charge waiting on the bank was claimed for settling, so the watch and the webhooks never settle it twice at once. */
    settling: v.optional(v.number()),
    // From before a workspace had a balance in Autumn: cleared by migrations/publicationBalance, then dropped.
    free: v.optional(v.boolean()),
    unbilled: v.optional(v.boolean()),
    refund: v.optional(v.object({ card: v.number(), credit: v.number(), at: v.number() })),
  })
    .index("by_workspaceId_and_state", ["workspaceId", "state"])
    .index("by_reportId", ["reportId"])
    // The latest that count against a limit on new reports (reports/intake.ts).
    .index("by_state_and_at", ["state", "at"]),

  // The reports themselves. A row here is what a list reads; `reportDetails` holds what opening one reads.
  reports: defineTable(reportFields)
    .index("by_key", ["key"])
    .index("by_doi", ["doi"])
    .index("by_workspaceId_and_updatedAt", ["workspaceId", "updatedAt"])
    // The reviewers' list reads each status's newest, and the reports whose changes wait.
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_changes", ["changes"])
    // A person's reports archived in their own Zenodo account, sent again when they reconnect it (zenodo/connection.ts).
    .index("by_archiveOwnerId_and_archive", ["archiveOwnerId", "archive"])
    // Reports whose file opens on a day, which are opened once it comes (reports/fileAccess.ts).
    .index("by_fileOpensOn", ["fileOpensOn"])
    // Every report in the order it last changed, which the search index's feed reads from where it left off (reports/searchIndex.ts).
    .index("by_updatedAt_and_key", ["updatedAt", "key"])
    // A workspace's reports that never went live, which go with it when it is deleted (workspaces/purge.ts).
    .index("by_workspaceId_and_activatedAt", ["workspaceId", "activatedAt"])
    // Live reports by their titles, which Already published searches before anywhere else (reports/ownReports.ts): the
    // very same title, in any script, and titles that share its words.
    .index("by_status_and_title", ["status", "title"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["status"] }),
  reportDetails: defineTable(reportDetailFields).index("by_reportId", ["reportId"]),
  reportReviews: defineTable(reportReviewFields).index("by_reportId", ["reportId"]),
  reportEmails: defineTable(reportEmailFields).index("by_reportId", ["reportId"]),
  reportFiles: defineTable(reportFileFields).index("by_file", ["file"]),
  // The number the next report's key is made from: one row.
  reportKeys: defineTable({ next: v.number() }),

  // What the free writing of queries from questions runs on and may spend (lib/ai/free-queries.ts). One row, once an admin changes something.
  freeQuerySettings: defineTable({
    modelId: v.string(),
    effort: v.optional(effortValidator),
    perAddress: v.number(),
    perPerson: v.number(),
    signedOutPerDay: v.number(),
    signedInPerDay: v.number(),
    updatedAt: v.number(),
  }),
  // That writing's calls and real cost, a row per audience per UTC day.
  freeQueryDays: defineTable({
    day: v.string(),
    audience: v.union(v.literal("signedIn"), v.literal("signedOut")),
    calls: v.number(),
    failed: v.number(),
    costUsd: v.number(),
  }).index("by_day_and_audience", ["day", "audience"]),

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
    .index("by_state", ["state"])
    // Deleted accounts past retention, for the daily cleanup (maintenance/mutations.ts).
    .index("by_state_and_updated_at", ["state", "updatedAt"]),

  // ═══════════════════════════════════════════════════════════════
  // WORKSPACES (#650) - where work lives: one per account, its own,
  // and one per organization (convex/workspaces/create.ts)
  // ═══════════════════════════════════════════════════════════════
  workspaces: defineTable(
    v.union(
      // `evidenceLibraries`: OpenScholar's admins let this person create Evidence Communities in it. An
      // organization's switch is `organizations.evidenceLibraries`, which its admin list is indexed by.
      v.object({ kind: v.literal("personal"), userId: v.id("users"), evidenceLibraries: v.optional(v.literal(true)) }),
      v.object({ kind: v.literal("organization"), organizationId: v.id("organizations") }),
    ),
  )
    .index("by_userId", ["userId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_evidenceLibraries", ["evidenceLibraries"]),

  // ═══════════════════════════════════════════════════════════════
  // BILLING - balances and plans live in Autumn (convex/billing).
  // billingAccounts caches each user's plan, features and balance;
  // billingCatalog caches Autumn's plans and features;
  // billingUsage records every settled charge; billingHolds the Autumn
  // locks still held, with the release scheduled for each one's expiry.
  // ═══════════════════════════════════════════════════════════════
  billingAccounts: defineTable(billingAccountFields)
    .index("by_workspace", ["workspaceId"])
    .index("by_plan", ["plan"])
    .index("by_stripe_customer", ["stripeCustomerId"]),
  // The members of a Team organization whose seat Autumn holds (#652): their charges are made as their entity, which their cap limits.
  memberSeats: defineTable({
    workspaceId: v.id("workspaces"),
    clerkUserId: v.string(),
  }).index("by_workspace_and_member", ["workspaceId", "clerkUserId"]),
  // A purchase under way for a workspace (#858): one at a time, so two can't both find no payment open. Deleted when it ends.
  purchaseLocks: defineTable({
    workspaceId: v.id("workspaces"),
    /** When it began: a lock its action didn't let go of lapses after a while. */
    since: v.number(),
  }).index("by_workspace", ["workspaceId"]),
  // Each organization's seat syncs (#652): one at a time, and how many seats the last one left.
  seatSyncs: defineTable({
    workspaceId: v.id("workspaces"),
    /** Seats bought on Team after the last sync that finished (#862); the daily check syncs while any are left. */
    seats: v.number(),
    /** Of them, the seats held to the renewal by members who left after spending credits (#863). */
    held: v.optional(v.number()),
    /** Set while a member waits for a seat, having joined past them in a race (#863): they spend nothing until they have one. */
    overflow: v.optional(v.literal(true)),
    /** Set while a sync runs: when it started. */
    runningSince: v.optional(v.number()),
    /** A sync asked for while one ran, which runs once that one ends. */
    again: v.optional(v.literal(true)),
    /** The member limit a sync last set on the organization in Clerk: 0 for none. */
    memberLimit: v.optional(v.number()),
    /** Set while its Team is ending, or once the organization is gone, until a sync has ended everything of Team it held. */
    ending: v.optional(v.literal(true)),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_seats", ["seats"])
    .index("by_ending", ["ending"]),
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
    .index("by_workspace_and_createdAt", ["workspaceId", "createdAt"])
    .index("by_job_and_createdAt", ["jobId", "createdAt"])
    .index("by_stripe_charge", ["stripeChargeId"]),
  billingHolds: defineTable({
    userId: v.id("users"),
    // The workspace whose customer the hold is on (#650).
    workspaceId: v.id("workspaces"),
    chargeId: v.string(),
    credits: v.number(),
    release: v.id("_scheduled_functions"),
    // An approved job's hold (convex/billing/charge.ts `holdSpend`): its items are recorded under it and charge nothing by themselves.
    spend: v.optional(v.literal(true)),
    // Set once such a hold is being confirmed with what was spent under it: nothing more is recorded under it.
    settling: v.optional(v.literal(true)),
    // Set before a settle confirms the hold as it stands and charges the rest
    // separately, so a retry finishes that path instead of confirming again.
    rest: v.optional(v.literal(true)),
  })
    .index("by_charge", ["chargeId"])
    // What a member holds now, which their cap counts as it counts what they spent (./billing/memberCaps.ts).
    .index("by_workspace_and_user", ["workspaceId", "userId"]),
  // A cap on what an organization's member spends of its credits each month, set by an admin on Team (#652).
  // Autumn enforces it, as the usage limit on the member's entity; this is the copy pages read.
  memberCaps: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    cap: v.number(),
    setBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_workspace_and_user", ["workspaceId", "userId"]),
  // What each item of an approved job cost, kept beside the job's hold until the hold is confirmed with their
  // sum (convex/billing/charge.ts). Its own table, so the usage ledger needs no index for it.
  billingHoldItems: defineTable({ under: v.string(), chargeId: v.string(), credits: v.number() }).index("by_under", ["under"]),

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
    // The workspace the app draws on, picked when it connects (#651).
    workspaceId: v.id("workspaces"),
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

  // Apps people build on Openscholar: each is an OAuth application in Clerk, and signs people in
  // to act as them through Convex (convex/developerApps). A person makes up to 10.
  developerApps: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    website: v.string(),
    redirectUris: redirectUrisValidator,
    kind: appKindValidator,
    clientId: v.string(),
    clerkApplicationId: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_client_id", ["clientId"]),

  // A site that changed something for a person through a developer app, recorded on its first
  // mutation or action. Disconnecting blocks the app's tokens for that person until they allow it again.
  developerAppGrants: defineTable({
    userId: v.id("users"),
    appId: v.id("developerApps"),
    lastUsedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_app", ["userId", "appId"])
    .index("by_app", ["appId"]),

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

  // A person's own Zenodo account, connected through Zenodo's sign-in (#1237): where their reports' copies may be
  // archived. Its tokens are encrypted (ENCRYPTION_KEY) and the access token is renewed before it is used
  // (zenodo/connection.ts). `broken` once Zenodo refused to renew it: the person connects again.
  zenodoConnections: defineTable({
    userId: v.id("users"),
    encryptedTokens: v.string(),
    expiresAt: v.number(),
    zenodoUserId: v.optional(v.string()),
    name: v.optional(v.string()),
    connectedAt: v.number(),
    broken: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .index("by_zenodoUserId_and_broken", ["zenodoUserId", "broken"]),

  // A Zenodo sign-in under way: what Zenodo hands back proves it was started here, by this person.
  zenodoOAuthStates: defineTable({
    state: v.string(),
    userId: v.id("users"),
    returnTo: v.string(),
    expiresAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_expiry", ["expiresAt"]),

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
  // EXTRACTION JOBS - data extraction over a set of papers.
  //
  // Field-object SSOT lives in convex/extraction/validators.ts as
  // `extractionJobFields`; spread there into the row-mirror validator
  // and here into `defineTable(...)`. Drift fails compile-time via
  // `AssertExactDoc<"extractionJobs", ...>`.
  // ═══════════════════════════════════════════════════════════════
  extractionJobs: defineTable(extractionJobFields)
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    // The job list ordered by name.
    .index("by_workspace_and_sortName", ["workspaceId", "sortName"])
    // One person's jobs (#656): counted, and listed newest first, by name or by status.
    .index("by_workspace_and_createdBy", ["workspaceId", "createdBy"])
    .index("by_workspace_and_createdBy_and_sortName", ["workspaceId", "createdBy", "sortName"])
    .index("by_workspace_and_createdBy_and_status", ["workspaceId", "createdBy", "status"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["workspaceId", "createdBy"] }),

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
    ...sourceMetadataFields,
    jobId: v.id("extractionJobs"),
    position: v.number(),
    bucketKey: v.string(),
    source: v.union(
      v.literal("screening"),
      v.literal("history"),
      v.literal("library"),
      v.literal("collection"),
      v.literal("zotero"),
      v.literal("upload"),
      v.literal("evidenceLibrary"),
    ),
    sourceRefId: v.string(),
    screeningSelection: v.optional(screeningSelectionValidator),
    title: v.string(),
    authors: capped(v.array(v.string()), MAX_AUTHORS),
    year: v.optional(v.number()),
    doi: v.optional(v.string()),
    openalexId: v.optional(v.string()),
    abstract: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    // Per-paper signals. Optional because non-OpenAlex sources (zotero/upload) cannot populate them.
    citedByCount: v.optional(v.number()),
    venueName: v.optional(v.string()), // primary_location.source.display_name
    // history: saved-search placeholder that expands during queue setup
    searchFilters: v.optional(storedSearchFiltersValidator),
    // zotero context (libraryType/groupId resolve the OAuth target at queue setup)
    libraryType: v.optional(v.union(v.literal("user"), v.literal("group"))),
    groupId: v.optional(v.string()),
    zoteroUserId: v.optional(v.string()),
    collectionKey: v.optional(v.string()),
    includeDescendants: v.optional(v.boolean()),
    // A collection's or the library's papers, a range of them, as one source (convex/extraction/validators.ts).
    librarySet: v.optional(librarySetValidator),
    zoteroSet: v.optional(v.object({ first: v.number(), last: v.number() })),
    evidenceLibrarySet: v.optional(evidenceLibrarySetValidator),
  })
    .index("by_job_and_position", ["jobId", "position"])
    .index("by_job_and_source", ["jobId", "source"]),

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
    .index("by_job_dedupeKey", ["jobId", "dedupeKey"])
    .index("by_job_and_doiKey", ["jobId", "doiKey"])
    .index("by_job_and_titleKey", ["jobId", "titleKey"])
    // A job's processable papers in the orders its results list in.
    .index("by_job_processable_and_sortTitle", ["jobId", "processable", "sortTitle"])
    .index("by_job_processable_and_avgConfidence", ["jobId", "processable", "avgConfidence"])
    .index("by_job_status", ["jobId", "status"])
    // A job's papers of one status from the earliest started; `by_job_status` reads them as they were added.
    .index("by_job_status_and_startedAt", ["jobId", "status", "startedAt"])
    .index("by_paperKey", ["paperKey"])
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
    .index("by_workspace_and_status", ["workspaceId", "status"])
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
  extractionEvidenceChanges: defineTable({
    jobId: v.id("extractionJobs"),
    resultId: v.id("extractionResults"),
    before: v.string(),
    after: v.string(),
    answerSnapshot: v.string(),
    createdAt: v.number(),
    revertedAt: v.optional(v.number()),
  }).index("by_job", ["jobId"]),

  // Each paper's finished answer to each question, short, for counting a job's answers (convex/extraction/listProjection.ts).
  extractionAnswerRows: defineTable(extractionAnswerRowFields)
    .index("by_job_question", ["jobId", "questionKey"])
    .index("by_paper", ["paperId"])
    .index("by_paper_question", ["paperId", "questionKey"]),
  // How many papers gave each answer to a question, and named each item of a list answer
  // (convex/extraction/tallies.ts): answer rows append their changes, and one worker folds
  // them, so papers finishing at once never write the same tally.
  extractionTallyChanges: defineTable({
    jobId: v.id("extractionJobs"),
    questionKey: v.string(),
    kind: v.union(v.literal("answer"), v.literal("item")),
    key: v.string(),
    shown: v.string(),
    delta: v.number(),
    queuedAt: v.commitTs(),
  }).index("by_queuedAt", ["queuedAt"]),
  extractionAnswerTallies: defineTable({
    jobId: v.id("extractionJobs"),
    questionKey: v.string(),
    kind: v.union(v.literal("answer"), v.literal("item")),
    key: v.string(),
    shown: v.string(),
    papers: v.number(),
  })
    .index("by_group", ["jobId", "questionKey", "kind", "key"])
    .index("by_size", ["jobId", "questionKey", "kind", "papers"]),
  // How many different answers, and items, a question has: what a summary counts past its largest groups.
  extractionAnswerTotals: defineTable({
    jobId: v.id("extractionJobs"),
    questionKey: v.string(),
    answers: v.number(),
    items: v.number(),
  }).index("by_job_question", ["jobId", "questionKey"]),
  extractionPaperFacts: defineTable(extractionPaperFactFields).index("by_job", ["jobId"]).index("by_paper", ["paperId"]),
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
    workspaceId: v.id("workspaces"),
    createdBy: v.id("users"),
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
    // The name it was given as it started (#696); without one it goes by `label`.
    name: v.optional(v.string()),
    set: v.optional(paperSetValidator),
    label: v.optional(v.string()),
    first: v.optional(v.number()),
    last: v.optional(v.number()),
    // From before a job held its whole request, when the job after it read on to here; read by nothing.
    through: v.optional(v.number()),
    // Where its set goes on after the papers it has read (./paperSets/held.ts), or its search's cursor pages do (./paperSets/openalex.ts).
    resume: v.optional(v.string()),
    // The search as it was when the job began, which it reads its papers from.
    snapshot: v.optional(searchSnapshotValidator),
    // Set while it reads its papers, a step at a time (`screening/start:read`): `totalPapers` is the most it may get until it's done.
    reading: v.optional(v.literal(true)),
    // How far it has read: the set's papers past `first`, and the papers it took of them (a search's rating filter can leave some out).
    readPlace: v.optional(v.object({ read: v.number(), papers: v.number() })),
    // Why it failed, when it couldn't get its papers, in words for the person.
    failure: v.optional(v.string()),
    // The name of the new collection its included papers go to, which is made once it has its papers.
    newCollection: v.optional(v.string()),
    // Its included papers aren't saved anywhere in OpenScholar.
    unsaved: v.optional(v.literal(true)),
    // The Evidence Library collection its included papers go to instead (./evidenceLibraries/writes.ts).
    libraryDestination: v.optional(libraryDestinationValidator),
    // Why its library writes stopped, to the collection its included papers go to and to the one it prunes: the person
    // can no longer change it, it's gone, or the library didn't answer.
    libraryWriteProblem: v.optional(libraryWriteProblemValidator),
    libraryPruneProblem: v.optional(libraryWriteProblemValidator),
    // Papers that end excluded or failed leave the collection it read (`set`).
    prune: v.optional(v.literal(true)),
    // That collection's name, for a reader's collection in a library, whose name lives there.
    pruneName: v.optional(v.string()),
    // Papers its search's page had already answered every question for: done on those
    // answers, without asking the model.
    reused: v.optional(v.number()),
    // The screening its answers go to.
    screeningId: v.id("screenings"),
    // Resolved per-user server model for this bulk screening run (credits path).
    serverModelId: v.optional(v.id("models")),
    serverEffort: v.optional(effortValidator),
    // The most it may spend, on a job the assistant started with the person's say (#328): its papers stop once it has.
    spendCap: v.optional(v.number()),
    // The hold that figure is kept in (convex/billing/charge.ts): its papers are charged under it, and it is confirmed once, with what they cost, when the job has ended.
    spendHold: v.optional(v.string()),
    // Set once it has: its papers that haven't started are skipped, those running finish and are kept, and it ends as one that stopped at its limit.
    capped: v.optional(v.literal(true)),
    // Set when the person's credits ran out before it had read all its papers: it screens the
    // ones it took, then ends out of credits (convex/screening/bookkeeping.ts).
    outOfCredits: v.optional(v.literal(true)),
    // The step of the assistant's reply that started it (#328): its chat hears when it ends (convex/assistant/jobs.ts).
    chatStep: v.optional(v.id("assistantSteps")),
    // A screening with reviewers (plans/screening-reviewers): people and models each vote on a paper, and a rule settles it.
    // It is `processing` until a person finishes it, and `completed` from then until one reopens it.
    shape: v.optional(v.literal(2)),
    // What the review asks, which its criteria are written from.
    question: v.optional(v.string()),
    criteria: v.optional(criteriaValidator),
    // The points each star starts at.
    stars: capped(v.optional(v.array(v.number())), MAX_STARS),
    rule: v.optional(ruleValidator),
    // A living screening looks in its sources again on a schedule: how often, and when next.
    living: v.optional(v.object({ every: everyValidator, next: v.number() })),
    finishedAt: v.optional(v.number()),
    // Its models are held where they are until someone lets them go on.
    paused: v.optional(v.literal(true)),
    // When its settings last changed without its settled papers being checked again: a paper settled by then keeps its result (convex/screening/settling.ts).
    heldAt: v.optional(v.number()),
    // When something last happened in it, to within a minute: what its list orders by.
    activeAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    // The living screenings whose next check is due.
    .index("by_living_next", ["living.next"])
    // A workspace's screenings by name, and by when something last happened in them.
    .index("by_workspace_and_name", ["workspaceId", "name"])
    .index("by_workspace_and_activeAt", ["workspaceId", "activeAt"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["workspaceId"] })
    // One person's screenings (#656): counted, and listed newest first, in a state or all.
    .index("by_workspace_and_createdBy", ["workspaceId", "createdBy"])
    .index("by_workspace_and_createdBy_and_status", ["workspaceId", "createdBy", "status"])
    // A search's screenings, which share its answers and move with it (#654).
    .index("by_screening", ["screeningId"]),

  // ═══════════════════════════════════════════════════════════════
  // SCREENING RESULTS - individual paper screening outcomes
  // ═══════════════════════════════════════════════════════════════
  screeningResults: defineTable({
    ...sourceMetadataFields,
    jobId: v.id("screeningJobs"),
    // The paper by its source (plans/evidence-library-sources).
    ...paperIdentityFields,
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
    // The result a paper had before screenings had reviewers (migrations/screeningReviewers): it stands until someone votes on the paper, or its settled papers are checked again.
    kept: v.optional(decisionValidator),
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
        decisions: screeningDecisionSourcesValidator,
      }),
    ),
    venue: v.optional(v.string()),
    citedByCount: v.optional(v.number()),
    // Its title and authors, which a job's list searches (convex/screening/papers.ts). Results
    // from before it was kept get theirs from migrations/screeningSearch.
    searchText: v.optional(v.string()),
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
    // How it went to its job's library collection, once written there.
    libraryWrite: v.optional(libraryWriteValidator),
    libraryItemId: v.optional(v.id("libraryItems")),
    workId: v.optional(v.string()),
    // Set while the paper waits for one of its workspace's paper slots (#335, #650), whose papers
    // start oldest first across their jobs; cleared when it starts and gets its `workId`.
    waitingWorkspace: v.optional(v.id("workspaces")),
    waitingSince: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    // Set when the paper finishes, in commit order, while it waits for the bookkeeping
    // worker (convex/screening/bookkeeping.ts), which clears it.
    doneAt: v.optional(v.commitTs()),
    errorMessage: v.optional(v.string()),
    // In a screening with reviewers: the source that brought it, the check of the sources that found it, and its place in the round its people are dealt from.
    sourceId: v.optional(v.id("screeningSources")),
    checkId: v.optional(v.id("screeningChecks")),
    place: v.optional(v.number()),
    // Where it stands, written by the bookkeeping worker alone, and when it came to be settled.
    result: v.optional(paperResultValidator),
    settledAt: v.optional(v.number()),
    // Why it is excluded: a criterion's key, or another reason.
    reason: v.optional(v.string()),
    // A person settled it, whatever its votes say.
    resolved: v.optional(v.object({ decision: decisionValidator, by: v.id("users"), note: v.optional(v.string()), reason: v.optional(v.string()), at: v.number() })),
    // Set with `doneAt` by what lets go of a held result: a person's vote on it, or a check of the settled papers under new settings.
    reopen: v.optional(v.union(v.literal("vote"), v.literal("recheck"))),
    // The reviewers it was moved away from: it goes back to one only where nobody else is left to take it.
    away: capped(v.optional(v.array(v.id("screeningReviewers"))), MAX_LIST_CAP),
    // What makes it the same paper as another source's: its DOI, and its title with its year.
    doiKey: v.optional(v.string()),
    titleKey: v.optional(v.string()),
    // How many lines its discussion has.
    messages: v.optional(v.number()),
    // Its source was taken out of the screening: it is kept on record with its votes, and counted nowhere (`out`, once the bookkeeping worker has taken it out of the counts).
    withdrawn: v.optional(v.literal(true)),
    out: v.optional(v.literal(true)),
    // How far its reviewers are from agreeing: the votes that aren't on the side most of them took. What "most divided first" orders by.
    split: v.optional(v.number()),
  })
    .index("by_job", ["jobId"])
    .index("by_job_and_result", ["jobId", "result"])
    // A screening's papers in each order its Papers page offers, all of them or the ones that stand one way.
    .index("by_job_and_title", ["jobId", "title"])
    .index("by_job_and_publicationYear", ["jobId", "publicationYear"])
    .index("by_job_and_score", ["jobId", "score"])
    .index("by_job_and_split", ["jobId", "split"])
    .index("by_job_and_result_and_title", ["jobId", "result", "title"])
    .index("by_job_and_result_and_publicationYear", ["jobId", "result", "publicationYear"])
    .index("by_job_and_result_and_score", ["jobId", "result", "score"])
    .index("by_job_and_result_and_split", ["jobId", "result", "split"])
    .index("by_job_and_reason", ["jobId", "reason"])
    // The papers one person settled, whatever their votes say.
    .index("by_job_and_resolver", ["jobId", "resolved.by"])
    .index("by_job_and_source", ["jobId", "sourceId"])
    .index("by_job_and_check", ["jobId", "checkId"])
    .index("by_job_and_doiKey", ["jobId", "doiKey"])
    .index("by_job_and_titleKey", ["jobId", "titleKey"])
    .index("by_job_paperKey", ["jobId", "paperKey"])
    .index("by_paperKey", ["paperKey"])
    // A job's papers of one outcome, in the order the job took them.
    .index("by_job_and_outcome", ["jobId", "outcome"])
    // A job's papers by how they went to its library collection: the ones the library holds no record of.
    .index("by_job_and_libraryWrite_and_outcome", ["jobId", "libraryWrite", "outcome"])
    // A job's papers the model is reading: processing, and no longer waiting for a slot.
    .index("by_job_and_status_and_waitingWorkspace", ["jobId", "status", "waitingWorkspace"])
    .index("by_waitingWorkspace_and_waitingSince", ["waitingWorkspace", "waitingSince"])
    .index("by_doneAt", ["doneAt"])
    // A started paper by its work in the pool: how the pool's callback finds the paper that finished (#796).
    .index("by_workId", ["workId"])
    // A job's papers waiting for that bookkeeping, which a move waits for (#654).
    .index("by_job_and_doneAt", ["jobId", "doneAt"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["jobId", "outcome", "libraryWrite"] })
    .searchIndex("search_papers", { searchField: "searchText", filterFields: ["jobId", "result", "sourceId"] }),
  // How many of a person's Screen all papers are running (#335). Written by job creation and
  // the bookkeeping worker, which start a person's waiting papers while this is under their
  // plan's limit, as Firecrawl's per-team semaphore does.
  screeningSlots: defineTable({ workspaceId: v.id("workspaces"), running: v.number() }).index("by_workspace", ["workspaceId"]),
  // A Screen all job's finished papers, counted by the bookkeeping worker alone.
  screeningJobProgress: defineTable({
    jobId: v.id("screeningJobs"),
    exportRevision: v.optional(v.number()),
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
    // Its papers in a slot: started, and not counted yet (screening/slots.ts). Missing on a job that never started one.
    running: v.optional(v.number()),
    // Papers it saved for the first time, and papers it took from the collection it read
    // that are still out of it.
    saved: v.optional(v.number()),
    removed: v.optional(v.number()),
    // Papers it put into its library collection, and papers it couldn't, the library holding no record of them.
    libraryAdded: v.optional(v.number()),
    libraryMissing: v.optional(v.number()),
    // In a screening with reviewers: its settled and split papers by where they stand (the rest wait for votes), the
    // excluded ones by reason, and what each reviewer's votes come to.
    counts: v.optional(v.object({ include: v.number(), maybe: v.number(), exclude: v.number(), conflict: v.number() })),
    reasons: capped(v.optional(v.record(v.string(), v.number())), MAX_QUESTIONS + 2),
    reviewers: capped(v.optional(v.record(v.id("screeningReviewers"), reviewerCountsValidator)), MAX_LIST_CAP),
    // Its included papers by the source that brought each.
    included: capped(v.optional(v.record(v.string(), v.number())), MAX_LIST_CAP),
    // Papers kept on record whose source was taken out: its papers are the ones it placed, less these.
    withdrawn: v.optional(v.number()),
  }).index("by_job", ["jobId"]),

  // ═══════════════════════════════════════════════════════════════
  // SCREENING WITH REVIEWERS (plans/screening-reviewers)
  // ═══════════════════════════════════════════════════════════════
  // Who votes on a screening: a person by their account, a person invited by email until they join, or a model at
  // one effort. One taken off (`left`) keeps the votes they cast unless those were thrown out (`discarded`).
  screeningReviewers: defineTable({
    jobId: v.id("screeningJobs"),
    kind: v.union(v.literal("person"), v.literal("model")),
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
    modelId: v.optional(v.id("models")),
    effort: v.optional(effortValidator),
    addedAt: v.number(),
    addedBy: v.id("users"),
    left: v.optional(v.number()),
    discarded: v.optional(v.number()),
    reminded: v.optional(v.number()),
    // Papers given to them, voted on or not: kept by whatever deals papers (convex/screening/dealing.ts).
    dealt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_job_and_user", ["jobId", "userId"])
    .index("by_user", ["userId"])
    .index("by_email", ["email"]),

  // A reviewer's place on a paper, from when the paper is given to them. A model's row is its unit of work in the
  // pool: it waits for one of its workspace's slots (`waitingWorkspace`), runs (`workId`), and ends cast or failed.
  screeningVotes: defineTable({
    jobId: v.id("screeningJobs"),
    resultId: v.id("screeningResults"),
    reviewerId: v.id("screeningReviewers"),
    // The paper's place in the round: a reviewer's queue is in this order.
    place: v.number(),
    status: voteStatusValidator,
    decision: v.optional(decisionValidator),
    answers: v.optional(voteAnswersValidator),
    confidences: capped(v.optional(v.record(v.string(), v.number())), MAX_QUESTIONS),
    passages: v.optional(votePassagesValidator),
    // Why it excludes: a criterion's key, or another reason.
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
    // When it was cast.
    at: v.optional(v.number()),
    // A person's vote cast before a criterion became a must-have: it stands, and asks for a new one.
    flagged: v.optional(v.literal(true)),
    // On a place a person has yet to vote from: how many of the paper's models would include it, as a negative number, so the papers the models lean to come first in the order of an index.
    lean: v.optional(v.number()),
    waitingWorkspace: v.optional(v.id("workspaces")),
    waitingSince: v.optional(v.number()),
    workId: v.optional(v.string()),
    // Set while it holds one of its workspace's slots, until the bookkeeping worker counts it off.
    slot: v.optional(v.literal(true)),
    credits: v.optional(v.number()),
    error: v.optional(v.string()),
    // What it has added to its reviewer's counts and to the agreement between reviewers, so a later change adds only the difference.
    counted: v.optional(v.object({ status: voteStatusValidator, decision: v.optional(decisionValidator), credits: v.optional(v.number()) })),
  })
    .index("by_result", ["resultId"])
    .index("by_job_and_place", ["jobId", "place"])
    .index("by_reviewer_and_status_and_place", ["reviewerId", "status", "place"])
    .index("by_reviewer_and_status_and_lean_and_place", ["reviewerId", "status", "lean", "place"])
    // A reviewer's votes, the latest first, all of them or the ones cast one way.
    .index("by_reviewer_and_status_and_at", ["reviewerId", "status", "at"])
    .index("by_reviewer_and_status_and_decision_and_at", ["reviewerId", "status", "decision", "at"])
    .index("by_reviewer_and_flagged_and_place", ["reviewerId", "flagged", "place"])
    .index("by_workId", ["workId"])
    // The readings of a screening under way: it stays in its workspace until there are none (./screening/moving.ts).
    .index("by_job_and_slot", ["jobId", "slot"])
    .index("by_waitingWorkspace_and_waitingSince", ["waitingWorkspace", "waitingSince"]),

  // Where a screening's papers come from, each read a step at a time: what it held, took, merged with another
  // source's and left out, and where its reading stands.
  screeningSources: defineTable({
    jobId: v.id("screeningJobs"),
    set: sourceSetValidator,
    name: v.string(),
    detail: v.optional(v.string()),
    // What tells it from another source of the same name, as its list said it: a search's filters, where a Zotero collection sits.
    facts: sourceFactsValidator,
    // The papers taken of it, counting from 1; all of them without a range.
    first: v.optional(v.number()),
    last: v.optional(v.number()),
    addedAt: v.number(),
    addedBy: v.id("users"),
    // The workspace it is read in, once its screening has moved to another: a search, a collection, a library and a screening stay where they were (./screening/moving.ts).
    workspaceId: v.optional(v.id("workspaces")),
    // Taken out of the screening: its papers nobody voted on went with it.
    removedAt: v.optional(v.number()),
    state: v.union(v.literal("waiting"), v.literal("reading"), v.literal("done"), v.literal("failed")),
    failure: v.optional(v.string()),
    // How far its reading is: the set's papers passed, and where the set goes on.
    read: v.number(),
    resume: v.optional(v.string()),
    snapshot: v.optional(searchSnapshotValidator),
    // What it holds, as last counted, and of the papers read: those the screening took, those another source had brought, and those left out.
    total: v.optional(v.number()),
    taken: v.number(),
    duplicates: v.number(),
    left: v.number(),
    // Of the ones left out, how many for having no abstract.
    bare: v.optional(v.number()),
    // Its reading stopped at the most papers its workspace's plan gives one screening: what it held past that was not taken.
    capped: v.optional(v.literal(true)),
    // Where a living check goes on from: when it last looked.
    checkedAt: v.optional(v.number()),
  }).index("by_job", ["jobId"]),

  // What a source held that the screening doesn't take, each with why.
  screeningLeftOut: defineTable({
    jobId: v.id("screeningJobs"),
    sourceId: v.id("screeningSources"),
    name: v.string(),
    why: leftOutWhyValidator,
    // The paper it was read as, for a file someone says was matched to the wrong one.
    paperKey: v.optional(v.string()),
  })
    .index("by_source", ["sourceId"])
    .index("by_source_and_paperKey", ["sourceId", "paperKey"])
    .index("by_job_and_why", ["jobId", "why"]),

  // Each look in a screening's sources: the one it started with, then each check of a living screening, on its
  // schedule (no `by`) or by hand. It holds where the papers it brings stand in the round.
  screeningChecks: defineTable({
    jobId: v.id("screeningJobs"),
    at: v.number(),
    by: v.optional(v.id("users")),
    state: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
    // The place its first paper takes, and what it has brought so far.
    from: v.number(),
    found: v.number(),
    added: v.number(),
    // When its reading last gave it a step: a check that goes quiet is set off again (convex/screening/gathering.ts `watch`).
    beat: v.optional(v.number()),
    endedAt: v.optional(v.number()),
  })
    .index("by_job", ["jobId"])
    .index("by_job_and_state", ["jobId", "state"]),

  // How two reviewers' votes fell against each other over the papers both voted on (lib/screening/rules.ts `kappa`).
  // `a` is the reviewer added first.
  screeningAgreement: defineTable({ jobId: v.id("screeningJobs"), a: v.id("screeningReviewers"), b: v.id("screeningReviewers"), matrix: capped(v.array(v.number()), 9) })
    .index("by_job_and_a_and_b", ["jobId", "a", "b"]),

  // What reviewers say to each other about a paper. With `to`, a question that waits (`open`) until that person writes on the paper.
  screeningMessages: defineTable({
    jobId: v.id("screeningJobs"),
    resultId: v.id("screeningResults"),
    by: v.id("users"),
    text: v.string(),
    to: v.optional(v.id("users")),
    open: v.optional(v.literal(true)),
  })
    .index("by_result", ["resultId"])
    .index("by_job_and_to_and_open", ["jobId", "to", "open"]),

  // A person's settings on one screening: its emails turned off.
  // `conflictsAt`: when they were last told conflicts wait for them, which is at most once a day.
  screeningNotices: defineTable({ jobId: v.id("screeningJobs"), userId: v.id("users"), off: v.boolean(), conflictsAt: v.optional(v.number()) }).index("by_job_and_user", ["jobId", "userId"]),

  // How many papers a person has saved. It has its own row, not a field on `users`, because
  // every mutation of the person's reads their user row: a bulk save rewriting it would make
  // their other edits conflict (#383).
  libraryCounts: defineTable({ workspaceId: v.id("workspaces"), count: v.number() }).index("by_workspace", ["workspaceId"]),

  // ═══════════════════════════════════════════════════════════════
  // LIBRARY ITEMS - User's saved paper library
  // ═══════════════════════════════════════════════════════════════
  libraryItems: defineTable(libraryItemFields)
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_paperKey", ["workspaceId", "paperKey"])
    // A paper's saved copies in every workspace: a report's follow its corrections (./reports/saved.ts).
    .index("by_paperKey", ["paperKey"])
    .index("by_workspace_rating", ["workspaceId", "rating"])
    .index("by_workspace_savedAt", ["workspaceId", "savedAt"])
    .index("by_workspace_year", ["workspaceId", "publicationYear"])
    .index("by_workspace_citedByCount", ["workspaceId", "citedByCount"])
    .index("by_workspace_title", ["workspaceId", "title"])
    .searchIndex("search_library", {
      searchField: "searchableText",
      filterFields: ["rating", "workspaceId"],
    }),

  paperMetadataChanges: defineTable({
    table: v.union(v.literal("libraryItems"), v.literal("libraryRemovals")),
    recordId: v.string(),
    before: v.string(),
    after: v.string(),
    createdAt: v.number(),
    revertedAt: v.optional(v.number()),
  }).index("by_record", ["table", "recordId"]),

  // A paper removed from a library, kept a day so Undo (the page's or the assistant's) can
  // put it back by this record's ID. The collections it was in are its removedPlaces.
  libraryRemovals: defineTable({
    workspaceId: v.id("workspaces"),
    item: removedItemValidator,
    // The removed paper's ID, which its places not moved yet still name.
    itemId: v.id("libraryItems"),
    expiresAt: v.number(),
    // The paper Undo put back; the removal is kept until it expires.
    restoredAs: v.optional(v.id("libraryItems")),
    // Set while batches of the paper's places are still being taken out of its collections,
    // or put back in them after Undo: the restored paper can't be removed again meanwhile.
    moving: v.optional(v.literal(true)),
    placing: v.optional(v.literal(true)),
  }).index("by_restoredAs", ["restoredAs"]),

  // A collection a removed paper was in, and when it was put there, so Undo puts it back as it was.
  removedPlaces: defineTable({
    removalId: v.id("libraryRemovals"),
    collectionId: v.id("collections"),
    assignedAt: v.number(),
  }).index("by_removal", ["removalId"]),

  // ═══════════════════════════════════════════════════════════════
  // COLLECTIONS - Named groups for organizing library items
  // ═══════════════════════════════════════════════════════════════
  // What changed on each item and who changed it (#656), newest first by item.
  // By workspace first: a search's ID is only unique within its workspace.
  activity: defineTable(activityFields).index("by_workspace_and_item", ["workspaceId", "item"]),

  // People outside an item's workspace who may open it (#653), and the invitations waiting for an answer.
  itemAccess: defineTable(itemAccessFields)
    .index("by_item_and_user", ["item", "userId"])
    // An item's guests in the order they were given it.
    .index("by_item_and_grantedAt", ["item", "grantedAt"])
    // A person's "Shared with me", newest first or by name, in all or of one kind.
    .index("by_user_and_grantedAt", ["userId", "grantedAt"])
    .index("by_user_and_kind_and_grantedAt", ["userId", "kind", "grantedAt"])
    .index("by_user_and_name", ["userId", "name"])
    .index("by_user_and_kind_and_name", ["userId", "kind", "name"])
    // The ones of a kind a person may edit, by name: what their collection picker offers beside their own.
    .index("by_user_and_kind_and_role_and_name", ["userId", "kind", "role", "name"])
    // The chats shared with a person, newest message first, beside their own in one list (../assistant/threads.ts).
    .index("by_user_and_kind_and_lastMessageAt", ["userId", "kind", "lastMessageAt"]),
  // Applications to join a community (OS-31, ./evidenceLibraries/applications.ts).
  libraryApplications: defineTable(libraryApplicationFields)
    .index("by_userId_and_libraryId", ["userId", "libraryId"])
    // A person's sidebar rows, newest first.
    .index("by_userId_and_listed_and_createdAt", ["userId", "listed", "createdAt"])
    // A person's waiting ones, counted against MAX_WAITING_APPLICATIONS_PER_PERSON.
    .index("by_userId_and_state", ["userId", "state"])
    // What a community's owners and editors answer, oldest first.
    .index("by_libraryId_and_state_and_createdAt", ["libraryId", "state", "createdAt"]),

  itemInvitations: defineTable(itemInvitationFields)
    .index("by_item_and_email", ["item", "email"])
    .index("by_item_and_state", ["item", "state"])
    .index("by_email_and_state", ["email", "state"])
    // A reader's waiting invitations to their collections in Evidence Libraries (../evidenceLibraries/collectionInvitations.ts).
    .index("by_invitedBy_and_kind_and_state", ["invitedBy", "kind", "state"]),

  collections: defineTable({
    workspaceId: v.id("workspaces"),
    createdBy: v.id("users"),
    name: v.string(),
    // `name` folded for ordering (collectionSortName).
    sortName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    itemCount: v.number(),
    // Goes up on every item added or removed; libraries following the collection compare it.
    membershipRevision: v.optional(v.number()),
    // Set while the Library's Undo holds its deletion (./library/collections.ts `deleteSoon`): it's deleted when that time is up, unless Undo clears this.
    deletingAt: v.optional(v.number()),
  })
    .index("by_workspace_sortName", ["workspaceId", "sortName"])
    // One person's collections (#656): counted, and listed by name.
    .index("by_workspace_and_createdBy", ["workspaceId", "createdBy"])
    .index("by_workspace_and_createdBy_and_sortName", ["workspaceId", "createdBy", "sortName"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["workspaceId", "createdBy"] }),

  // An export a browser is downloading in parts: its token's SHA-256 digest, what it writes,
  // the next part to serve and where it starts, whether a part failed, and when the link expires.
  exports: defineTable({
    userId: v.id("users"),
    // The workspace it reads (#650); the export itself is the person's.
    workspaceId: v.id("workspaces"),
    digest: v.string(),
    format: exportFormatValidator,
    source: exportSourceValidator,
    sourceRevision: v.optional(v.string()),
    failureReason: v.optional(v.literal("changed")),
    part: v.number(),
    cursor: v.union(v.string(), v.null()),
    serving: v.boolean(),
    failed: v.boolean(),
    expiresAt: v.number(),
  }).index("by_digest", ["digest"]),

  // How many collections a person has, kept as they make and delete them, for page totals.
  collectionCounts: defineTable({ workspaceId: v.id("workspaces"), count: v.number() }).index("by_workspace", ["workspaceId"]),

  // ═══════════════════════════════════════════════════════════════
  // LIBRARY ITEM COLLECTIONS - Junction table for many-to-many
  // ═══════════════════════════════════════════════════════════════
  // Each carries its paper's sort and filter fields (convex/library/facets.ts), so a collection's
  // view reads its own index. One inserted without them gets them from its trigger.
  libraryItemCollections: defineTable({
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
    assignedAt: v.number(),
    savedAt: v.optional(v.number()),
    rating: v.optional(v.number()),
    // In an organization's collection, how many of its members gave `rating`, their average (#655); none in a person's own.
    ratingCount: v.optional(v.number()),
    publicationYear: v.optional(v.number()),
    citedByCount: v.optional(v.number()),
    title: v.optional(v.string()),
  })
    // In the order papers were put in it.
    .index("by_collection", ["collectionId"])
    .index("by_item", ["libraryItemId"])
    .index("by_collection_item", ["collectionId", "libraryItemId"])
    .index("by_collection_savedAt", ["collectionId", "savedAt"])
    .index("by_collection_rating", ["collectionId", "rating"])
    .index("by_collection_year", ["collectionId", "publicationYear"])
    .index("by_collection_citedByCount", ["collectionId", "citedByCount"])
    .index("by_collection_title", ["collectionId", "title"]),

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

  // The papers whose PDF each chat or extraction (`scope`) has had (`had`), or is paying for since `at`, so it pays once for each (convex/lib/paperPdfs.ts).
  paperPdfReads: defineTable({ scope: v.string(), key: v.string(), had: v.boolean(), at: v.number() }).index("by_scope_and_key", ["scope", "key"]),

  // A paper no free copy of whose PDF was found, by its DOI or OpenAlex ID and the link it was searched with (`key`): it isn't searched again until `retryAt`, which each further miss (`tries`) moves further off (convex/lib/paperPdfs.ts).
  paperPdfMisses: defineTable({ key: v.string(), reason: v.string(), retryAt: v.number(), tries: v.number() }).index("by_key", ["key"]),
});
