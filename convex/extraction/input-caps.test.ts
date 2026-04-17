import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import {
  assertExtractionInputLimits,
  MAX_QUESTIONS_PER_JOB,
  MAX_MANUAL_ITEMS_PER_JOB,
  MAX_ZOTERO_ITEMS_PER_JOB,
  MAX_HISTORY_ENTRIES_PER_JOB,
  MAX_QUESTION_TEXT_LENGTH,
  MAX_PAPER_TITLE_LENGTH,
  MAX_PAPER_ABSTRACT_LENGTH,
} from "./validators";
import { MAX_PDF_URL_LENGTH } from "../../lib/pdf/url-allowlist";

function question(text = "What is the study design?") {
  return { key: "k", question: text };
}

function manualItem(overrides: {
  title?: string;
  abstract?: string;
  pdfUrl?: string;
} = {}) {
  return {
    title: overrides.title ?? "A short paper title",
    abstract: overrides.abstract,
    pdfUrl: overrides.pdfUrl,
  };
}

function expectValidationError(fn: () => void) {
  try {
    fn();
    throw new Error("expected ConvexError VALIDATION_ERROR, got no throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError);
    const data = (e as ConvexError<{ code: string; message?: string }>).data;
    expect(data.code).toBe("VALIDATION_ERROR");
  }
}

describe("assertExtractionInputLimits", () => {
  it("accepts a minimal valid input", () => {
    expect(() =>
      assertExtractionInputLimits({
        questions: [question()],
      }),
    ).not.toThrow();
  });

  it("accepts exactly MAX_QUESTIONS_PER_JOB questions", () => {
    const questions = Array.from({ length: MAX_QUESTIONS_PER_JOB }, () =>
      question(),
    );
    expect(() => assertExtractionInputLimits({ questions })).not.toThrow();
  });

  it("rejects more than MAX_QUESTIONS_PER_JOB questions", () => {
    const questions = Array.from(
      { length: MAX_QUESTIONS_PER_JOB + 1 },
      () => question(),
    );
    expectValidationError(() => assertExtractionInputLimits({ questions }));
  });

  it("rejects a question whose text exceeds MAX_QUESTION_TEXT_LENGTH", () => {
    const long = "x".repeat(MAX_QUESTION_TEXT_LENGTH + 1);
    expectValidationError(() =>
      assertExtractionInputLimits({ questions: [question(long)] }),
    );
  });

  it("accepts a question text exactly at MAX_QUESTION_TEXT_LENGTH", () => {
    const atLimit = "x".repeat(MAX_QUESTION_TEXT_LENGTH);
    expect(() =>
      assertExtractionInputLimits({ questions: [question(atLimit)] }),
    ).not.toThrow();
  });

  it("accepts exactly MAX_MANUAL_ITEMS_PER_JOB manual items", () => {
    const sourceManualItems = Array.from(
      { length: MAX_MANUAL_ITEMS_PER_JOB },
      () => manualItem(),
    );
    expect(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceManualItems,
      }),
    ).not.toThrow();
  });

  it("rejects more than MAX_MANUAL_ITEMS_PER_JOB manual items", () => {
    const sourceManualItems = Array.from(
      { length: MAX_MANUAL_ITEMS_PER_JOB + 1 },
      () => manualItem(),
    );
    expectValidationError(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceManualItems,
      }),
    );
  });

  it("rejects a manual item title longer than MAX_PAPER_TITLE_LENGTH", () => {
    const sourceManualItems = [
      manualItem({ title: "x".repeat(MAX_PAPER_TITLE_LENGTH + 1) }),
    ];
    expectValidationError(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceManualItems,
      }),
    );
  });

  it("rejects a manual item abstract longer than MAX_PAPER_ABSTRACT_LENGTH", () => {
    const sourceManualItems = [
      manualItem({ abstract: "x".repeat(MAX_PAPER_ABSTRACT_LENGTH + 1) }),
    ];
    expectValidationError(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceManualItems,
      }),
    );
  });

  it("rejects a manual item pdfUrl longer than MAX_PDF_URL_LENGTH", () => {
    const sourceManualItems = [
      manualItem({ pdfUrl: "https://example.com/" + "a".repeat(MAX_PDF_URL_LENGTH) }),
    ];
    expectValidationError(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceManualItems,
      }),
    );
  });

  it("allows a missing abstract / pdfUrl on a manual item", () => {
    expect(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceManualItems: [manualItem()],
      }),
    ).not.toThrow();
  });

  it("rejects more than MAX_ZOTERO_ITEMS_PER_JOB zotero items", () => {
    const items = Array.from(
      { length: MAX_ZOTERO_ITEMS_PER_JOB + 1 },
      () => ({}),
    );
    expectValidationError(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceZoteroSelection: { items },
      }),
    );
  });

  it("accepts exactly MAX_ZOTERO_ITEMS_PER_JOB zotero items", () => {
    const items = Array.from({ length: MAX_ZOTERO_ITEMS_PER_JOB }, () => ({}));
    expect(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceZoteroSelection: { items },
      }),
    ).not.toThrow();
  });

  it("rejects more than MAX_HISTORY_ENTRIES_PER_JOB history entries", () => {
    const sourceHistoryEntries = Array.from(
      { length: MAX_HISTORY_ENTRIES_PER_JOB + 1 },
      () => ({}),
    );
    expectValidationError(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceHistoryEntries,
      }),
    );
  });

  it("accepts exactly MAX_HISTORY_ENTRIES_PER_JOB history entries", () => {
    const sourceHistoryEntries = Array.from(
      { length: MAX_HISTORY_ENTRIES_PER_JOB },
      () => ({}),
    );
    expect(() =>
      assertExtractionInputLimits({
        questions: [question()],
        sourceHistoryEntries,
      }),
    ).not.toThrow();
  });
});
