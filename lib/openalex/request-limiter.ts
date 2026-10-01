/**
 * OpenAlex requests one visitor may make. Every request runs on OpenScholar's shared
 * key (2,000,000 credits a day), so without a limit one script could spend the day's
 * credits and stop search for everyone (#355). Each visitor has a burst per minute and a
 * total per day; a signed-in account has more of both.
 */
export const OPENALEX_REQUEST_LIMITS = {
  visitor: { perMinute: 60, perDay: 2_000 },
  account: { perMinute: 120, perDay: 10_000 },
} as const;

export type RequestLimit = { perMinute: number; perDay: number };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Bucket = { tokens: number; at: number };
type Buckets = { minute: Bucket; day: Bucket };

/** A token bucket's tokens at `now`, refilled at `capacity` per `period`. */
function refill(bucket: Bucket, capacity: number, period: number, now: number) {
  return { tokens: Math.min(capacity, bucket.tokens + ((now - bucket.at) * capacity) / period), at: now };
}

/**
 * Token buckets per key, held in this server's memory.
 *
 * ponytail: per process. dev.openscholar.ai runs as one container, so this is every
 * request; with several instances each would allow the full limit, and the buckets
 * would move to Convex's rateLimits table.
 */
export class RequestLimiter {
  private readonly buckets = new Map<string, Buckets>();

  constructor(private readonly maxKeys = 100_000) {}

  /** Takes `count` requests for `key`; false, taking none, when either bucket is short. */
  take(key: string, limit: RequestLimit, count = 1, now = Date.now()): boolean {
    const held = this.buckets.get(key);
    const minute = refill(held?.minute ?? { tokens: limit.perMinute, at: now }, limit.perMinute, MINUTE, now);
    const day = refill(held?.day ?? { tokens: limit.perDay, at: now }, limit.perDay, DAY, now);
    const allowed = minute.tokens >= count && day.tokens >= count;
    if (allowed) {
      minute.tokens -= count;
      day.tokens -= count;
    }
    // Re-inserted last, so the oldest key is first to go when the map is full.
    this.buckets.delete(key);
    this.buckets.set(key, { minute, day });
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    return allowed;
  }
}
