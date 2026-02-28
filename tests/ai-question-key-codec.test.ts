import { describe, expect, it } from "vitest";
import {
  encodeQuestionKey,
  decodeQuestionKey,
  encodeQuestionResponseMap,
  decodeQuestionResponseMap,
} from "../lib/ai/core/question-key-codec";

describe("ai question key codec", () => {
  describe("encodeQuestionKey / decodeQuestionKey round-trip", () => {
    it.each([
      "Is this a randomized trial?",
      "Does the study focus on adults?",
      "Existe-t-il un groupe controle?",
      "\u8FD9\u662F\u968F\u673A\u8BD5\u9A8C\u5417\uFF1F",
      "\u0647\u0644 \u0647\u0630\u0647 \u062A\u062C\u0631\u0628\u0629 \u0639\u0634\u0648\u0627\u0626\u064A\u0629\u061F",
      "Study with special chars: &=?#/",
      "",
    ])(
      "round-trips encodeQuestionKey/decodeQuestionKey: %s",
      (question) => {
        expect(decodeQuestionKey(encodeQuestionKey(question))).toBe(question);
      },
    );
  });

  describe("encodeQuestionKey format", () => {
    it("produces key starting with __qk__: prefix", () => {
      expect(encodeQuestionKey("test")).toMatch(/^__qk__:/);
    });

    it("URI-encodes the question content", () => {
      const encoded = encodeQuestionKey("hello world");
      expect(encoded).toContain("hello%20world");
    });
  });

  describe("decodeQuestionKey edge cases", () => {
    it("returns non-prefixed key unchanged (passthrough)", () => {
      expect(decodeQuestionKey("plain key")).toBe("plain key");
    });

    it("returns malformed prefixed key as-is", () => {
      const malformed = "__qk__:%E0%A4%A";
      expect(decodeQuestionKey(malformed)).toBe(malformed);
    });
  });

  describe("encodeQuestionResponseMap / decodeQuestionResponseMap", () => {
    it("round-trips a map with mixed boolean/null values", () => {
      const original: Record<string, boolean | null> = {
        "Is this an RCT?": true,
        "Adults only?": false,
        "Unclear methodology?": null,
      };
      const encoded = encodeQuestionResponseMap(original);
      const decoded = decodeQuestionResponseMap(encoded);
      expect(decoded).toEqual(original);
    });

    it("encodes all keys with __qk__: prefix", () => {
      const original: Record<string, boolean | null> = {
        "Is this an RCT?": true,
        "Adults only?": false,
      };
      const encoded = encodeQuestionResponseMap(original);
      for (const key of Object.keys(encoded)) {
        expect(key).toMatch(/^__qk__:/);
      }
    });

    it("round-trips an empty map", () => {
      expect(
        decodeQuestionResponseMap(encodeQuestionResponseMap({})),
      ).toEqual({});
    });

    it("round-trips a map with Unicode keys", () => {
      const unicodeMap: Record<string, boolean | null> = {
        "\u8FD9\u662F\u4EC0\u4E48\uFF1F": true,
        "Ceci est-il vrai?": null,
      };
      expect(
        decodeQuestionResponseMap(encodeQuestionResponseMap(unicodeMap)),
      ).toEqual(unicodeMap);
    });
  });
});
