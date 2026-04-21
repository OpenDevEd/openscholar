import { describe, it, expect } from "vitest";
import {
  CreditCard,
  Gift,
  Hourglass,
  Languages,
  ListChecks,
  MessageSquare,
  Network,
  Search,
  Sparkles,
  Undo2,
  Wallet,
  Zap,
} from "lucide-react";
import {
  BILLING_TYPES,
  BILLING_TYPE_ICON,
  TRANSACTION_TYPES,
  TYPE_PRESENTATION,
  presentationFor,
} from "./presentation";

describe("presentationFor", () => {
  it("purchase → CreditCard + --chart-2 + direction in", () => {
    const p = presentationFor("purchase");
    expect(p.icon).toBe(CreditCard);
    expect(p.colorVar).toBe("--chart-2");
    expect(p.direction).toBe("in");
    expect(p.i18nKey).toBe("type.purchase");
  });

  it("usage → Zap + direction out", () => {
    const p = presentationFor("usage");
    expect(p.icon).toBe(Zap);
    expect(p.direction).toBe("out");
    expect(p.i18nKey).toBe("type.usage");
  });

  it("expiry → --destructive + direction out", () => {
    const p = presentationFor("expiry");
    expect(p.icon).toBe(Hourglass);
    expect(p.colorVar).toBe("--destructive");
    expect(p.direction).toBe("out");
    expect(p.i18nKey).toBe("type.expiry");
  });

  it("grant → Gift + --chart-3 + direction in", () => {
    const p = presentationFor("grant");
    expect(p.icon).toBe(Gift);
    expect(p.colorVar).toBe("--chart-3");
    expect(p.direction).toBe("in");
  });

  it("refund → Undo2 + --chart-1 + direction in", () => {
    const p = presentationFor("refund");
    expect(p.icon).toBe(Undo2);
    expect(p.colorVar).toBe("--chart-1");
    expect(p.direction).toBe("in");
  });

  it("TYPE_PRESENTATION covers every TransactionType literal once", () => {
    expect(Object.keys(TYPE_PRESENTATION).sort()).toEqual([
      "expiry",
      "grant",
      "purchase",
      "refund",
      "usage",
    ]);
  });
});

describe("BILLING_TYPE_ICON", () => {
  it("extraction_llm → Sparkles", () => {
    expect(BILLING_TYPE_ICON.extraction_llm).toBe(Sparkles);
  });

  it("embedding → Network", () => {
    expect(BILLING_TYPE_ICON.embedding).toBe(Network);
  });

  it("screening → ListChecks", () => {
    expect(BILLING_TYPE_ICON.screening).toBe(ListChecks);
  });

  it("chat → MessageSquare", () => {
    expect(BILLING_TYPE_ICON.chat).toBe(MessageSquare);
  });

  it("search → Search", () => {
    expect(BILLING_TYPE_ICON.search).toBe(Search);
  });

  it("translation → Languages", () => {
    expect(BILLING_TYPE_ICON.translation).toBe(Languages);
  });

  it("wallet_api → Wallet", () => {
    expect(BILLING_TYPE_ICON.wallet_api).toBe(Wallet);
  });

  it("BILLING_TYPE_ICON covers every BILLING_TYPES literal exactly once", () => {
    expect(Object.keys(BILLING_TYPE_ICON).sort()).toEqual(
      [...BILLING_TYPES].sort(),
    );
  });
});

describe("constant arrays", () => {
  it("TRANSACTION_TYPES is the canonical 5-element list", () => {
    expect([...TRANSACTION_TYPES].sort()).toEqual([
      "expiry",
      "grant",
      "purchase",
      "refund",
      "usage",
    ]);
  });

  it("BILLING_TYPES includes every ledger literal the schema accepts", () => {
    expect([...BILLING_TYPES].sort()).toEqual([
      "chat",
      "embedding",
      "extraction_llm",
      "screening",
      "search",
      "translation",
      "wallet_api",
    ]);
  });
});
