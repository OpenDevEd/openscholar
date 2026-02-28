import { describe, expect, it } from "vitest";
import {
  validateQuery,
  repairJSON,
  repairSingleField,
} from "../lib/ai/core/validate";

describe("validateQuery", () => {
  describe("valid queries", () => {
    it("returns the query for balanced parentheses", () => {
      const query = "(AI OR ML) AND health";
      expect(validateQuery(query)).toBe(query);
    });

    it("returns the query when there are no parentheses", () => {
      const query = "climate change";
      expect(validateQuery(query)).toBe(query);
    });

    it("returns the query for deeply nested parentheses", () => {
      const query = "((nested)) AND test";
      expect(validateQuery(query)).toBe(query);
    });

    it("returns the query for an empty string", () => {
      expect(validateQuery("")).toBe("");
    });
  });

  describe("invalid queries", () => {
    it("throws on unbalanced parentheses (more opens than closes)", () => {
      expect(() => validateQuery("(AI OR ML AND health")).toThrow(
        "unbalanced parentheses"
      );
    });

    it("throws on unbalanced parentheses (more closes than opens)", () => {
      expect(() => validateQuery("AI AND health)")).toThrow(
        "unbalanced parentheses"
      );
    });

    it("throws on trailing OR operator", () => {
      expect(() => validateQuery("AI OR")).toThrow();
    });

    it("throws on trailing AND operator with whitespace", () => {
      expect(() => validateQuery("health AND ")).toThrow();
    });

    it("throws when entire string is NOT", () => {
      expect(() => validateQuery("NOT")).toThrow();
    });
  });
});

describe("repairJSON", () => {
  describe("non-JSON text (does not start with {)", () => {
    it("returns trimmed text for padded non-JSON input", async () => {
      const result = await repairJSON("  hello world  ", null);
      expect(result).toBe("hello world");
    });

    it("returns plain text as-is when already trimmed", async () => {
      const result = await repairJSON("plain text answer", null);
      expect(result).toBe("plain text answer");
    });
  });

  describe("repairable JSON", () => {
    it("repairs JSON with trailing comma", async () => {
      const result = await repairJSON('{"key": "value",}', null);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.key).toBe("value");
    });

    it("repairs JSON with unquoted keys and single quotes", async () => {
      const result = await repairJSON("{key: 'value'}", null);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.key).toBe("value");
    });
  });

  describe("unrepairable JSON-like text", () => {
    it("returns null for completely broken JSON-like input", async () => {
      const result = await repairJSON("{completely broken {{{{", null);
      expect(result).toBeNull();
    });

    it("returns null for input that is all braces", async () => {
      const result = await repairJSON("{{{{{{{{{{", null);
      expect(result).toBeNull();
    });
  });
});

describe("repairSingleField", () => {
  it("wraps non-JSON text in a field object", async () => {
    const result = await repairSingleField(
      "hello world",
      null,
      "enhancedQuery"
    );
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.enhancedQuery).toBe("hello world");
  });

  it("passes JSON through to repairJSON for repair", async () => {
    const result = await repairSingleField(
      '{"enhancedQuery": "test",}',
      null,
      "enhancedQuery"
    );
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.enhancedQuery).toBe("test");
  });

  it("returns null when repairJSON returns null", async () => {
    const result = await repairSingleField("{{{broken", null, "field");
    expect(result).toBeNull();
  });
});
