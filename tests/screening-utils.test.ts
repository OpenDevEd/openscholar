import { describe, expect, it } from "vitest";
import { generateMissingScreeningCombinationsByPaper } from "../lib/screening-utils";

describe("generateMissingScreeningCombinationsByPaper", () => {
  it("returns empty when all papers have all responses", () => {
    const papers = [{ id: "p1" }, { id: "p2" }];
    const questions = [{ question: "Q1" }, { question: "Q2" }];
    const existing = {
      p1: { Q1: true, Q2: false },
      p2: { Q1: true, Q2: true },
    };

    const result = generateMissingScreeningCombinationsByPaper(
      papers,
      questions,
      existing
    );

    expect(result).toEqual({});
  });

  it("returns all questions for all papers when no responses exist", () => {
    const papers = [{ id: "p1" }, { id: "p2" }];
    const questions = [{ question: "Q1" }, { question: "Q2" }];
    const existing = {};

    const result = generateMissingScreeningCombinationsByPaper(
      papers,
      questions,
      existing
    );

    expect(result).toEqual({
      p1: ["Q1", "Q2"],
      p2: ["Q1", "Q2"],
    });
  });

  it("returns only missing questions for partially answered papers", () => {
    const papers = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    const questions = [{ question: "Q1" }, { question: "Q2" }];
    const existing = {
      p1: { Q1: true },
      p2: { Q1: false, Q2: true },
      // p3 has no responses
    };

    const result = generateMissingScreeningCombinationsByPaper(
      papers,
      questions,
      existing
    );

    // p1 missing Q2, p2 fully answered (excluded), p3 missing both
    expect(result).toEqual({
      p1: ["Q2"],
      p3: ["Q1", "Q2"],
    });
  });

  it("treats null response values as present (not missing)", () => {
    const papers = [{ id: "p1" }];
    const questions = [{ question: "Q1" }, { question: "Q2" }];
    const existing = {
      p1: { Q1: null, Q2: true },
    };

    const result = generateMissingScreeningCombinationsByPaper(
      papers,
      questions,
      existing
    );

    // Q1 has null value but is present (key exists), so not missing
    expect(result).toEqual({});
  });

  it("returns empty for empty papers array", () => {
    const papers: { id: string }[] = [];
    const questions = [{ question: "Q1" }, { question: "Q2" }];
    const existing = {};

    const result = generateMissingScreeningCombinationsByPaper(
      papers,
      questions,
      existing
    );

    expect(result).toEqual({});
  });

  it("returns empty for empty questions array", () => {
    const papers = [{ id: "p1" }, { id: "p2" }];
    const questions: { question: string }[] = [];
    const existing = {};

    const result = generateMissingScreeningCombinationsByPaper(
      papers,
      questions,
      existing
    );

    expect(result).toEqual({});
  });

  it("handles single paper with single missing question", () => {
    const papers = [{ id: "p1" }];
    const questions = [{ question: "Q1" }];
    const existing = {};

    const result = generateMissingScreeningCombinationsByPaper(
      papers,
      questions,
      existing
    );

    expect(result).toEqual({ p1: ["Q1"] });
  });
});
