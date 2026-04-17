/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_actions from "../ai/actions.js";
import type * as ai_config from "../ai/config.js";
import type * as ai_helpers from "../ai/helpers.js";
import type * as ai_lib_creditBilling from "../ai/lib/creditBilling.js";
import type * as apiKeys_actions from "../apiKeys/actions.js";
import type * as apiKeys_mutations from "../apiKeys/mutations.js";
import type * as apiKeys_queries from "../apiKeys/queries.js";
import type * as credits_actions from "../credits/actions.js";
import type * as credits_internal from "../credits/internal.js";
import type * as credits_lib_invoiceGrantPolicy from "../credits/lib/invoiceGrantPolicy.js";
import type * as credits_lib_retryPolicy from "../credits/lib/retryPolicy.js";
import type * as credits_queries from "../credits/queries.js";
import type * as crons from "../crons.js";
import type * as debug_papers from "../debug_papers.js";
import type * as extraction_access from "../extraction/access.js";
import type * as extraction_actions from "../extraction/actions.js";
import type * as extraction_content from "../extraction/content.js";
import type * as extraction_debug from "../extraction/debug.js";
import type * as extraction_debug_errors from "../extraction/debug_errors.js";
import type * as extraction_debug_job_citations from "../extraction/debug_job_citations.js";
import type * as extraction_debug_job_content from "../extraction/debug_job_content.js";
import type * as extraction_debug_paper_results from "../extraction/debug_paper_results.js";
import type * as extraction_debug_pdfjs_alignment from "../extraction/debug_pdfjs_alignment.js";
import type * as extraction_dedupe from "../extraction/dedupe.js";
import type * as extraction_evidence_units from "../extraction/evidence_units.js";
import type * as extraction_index from "../extraction/index.js";
import type * as extraction_jobSources from "../extraction/jobSources.js";
import type * as extraction_mutations from "../extraction/mutations.js";
import type * as extraction_mutations_evidence from "../extraction/mutations/evidence.js";
import type * as extraction_mutations_internal_admin from "../extraction/mutations/internal/admin.js";
import type * as extraction_mutations_internal_lifecycle from "../extraction/mutations/internal/lifecycle.js";
import type * as extraction_mutations_internal_onComplete from "../extraction/mutations/internal/onComplete.js";
import type * as extraction_mutations_jobs from "../extraction/mutations/jobs.js";
import type * as extraction_mutations_papers from "../extraction/mutations/papers.js";
import type * as extraction_mutations_reports from "../extraction/mutations/reports.js";
import type * as extraction_mutations_results from "../extraction/mutations/results.js";
import type * as extraction_mutations_savedViews from "../extraction/mutations/savedViews.js";
import type * as extraction_mutations_templates from "../extraction/mutations/templates.js";
import type * as extraction_paperLifecycle from "../extraction/paperLifecycle.js";
import type * as extraction_pdfjs_extract from "../extraction/pdfjs_extract.js";
import type * as extraction_prompts from "../extraction/prompts.js";
import type * as extraction_queries from "../extraction/queries.js";
import type * as extraction_stateMachine from "../extraction/stateMachine.js";
import type * as extraction_tests_fixtures from "../extraction/tests/fixtures.js";
import type * as extraction_tests_runners from "../extraction/tests/runners.js";
import type * as extraction_tests_seed from "../extraction/tests/seed.js";
import type * as extraction_types from "../extraction/types.js";
import type * as extraction_uploads from "../extraction/uploads.js";
import type * as extraction_validators from "../extraction/validators.js";
import type * as extraction_workflow from "../extraction/workflow.js";
import type * as extraction_workpoolActions from "../extraction/workpoolActions.js";
import type * as featureFlags_guard from "../featureFlags/guard.js";
import type * as featureFlags_internal from "../featureFlags/internal.js";
import type * as featureFlags_queries from "../featureFlags/queries.js";
import type * as http from "../http.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_assertNonProd from "../lib/assertNonProd.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cascade from "../lib/cascade.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_creditTopups from "../lib/creditTopups.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_envValidation from "../lib/envValidation.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_featureFlags from "../lib/featureFlags.js";
import type * as lib_freeCredits from "../lib/freeCredits.js";
import type * as lib_queryBounds from "../lib/queryBounds.js";
import type * as lib_query_states from "../lib/query_states.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_stripeCustomer from "../lib/stripeCustomer.js";
import type * as lib_stripeWebhookHandlers from "../lib/stripeWebhookHandlers.js";
import type * as lib_stripeWebhookSecret from "../lib/stripeWebhookSecret.js";
import type * as lib_userCreation from "../lib/userCreation.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_workpool from "../lib/workpool.js";
import type * as library_backfill from "../library/backfill.js";
import type * as library_backfillMutations from "../library/backfillMutations.js";
import type * as library_collections from "../library/collections.js";
import type * as library_mutations from "../library/mutations.js";
import type * as library_queries from "../library/queries.js";
import type * as maintenance_internal from "../maintenance/internal.js";
import type * as maintenance_mutations from "../maintenance/mutations.js";
import type * as models_mutations from "../models/mutations.js";
import type * as models_queries from "../models/queries.js";
import type * as models_sync from "../models/sync.js";
import type * as screening_mutations from "../screening/mutations.js";
import type * as screening_queries from "../screening/queries.js";
import type * as screening_scoring from "../screening/scoring.js";
import type * as screening_validators from "../screening/validators.js";
import type * as screening_workflow from "../screening/workflow.js";
import type * as screening_workpoolActions from "../screening/workpoolActions.js";
import type * as stripe from "../stripe.js";
import type * as subscriptions_actions from "../subscriptions/actions.js";
import type * as subscriptions_internal from "../subscriptions/internal.js";
import type * as subscriptions_lib_cancellation from "../subscriptions/lib/cancellation.js";
import type * as subscriptions_lib_eventLogPolicy from "../subscriptions/lib/eventLogPolicy.js";
import type * as subscriptions_lib_schedulePlanning from "../subscriptions/lib/schedulePlanning.js";
import type * as subscriptions_lib_selectCanonicalSubscription from "../subscriptions/lib/selectCanonicalSubscription.js";
import type * as subscriptions_lib_stripeStatus from "../subscriptions/lib/stripeStatus.js";
import type * as subscriptions_queries from "../subscriptions/queries.js";
import type * as testing_billing from "../testing/billing.js";
import type * as users_internal from "../users/internal.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";
import type * as wallet_actions from "../wallet/actions.js";
import type * as wallet_gateway_constants from "../wallet/gateway/constants.js";
import type * as wallet_gateway_cost from "../wallet/gateway/cost.js";
import type * as wallet_gateway_formatResponse from "../wallet/gateway/formatResponse.js";
import type * as wallet_gateway_handler from "../wallet/gateway/handler.js";
import type * as wallet_gateway_parseRequest from "../wallet/gateway/parseRequest.js";
import type * as wallet_gateway_reasoning from "../wallet/gateway/reasoning.js";
import type * as wallet_gateway_types from "../wallet/gateway/types.js";
import type * as wallet_internal from "../wallet/internal.js";
import type * as wallet_mutations from "../wallet/mutations.js";
import type * as wallet_nodeActions from "../wallet/nodeActions.js";
import type * as wallet_queries from "../wallet/queries.js";
import type * as webhooks_actions from "../webhooks/actions.js";
import type * as webhooks_clerk from "../webhooks/clerk.js";
import type * as webhooks_clerk_mappers from "../webhooks/clerk_mappers.js";
import type * as workflow from "../workflow.js";
import type * as workpool from "../workpool.js";
import type * as zotero_actions from "../zotero/actions.js";
import type * as zotero_internal from "../zotero/internal.js";
import type * as zotero_mutations from "../zotero/mutations.js";
import type * as zotero_queries from "../zotero/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/actions": typeof ai_actions;
  "ai/config": typeof ai_config;
  "ai/helpers": typeof ai_helpers;
  "ai/lib/creditBilling": typeof ai_lib_creditBilling;
  "apiKeys/actions": typeof apiKeys_actions;
  "apiKeys/mutations": typeof apiKeys_mutations;
  "apiKeys/queries": typeof apiKeys_queries;
  "credits/actions": typeof credits_actions;
  "credits/internal": typeof credits_internal;
  "credits/lib/invoiceGrantPolicy": typeof credits_lib_invoiceGrantPolicy;
  "credits/lib/retryPolicy": typeof credits_lib_retryPolicy;
  "credits/queries": typeof credits_queries;
  crons: typeof crons;
  debug_papers: typeof debug_papers;
  "extraction/access": typeof extraction_access;
  "extraction/actions": typeof extraction_actions;
  "extraction/content": typeof extraction_content;
  "extraction/debug": typeof extraction_debug;
  "extraction/debug_errors": typeof extraction_debug_errors;
  "extraction/debug_job_citations": typeof extraction_debug_job_citations;
  "extraction/debug_job_content": typeof extraction_debug_job_content;
  "extraction/debug_paper_results": typeof extraction_debug_paper_results;
  "extraction/debug_pdfjs_alignment": typeof extraction_debug_pdfjs_alignment;
  "extraction/dedupe": typeof extraction_dedupe;
  "extraction/evidence_units": typeof extraction_evidence_units;
  "extraction/index": typeof extraction_index;
  "extraction/jobSources": typeof extraction_jobSources;
  "extraction/mutations": typeof extraction_mutations;
  "extraction/mutations/evidence": typeof extraction_mutations_evidence;
  "extraction/mutations/internal/admin": typeof extraction_mutations_internal_admin;
  "extraction/mutations/internal/lifecycle": typeof extraction_mutations_internal_lifecycle;
  "extraction/mutations/internal/onComplete": typeof extraction_mutations_internal_onComplete;
  "extraction/mutations/jobs": typeof extraction_mutations_jobs;
  "extraction/mutations/papers": typeof extraction_mutations_papers;
  "extraction/mutations/reports": typeof extraction_mutations_reports;
  "extraction/mutations/results": typeof extraction_mutations_results;
  "extraction/mutations/savedViews": typeof extraction_mutations_savedViews;
  "extraction/mutations/templates": typeof extraction_mutations_templates;
  "extraction/paperLifecycle": typeof extraction_paperLifecycle;
  "extraction/pdfjs_extract": typeof extraction_pdfjs_extract;
  "extraction/prompts": typeof extraction_prompts;
  "extraction/queries": typeof extraction_queries;
  "extraction/stateMachine": typeof extraction_stateMachine;
  "extraction/tests/fixtures": typeof extraction_tests_fixtures;
  "extraction/tests/runners": typeof extraction_tests_runners;
  "extraction/tests/seed": typeof extraction_tests_seed;
  "extraction/types": typeof extraction_types;
  "extraction/uploads": typeof extraction_uploads;
  "extraction/validators": typeof extraction_validators;
  "extraction/workflow": typeof extraction_workflow;
  "extraction/workpoolActions": typeof extraction_workpoolActions;
  "featureFlags/guard": typeof featureFlags_guard;
  "featureFlags/internal": typeof featureFlags_internal;
  "featureFlags/queries": typeof featureFlags_queries;
  http: typeof http;
  "lib/analytics": typeof lib_analytics;
  "lib/assertNonProd": typeof lib_assertNonProd;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/cascade": typeof lib_cascade;
  "lib/constants": typeof lib_constants;
  "lib/creditTopups": typeof lib_creditTopups;
  "lib/crypto": typeof lib_crypto;
  "lib/env": typeof lib_env;
  "lib/envValidation": typeof lib_envValidation;
  "lib/errors": typeof lib_errors;
  "lib/featureFlags": typeof lib_featureFlags;
  "lib/freeCredits": typeof lib_freeCredits;
  "lib/queryBounds": typeof lib_queryBounds;
  "lib/query_states": typeof lib_query_states;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/stripeCustomer": typeof lib_stripeCustomer;
  "lib/stripeWebhookHandlers": typeof lib_stripeWebhookHandlers;
  "lib/stripeWebhookSecret": typeof lib_stripeWebhookSecret;
  "lib/userCreation": typeof lib_userCreation;
  "lib/validators": typeof lib_validators;
  "lib/workpool": typeof lib_workpool;
  "library/backfill": typeof library_backfill;
  "library/backfillMutations": typeof library_backfillMutations;
  "library/collections": typeof library_collections;
  "library/mutations": typeof library_mutations;
  "library/queries": typeof library_queries;
  "maintenance/internal": typeof maintenance_internal;
  "maintenance/mutations": typeof maintenance_mutations;
  "models/mutations": typeof models_mutations;
  "models/queries": typeof models_queries;
  "models/sync": typeof models_sync;
  "screening/mutations": typeof screening_mutations;
  "screening/queries": typeof screening_queries;
  "screening/scoring": typeof screening_scoring;
  "screening/validators": typeof screening_validators;
  "screening/workflow": typeof screening_workflow;
  "screening/workpoolActions": typeof screening_workpoolActions;
  stripe: typeof stripe;
  "subscriptions/actions": typeof subscriptions_actions;
  "subscriptions/internal": typeof subscriptions_internal;
  "subscriptions/lib/cancellation": typeof subscriptions_lib_cancellation;
  "subscriptions/lib/eventLogPolicy": typeof subscriptions_lib_eventLogPolicy;
  "subscriptions/lib/schedulePlanning": typeof subscriptions_lib_schedulePlanning;
  "subscriptions/lib/selectCanonicalSubscription": typeof subscriptions_lib_selectCanonicalSubscription;
  "subscriptions/lib/stripeStatus": typeof subscriptions_lib_stripeStatus;
  "subscriptions/queries": typeof subscriptions_queries;
  "testing/billing": typeof testing_billing;
  "users/internal": typeof users_internal;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
  "wallet/actions": typeof wallet_actions;
  "wallet/gateway/constants": typeof wallet_gateway_constants;
  "wallet/gateway/cost": typeof wallet_gateway_cost;
  "wallet/gateway/formatResponse": typeof wallet_gateway_formatResponse;
  "wallet/gateway/handler": typeof wallet_gateway_handler;
  "wallet/gateway/parseRequest": typeof wallet_gateway_parseRequest;
  "wallet/gateway/reasoning": typeof wallet_gateway_reasoning;
  "wallet/gateway/types": typeof wallet_gateway_types;
  "wallet/internal": typeof wallet_internal;
  "wallet/mutations": typeof wallet_mutations;
  "wallet/nodeActions": typeof wallet_nodeActions;
  "wallet/queries": typeof wallet_queries;
  "webhooks/actions": typeof webhooks_actions;
  "webhooks/clerk": typeof webhooks_clerk;
  "webhooks/clerk_mappers": typeof webhooks_clerk_mappers;
  workflow: typeof workflow;
  workpool: typeof workpool;
  "zotero/actions": typeof zotero_actions;
  "zotero/internal": typeof zotero_internal;
  "zotero/mutations": typeof zotero_mutations;
  "zotero/queries": typeof zotero_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  workpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"workpool">;
  screeningWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"screeningWorkpool">;
};
