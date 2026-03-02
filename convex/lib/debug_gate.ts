/**
 * Debug gate module -- controls access to all debug and test functions.
 *
 * Policy: All debug/test functions in convex/extraction/ are gated by this module.
 * The ENABLE_PUBLIC_DEBUG_FUNCTIONS environment variable must be set to "true"
 * in the Convex dashboard for these functions to be accessible.
 *
 * Production: This variable should NEVER be "true" in production.
 * Staging: Set to "true" to enable debug and test functions.
 */

import { createError } from "./errors";

export function requirePublicDebugEnabled() {
  if (process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS !== "true") {
    throw createError("FORBIDDEN", "Debug functions are disabled");
  }
}
