import type { Doc } from "@/convex/_generated/dataModel";

/**
 * Deterministic 32-bit mulberry32 PRNG. Keeps bench outputs reproducible
 * across runs so median / p95 numbers reflect code changes, not fixture
 * churn. Seed: 0xC01DFEED (plan-06).
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const TX_TYPES = [
  // Weighted distribution: 70 usage, 20 purchase, 5 grant, 4 refund, 1 expiry.
  ...Array<"usage">(70).fill("usage"),
  ...Array<"purchase">(20).fill("purchase"),
  ...Array<"grant">(5).fill("grant"),
  ...Array<"refund">(4).fill("refund"),
  ...Array<"expiry">(1).fill("expiry"),
] as const satisfies readonly Doc<"creditTransactions">["type"][];

const BILLING_TYPES = [
  "extraction_llm",
  "embedding",
  "screening",
  "chat",
] as const;

const DESCRIPTIONS = [
  "Extraction run",
  "Embedding batch",
  "Screening pass",
  "Chat completion",
  "Top-up purchase",
  "Monthly grant",
  "Refund issued",
  "Credits expired",
  "Pro upgrade pro-rata",
  "Free trial bonus",
];

const PROTO_USER_ID = "j57eaadd6-user-00000000000000000" as Doc<"users">["_id"];
const PROTO_CREDITS_ID =
  "j5000000000000000000000000000000" as Doc<"credits">["_id"];

/**
 * Synthesize N creditTransactions documents suitable for `toViewModel`,
 * `buildFilterPredicate`, `partitionByGroup`, and `toCsv` benchmarks.
 *
 * Fixtures span ~120 days back from a fixed `now` (2026-04-20) so the
 * grouping benchmark hits every bucket (today / yesterday / this-week /
 * last-week / month-*).
 */
export function generateFixture(n: number): Doc<"creditTransactions">[] {
  const rand = mulberry32(0xc01dfeed);
  const nowMs = Date.UTC(2026, 3, 20, 12, 0, 0); // 2026-04-20T12:00:00Z
  const docs: Doc<"creditTransactions">[] = [];
  for (let i = 0; i < n; i++) {
    const type = TX_TYPES[Math.floor(rand() * TX_TYPES.length)]!;
    const isUsage = type === "usage" || type === "expiry";
    const amount = isUsage
      ? -Math.floor(rand() * 500 + 1)
      : Math.floor(rand() * 5000 + 100);
    const ageDays = Math.floor(rand() * 120);
    const createdAt = nowMs - ageDays * 86400000 - Math.floor(rand() * 86400000);

    const billingType =
      type === "usage"
        ? BILLING_TYPES[Math.floor(rand() * BILLING_TYPES.length)]
        : undefined;

    const hasStripe = type === "purchase" && rand() < 0.9;
    const doc: Doc<"creditTransactions"> = {
      _id: `ct_${i.toString(36).padStart(10, "0")}` as Doc<"creditTransactions">["_id"],
      _creationTime: createdAt,
      creditsId: PROTO_CREDITS_ID,
      userId: PROTO_USER_ID,
      type,
      creditType: rand() < 0.6 ? "paid" : "free",
      amount,
      balanceAfter: Math.max(0, 100_000 - i * 10),
      description: DESCRIPTIONS[Math.floor(rand() * DESCRIPTIONS.length)],
      billingType,
      metadata: {
        tokens: String(Math.floor(rand() * 2000)),
        model: rand() < 0.5 ? "claude-opus-4" : "claude-sonnet-4",
      },
      createdAt,
    };
    if (hasStripe) {
      doc.stripeInvoiceId = `in_${i.toString(36)}`;
      doc.stripePaymentIntentId = `pi_${i.toString(36)}`;
      doc.stripeChargeId = `ch_${i.toString(36)}`;
      doc.stripeCheckoutSessionId = `cs_${i.toString(36)}`;
    }
    if (type === "usage" && rand() < 0.7) {
      doc.jobId = `j_${i.toString(36)}` as Doc<"extractionJobs">["_id"];
      if (rand() < 0.5) {
        doc.paperId = `p_${i.toString(36)}` as Doc<"extractionPapers">["_id"];
      }
    }
    docs.push(doc);
  }
  return docs;
}
