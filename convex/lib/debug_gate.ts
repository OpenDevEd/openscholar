/**
 * Debug gate module -- controls access to all debug and test functions.
 *
 * Policy: All debug/test functions in convex/extraction/ are gated by this module.
 * The ENABLE_PUBLIC_DEBUG_FUNCTIONS environment variable must be set to "true"
 * in the Convex dashboard for these functions to be accessible.
 *
 * Security layers:
 * 1. Environment variable gate (this function) -- kill switch for all debug functions
 * 2. Authentication check (requireAuth in each handler) -- ensures only logged-in users can access
 * 3. Audit logging (this function) -- logs every successful gate passage for traceability
 *
 * Production: This variable should NEVER be "true" in production.
 * Staging: Set to "true" to enable debug and test functions.
 */

import { createError } from "./errors";

export function requirePublicDebugEnabled() {
  if (process.env.ENABLE_PUBLIC_DEBUG_FUNCTIONS !== "true") {
    throw createError("FORBIDDEN", "Debug functions are disabled");
  }

  // Audit log: trace every debug function invocation for security monitoring
  console.log(
    "[AUDIT:DEBUG_ACCESS]",
    JSON.stringify({
      gate: "ENABLE_PUBLIC_DEBUG_FUNCTIONS",
      timestamp: new Date().toISOString(),
    }),
  );
}
