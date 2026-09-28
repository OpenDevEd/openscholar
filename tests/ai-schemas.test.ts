import { describe, expect, it } from "vitest";
import {
  queryEnhancementSchema,
  screeningQuestionsSchema,
  createScreeningResponsesSchema,
  translateQuerySchema,
  translatePaperContentSchema,
  extractionQuestionsSchema,
  toExtractionQuestions,
} from "../lib/ai/core/schemas";

describe("ai schemas", () => {
  describe("queryEnhancementSchema", () => {
    it("accepts valid enhancedQuery", () => {
      const result = queryEnhancementSchema.parse({
        enhancedQuery: "AI AND health",
      });
      expect(result.enhancedQuery).toBe("AI AND health");
    });

    it("rejects missing enhancedQuery", () => {
      const result = queryEnhancementSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects wrong type for enhancedQuery", () => {
      const result = queryEnhancementSchema.safeParse({ enhancedQuery: 123 });
      expect(result.success).toBe(false);
    });
  });

  describe("screeningQuestionsSchema", () => {
    it("accepts valid questions array", () => {
      const result = screeningQuestionsSchema.parse({
        questions: ["Q1", "Q2", "Q3"],
      });
      expect(result.questions).toHaveLength(3);
    });

    it("rejects empty array (min 1)", () => {
      const result = screeningQuestionsSchema.safeParse({ questions: [] });
      expect(result.success).toBe(false);
    });

    it("rejects too many questions (max 10)", () => {
      const result = screeningQuestionsSchema.safeParse({
        questions: Array(11).fill("Q"),
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing questions field", () => {
      const result = screeningQuestionsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects wrong item type in array", () => {
      const result = screeningQuestionsSchema.safeParse({
        questions: [1, 2],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createScreeningResponsesSchema", () => {
    const questions = ["Is this RCT?", "Adults only?"];
    const schema = createScreeningResponsesSchema(questions);

    it("accepts valid responses with boolean values", () => {
      const result = schema.parse({
        responses: { "Is this RCT?": true, "Adults only?": false },
        confidence: 0.85,
      });
      expect(result.confidence).toBe(0.85);
    });

    it("accepts null response values", () => {
      const result = schema.parse({
        responses: { "Is this RCT?": null, "Adults only?": true },
        confidence: 0.5,
      });
      expect(result.responses["Is this RCT?"]).toBeNull();
    });

    it("rejects confidence above 1", () => {
      const result = schema.safeParse({
        responses: { "Is this RCT?": true, "Adults only?": false },
        confidence: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative confidence", () => {
      const result = schema.safeParse({
        responses: { "Is this RCT?": true, "Adults only?": false },
        confidence: -0.1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing confidence", () => {
      const result = schema.safeParse({
        responses: { "Is this RCT?": true, "Adults only?": false },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("translateQuerySchema", () => {
    it("accepts valid translatedQuery", () => {
      const result = translateQuerySchema.parse({
        translatedQuery: "IA ET sante",
      });
      expect(result.translatedQuery).toBe("IA ET sante");
    });

    it("rejects missing translatedQuery", () => {
      const result = translateQuerySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects wrong type for translatedQuery", () => {
      const result = translateQuerySchema.safeParse({ translatedQuery: 42 });
      expect(result.success).toBe(false);
    });
  });

  describe("translatePaperContentSchema", () => {
    it("accepts valid translatedTitle and translatedAbstract", () => {
      const result = translatePaperContentSchema.parse({
        translatedTitle: "Title",
        translatedAbstract: "Abstract",
      });
      expect(result.translatedTitle).toBe("Title");
      expect(result.translatedAbstract).toBe("Abstract");
    });

    it("rejects missing translatedAbstract", () => {
      const result = translatePaperContentSchema.safeParse({
        translatedTitle: "Title",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing translatedTitle", () => {
      const result = translatePaperContentSchema.safeParse({
        translatedAbstract: "A",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("extractionQuestionsSchema", () => {
    it("accepts question with description", () => {
      const result = extractionQuestionsSchema.parse({
        questions: [
          {
            question: "Sample size?",
            type: "number",
            description: "Total N",
          },
        ],
      });
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].description).toBe("Total N");
    });

    it("requires a description field, which strict structured output needs", () => {
      const result = extractionQuestionsSchema.safeParse({
        questions: [{ question: "RCT?", type: "boolean" }],
      });
      expect(result.success).toBe(false);
    });

    it("drops a null description from the questions it returns", () => {
      const output = extractionQuestionsSchema.parse({
        questions: [{ question: "RCT?", type: "boolean", description: null }],
      });
      expect(toExtractionQuestions(output).questions[0]).toEqual({ question: "RCT?", type: "boolean" });
    });

    it.each(["string", "boolean", "number", "array"] as const)(
      "accepts type value: %s",
      (typeValue) => {
        const result = extractionQuestionsSchema.parse({
          questions: [{ question: "Q", type: typeValue, description: null }],
        });
        expect(result.questions[0].type).toBe(typeValue);
      },
    );

    it("rejects invalid type enum value", () => {
      const result = extractionQuestionsSchema.safeParse({
        questions: [{ question: "Q", type: "invalid", description: null }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty array (min 1)", () => {
      const result = extractionQuestionsSchema.safeParse({ questions: [] });
      expect(result.success).toBe(false);
    });

    it("rejects too many questions (max 10)", () => {
      const result = extractionQuestionsSchema.safeParse({
        questions: Array(11).fill({ question: "Q", type: "string", description: null }),
      });
      expect(result.success).toBe(false);
    });
  });
});
