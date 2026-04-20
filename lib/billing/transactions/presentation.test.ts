import { describe, it, expect } from "vitest";
import {
  CreditCard,
  Gift,
  Hourglass,
  ListChecks,
  MessageSquare,
  Network,
  Sparkles,
  Undo2,
  Zap,
} from "lucide-react";
import {
  BILLING_TYPE_ICON,
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
});
