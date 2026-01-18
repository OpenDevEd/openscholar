/**
 * Rate Limiting for Convex Functions
 * 
 * This module provides basic rate limiting patterns.
 * For production use, consider implementing a dedicated rateLimits table
 * to track request counts per user/action/time window.
 */

type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
  description: string;
};

/**
 * Rate limit configurations
 * Adjust these based on your application's needs
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "api-key-save": {
    maxRequests: 5,
    windowMs: 60_000,
    description: "API key encryption - prevent key enumeration attacks"
  },
  "checkout-session": {
    maxRequests: 3,
    windowMs: 60_000,
    description: "Checkout session creation - prevent session spam"
  },
  "ensure-user": {
    maxRequests: 10,
    windowMs: 60_000,
    description: "User sync - prevent webhook storm issues"
  },
};

/**
 * Rate limiting implementation notes:
 * 
 * To fully implement rate limiting in Convex:
 * 
 * 1. Add a rateLimits table to schema.ts:
 *    rateLimits: defineTable({
 *      userId: v.string(),
 *      action: v.string(),
 *      timestamp: v.number(),
 *    })
 *      .index("by_user_action", ["userId", "action"])
 *      .index("by_timestamp", ["timestamp"]),
 * 
 * 2. Implement checkRateLimit in a mutation:
 *    - Query recent requests within window
 *    - Count requests
 *    - Throw if limit exceeded
 *    - Insert new request record
 * 
 * 3. Add cleanup cron to remove old entries:
 *    - Daily cleanup of records older than max window
 * 
 * For now, rate limiting is handled at the application layer
 * (e.g., client-side debouncing, server middleware)
 */

/**
 * Simple client-side rate limit checker (informational only)
 * This doesn't enforce limits, just provides configuration info
 */
export function getRateLimitConfig(action: string): RateLimitConfig | null {
  return RATE_LIMITS[action] ?? null;
}
