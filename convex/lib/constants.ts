/**
 * Markup multiplier applied to raw AI token costs before deducting credits.
 * Single source of truth lives in `lib/pricing/constants.ts`; re-exported
 * here only because this file is a multi-purpose grab-bag and existing
 * callers import it from `@/convex/lib/constants`.
 */
export { AI_COST_MARKUP } from "@/lib/pricing";

/**
 * Replies the assistant writes for one person at once. A deployment runs so many actions at
 * a time, 64 unless the backend is set otherwise, shared by everyone on it; this keeps one
 * account to a quarter of them.
 */
export const ASSISTANT_REPLIES_AT_ONCE = 16;

/**
 * Model requests a reply makes before it pauses and asks whether to carry on. A person's
 * own limit is in credits (convex/assistant/spending.ts); this one is there for the reply
 * that keeps finding something new to do and would otherwise run until the credits are gone.
 */
export const ASSISTANT_REQUESTS_BEFORE_ASKING = 1_000;

/**
 * The limits listed for what one job may hold without asking, once a person allows jobs
 * that spend credits in a chat (#328). "Always allow in this chat" picks the smallest that
 * covers the job it was said to.
 */
export const ASSISTANT_JOB_CAPS = [100, 250, 1_000] as const;
