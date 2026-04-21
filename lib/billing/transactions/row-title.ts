import type { TransactionViewModel } from "./transaction-view-model";

type TitleSource =
  | "paper-title"
  | "job-name"
  | "chat"
  | "wallet-api"
  | "openalex-ref"
  | "purchase-packed"
  | "grant-packed"
  | "refund-packed"
  | "expiry-packed"
  | "service-fallback"
  | "description";

export type TitleResolution =
  | { kind: "literal"; text: string; source: TitleSource }
  | {
      kind: "translated";
      key: string;
      values?: Record<string, string | number>;
      source: TitleSource;
    };

/**
 * next-intl types `t` with a precise key union derived from the message
 * tree; pure-function resolvers like this one emit keys known only at
 * runtime. A widened signature keeps consumers compiling without the
 * "instantiation excessively deep" error.
 */
export type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function renderTitle(resolution: TitleResolution, t: Translator): string {
  if (resolution.kind === "literal") return resolution.text;
  return t(resolution.key, resolution.values);
}

export function resolveAndRenderTitle(
  row: TransactionViewModel,
  t: Translator,
): string {
  return renderTitle(resolveTitle(row), t);
}

export function resolveTitle(row: TransactionViewModel): TitleResolution {
  switch (row.type) {
    case "purchase":
      return {
        kind: "translated",
        key: "titles.paidCredits",
        values: { amount: row.amount },
        source: "purchase-packed",
      };
    case "grant":
      return {
        kind: "translated",
        key: "titles.freeCredits",
        values: { amount: row.amount },
        source: "grant-packed",
      };
    case "refund":
      return {
        kind: "translated",
        key: "titles.refund",
        values: { amount: row.amount },
        source: "refund-packed",
      };
    case "expiry":
      return {
        kind: "translated",
        key: "titles.freeCreditsExpired",
        values: { amount: row.amount },
        source: "expiry-packed",
      };
    case "usage": {
      if (row.billingType === "chat") {
        return { kind: "translated", key: "titles.chatMessage", source: "chat" };
      }
      if (row.billingType === "wallet_api" && row.modelLabel) {
        return {
          kind: "translated",
          key: "titles.walletApi",
          values: { model: row.modelLabel },
          source: "wallet-api",
        };
      }
      const paperTitle = cleanLiteral(row.paperTitle);
      if (paperTitle) {
        return { kind: "literal", text: paperTitle, source: "paper-title" };
      }
      const jobName = cleanLiteral(row.jobName);
      if (jobName) {
        return { kind: "literal", text: jobName, source: "job-name" };
      }
      if (row.openalexRef) {
        return {
          kind: "translated",
          key: "titles.paperRef",
          values: { ref: row.openalexRef },
          source: "openalex-ref",
        };
      }
      if (row.billingType === "extraction_llm") {
        return { kind: "translated", key: "titles.extraction", source: "service-fallback" };
      }
      if (row.billingType === "embedding") {
        return { kind: "translated", key: "titles.indexing", source: "service-fallback" };
      }
      if (row.billingType === "screening") {
        return { kind: "translated", key: "titles.screening", source: "service-fallback" };
      }
      if (row.billingType === "search") {
        return { kind: "translated", key: "titles.search", source: "service-fallback" };
      }
      if (row.billingType === "translation") {
        return { kind: "translated", key: "titles.translation", source: "service-fallback" };
      }
      if (row.billingType === "wallet_api") {
        return { kind: "translated", key: "titles.walletApiGeneric", source: "service-fallback" };
      }
      const descriptionTitle = humanizeDescription(row.description);
      if (descriptionTitle) {
        return { kind: "literal", text: descriptionTitle, source: "description" };
      }
      return { kind: "translated", key: "type.usage", source: "service-fallback" };
    }
  }
}

function cleanLiteral(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed;
}

/**
 * Strip the implementation-leak "AI:" prefix so descriptions like
 * `"AI: Enhance search query"` render as `"Enhance search query"`.
 * Returns null when the cleaned string is empty.
 */
function humanizeDescription(raw: string | null): string | null {
  const trimmed = cleanLiteral(raw);
  if (!trimmed) return null;
  return trimmed.replace(/^AI\s*:\s*/i, "").trim() || null;
}
