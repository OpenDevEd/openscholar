import { describe, expect, it } from "vitest";
import {
  buildEnhanceQueryPrompts,
  buildScreeningQuestionsPrompts,
  buildTranslateQueryPrompts,
  buildTranslatePaperContentPrompts,
  buildScreeningResponsesPrompts,
} from "../lib/ai/core/prompts";

describe("buildEnhanceQueryPrompts", () => {
  it("returns system and prompt with expected markers for base case", () => {
    const result = buildEnhanceQueryPrompts({ query: "climate change" }, 0);
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("prompt");
    expect(result.system).toBeTruthy();
    expect(result.prompt).toBeTruthy();
    expect(result.system).toContain("JSON");
    expect(result.system).toContain("enhancedQuery");
    expect(result.prompt).toContain("climate change");
  });

  it("includes language name when language is provided", () => {
    const result = buildEnhanceQueryPrompts(
      { query: "test", language: "fr" },
      0
    );
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("prompt");
    expect(result.system).toBeTruthy();
    expect(result.prompt).toBeTruthy();
    expect(result.system).toContain("French");
  });

  it("includes retry guidance when retryCount > 0", () => {
    const result = buildEnhanceQueryPrompts({ query: "test" }, 1);
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("prompt");
    expect(result.system).toBeTruthy();
    expect(result.prompt).toBeTruthy();
    expect(result.prompt).toContain("unbalanced parentheses");
  });
});

describe("buildScreeningQuestionsPrompts", () => {
  it("returns system and prompt with expected markers for base case", () => {
    const result = buildScreeningQuestionsPrompts({
      researchQuestion: "Effect of exercise on depression",
      existingQuestions: [],
    });
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("prompt");
    expect(result.system).toBeTruthy();
    expect(result.prompt).toBeTruthy();
    expect(result.system).toContain("JSON");
    expect(result.system).toContain("questions");
    expect(result.prompt).toContain("Effect of exercise on depression");
  });

  it("includes existing questions in prompt", () => {
    const result = buildScreeningQuestionsPrompts({
      researchQuestion: "test",
      existingQuestions: ["Q1", "Q2"],
    });
    expect(result.prompt).toContain("Q1");
    expect(result.prompt).toContain("Q2");
  });

  it("includes language name when responseLanguage is provided", () => {
    const result = buildScreeningQuestionsPrompts({
      researchQuestion: "test",
      existingQuestions: [],
      responseLanguage: "fr",
    });
    const combined = result.system + result.prompt;
    expect(combined).toContain("French");
  });
});

describe("buildTranslateQueryPrompts", () => {
  it("returns system and prompt with operator preservation rule and target language", () => {
    const result = buildTranslateQueryPrompts({
      query: "(AI OR ML) AND health",
      targetLanguage: "fr",
    });
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("prompt");
    expect(result.system).toBeTruthy();
    expect(result.prompt).toBeTruthy();
    expect(result.system).toContain("AND, OR, and NOT");
    expect(result.prompt).toContain("(AI OR ML) AND health");
    expect(result.prompt).toContain("French");
  });
});

describe("buildTranslatePaperContentPrompts", () => {
  it("returns system and prompt with expected markers for base case", () => {
    const result = buildTranslatePaperContentPrompts({
      title: "A Study",
      abstract: "An abstract",
    });
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("prompt");
    expect(result.system).toBeTruthy();
    expect(result.prompt).toBeTruthy();
    expect(result.system).toContain("JSON");
    expect(result.system).toContain("translatedTitle");
    expect(result.system).toContain("translatedAbstract");
    expect(result.prompt).toContain("A Study");
    expect(result.prompt).toContain("An abstract");
  });

  it("includes target language name when targetLanguage is provided", () => {
    const result = buildTranslatePaperContentPrompts({
      title: "T",
      abstract: "A",
      targetLanguage: "zh",
    });
    expect(result.system).toContain("Chinese");
  });
});

describe("buildScreeningResponsesPrompts", () => {
  it("returns system and prompt with expected markers for base case", () => {
    const result = buildScreeningResponsesPrompts({
      title: "A Title",
      abstract: "An abstract",
      questions: ["Q1?", "Q2?"],
    });
    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("prompt");
    expect(result.system).toBeTruthy();
    expect(result.prompt).toBeTruthy();
    expect(result.system).toContain("JSON");
    expect(result.system).toContain("responses");
    expect(result.system).toContain("confidence");
    expect(result.prompt).toContain("A Title");
    expect(result.prompt).toContain("An abstract");
    expect(result.prompt).toContain("Q1?");
    expect(result.prompt).toContain("Q2?");
  });

  it("includes fallback text when abstract is empty", () => {
    const result = buildScreeningResponsesPrompts({
      title: "T",
      abstract: "",
      questions: ["Q?"],
    });
    expect(result.prompt).toContain("No abstract available");
  });
});
