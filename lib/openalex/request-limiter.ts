/**
 * OpenAlex requests one visitor may make. Every request runs on OpenScholar's shared
 * key (2,000,000 credits a day), so without a limit one script could spend the day's
 * credits and stop search for everyone (#355). Each visitor has a burst per minute and a
 * total per day; a signed-in account has more of both.
 */
export const OPENALEX_REQUEST_LIMITS = {
  // A page of saved searches counts each one, and a library's sources count up to 100
  // queries at once, so the burst leaves room for a few such pages a minute.
  visitor: { perMinute: 120, perDay: 2_000 },
  account: { perMinute: 300, perDay: 20_000 },
} as const;

export type RequestLimit = { perMinute: number; perDay: number };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Bucket = { tokens: number; at: number };
/** Requests counted since a day began: a fixed window, so a day never allows more than its total. */
type Day = { used: number; since: number };
type Buckets = { minute: Bucket; day: Day };

/** A token bucket's tokens at `now`, refilled at `capacity` per `period`. */
function refill(bucket: Bucket, capacity: number, period: number, now: number) {
  return { tokens: Math.min(capacity, bucket.tokens + ((now - bucket.at) * capacity) / period), at: now };
}

/**
 * A minute's token bucket and a day's fixed count per key, held in this server's memory.
 *
 * ponytail: per process. dev.openscholar.ai runs as one container, so this is every
 * request; with several instances each would allow the full limit, and the counts
 * would move to Convex's rateLimits table. A restart forgets the counts.
 */
export class RequestLimiter {
  private readonly buckets = new Map<string, Buckets>();

  constructor(private readonly maxKeys = 100_000) {}

  /** Takes `count` requests for `key`; false, taking none, when the minute or the day is short. */
  take(key: string, limit: RequestLimit, count = 1, now = Date.now()): boolean {
    const held = this.buckets.get(key);
    const minute = refill(held?.minute ?? { tokens: limit.perMinute, at: now }, limit.perMinute, MINUTE, now);
    const day = held && now - held.day.since < DAY ? { ...held.day } : { used: 0, since: now };
    const allowed = minute.tokens >= count && day.used + count <= limit.perDay;
    if (allowed) {
      minute.tokens -= count;
      day.used += count;
    }
    // Re-inserted last, so the oldest key is first to go when the map is full.
    this.buckets.delete(key);
    this.buckets.set(key, { minute, day });
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    return allowed;
  }
}
