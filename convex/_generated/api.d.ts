/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys_actions from "../apiKeys/actions.js";
import type * as apiKeys_mutations from "../apiKeys/mutations.js";
import type * as apiKeys_queries from "../apiKeys/queries.js";
import type * as credits_internal from "../credits/internal.js";
import type * as credits_mutations from "../credits/mutations.js";
import type * as credits_queries from "../credits/queries.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_helpers from "../lib/helpers.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_validators from "../lib/validators.js";
import type * as maintenance_internal from "../maintenance/internal.js";
import type * as memberships_internal from "../memberships/internal.js";
import type * as memberships_mutations from "../memberships/mutations.js";
import type * as memberships_queries from "../memberships/queries.js";
import type * as organizations_internal from "../organizations/internal.js";
import type * as organizations_mutations from "../organizations/mutations.js";
import type * as organizations_queries from "../organizations/queries.js";
import type * as subscriptions_actions from "../subscriptions/actions.js";
import type * as subscriptions_internal from "../subscriptions/internal.js";
import type * as subscriptions_mutations from "../subscriptions/mutations.js";
import type * as subscriptions_queries from "../subscriptions/queries.js";
import type * as users_internal from "../users/internal.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";
import type * as webhooks_actions from "../webhooks/actions.js";
import type * as webhooks_stripe from "../webhooks/stripe.js";
import type * as webhooks_workos from "../webhooks/workos.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "apiKeys/actions": typeof apiKeys_actions;
  "apiKeys/mutations": typeof apiKeys_mutations;
  "apiKeys/queries": typeof apiKeys_queries;
  "credits/internal": typeof credits_internal;
  "credits/mutations": typeof credits_mutations;
  "credits/queries": typeof credits_queries;
  crons: typeof crons;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/crypto": typeof lib_crypto;
  "lib/helpers": typeof lib_helpers;
  "lib/permissions": typeof lib_permissions;
  "lib/validators": typeof lib_validators;
  "maintenance/internal": typeof maintenance_internal;
  "memberships/internal": typeof memberships_internal;
  "memberships/mutations": typeof memberships_mutations;
  "memberships/queries": typeof memberships_queries;
  "organizations/internal": typeof organizations_internal;
  "organizations/mutations": typeof organizations_mutations;
  "organizations/queries": typeof organizations_queries;
  "subscriptions/actions": typeof subscriptions_actions;
  "subscriptions/internal": typeof subscriptions_internal;
  "subscriptions/mutations": typeof subscriptions_mutations;
  "subscriptions/queries": typeof subscriptions_queries;
  "users/internal": typeof users_internal;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
  "webhooks/actions": typeof webhooks_actions;
  "webhooks/stripe": typeof webhooks_stripe;
  "webhooks/workos": typeof webhooks_workos;
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

export declare const components: {};
