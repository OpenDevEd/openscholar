import { describe, it, expect } from "vitest";
import { splitTextByQuery } from "@/components/extraction/results-views/highlighted-text";

describe("splitTextByQuery", () => {
  it("returns full text unchanged when query is empty", () => {
    const result = splitTextByQuery("some text", "");
    expect(result).toEqual([{ text: "some text", isMatch: false }]);
  });

  it("returns full text unchanged when query is whitespace-only", () => {
    const result = splitTextByQuery("some text", "   ");
    expect(result).toEqual([{ text: "some text", isMatch: false }]);
  });

  it("splits text correctly for a basic match", () => {
    const result = splitTextByQuery("hello world", "world");
    expect(result).toEqual([
      { text: "hello ", isMatch: false },
      { text: "world", isMatch: true },
    ]);
  });

  it("handles case-insensitive matching", () => {
    const result = splitTextByQuery("Case Test case", "case");
    expect(result).toEqual([
      { text: "Case", isMatch: true },
      { text: " Test ", isMatch: false },
      { text: "case", isMatch: true },
    ]);
  });

  it("handles multiple matches in one string", () => {
    const result = splitTextByQuery("the cat sat on the mat", "the");
    expect(result).toEqual([
      { text: "the", isMatch: true },
      { text: " cat sat on ", isMatch: false },
      { text: "the", isMatch: true },
      { text: " mat", isMatch: false },
    ]);
  });

  it("returns single non-matching segment when query not found", () => {
    const result = splitTextByQuery("no match here", "xyz");
    expect(result).toEqual([{ text: "no match here", isMatch: false }]);
  });

  describe("XSS safety", () => {
    it("treats script tags as literal text, not executable HTML", () => {
      const result = splitTextByQuery(
        '<script>alert("xss")</script>',
        "script"
      );
      // Should contain literal angle brackets as text segments
      const allText = result.map((s) => s.text).join("");
      expect(allText).toBe('<script>alert("xss")</script>');
      // The "script" parts should be marked as matches
      const matches = result.filter((s) => s.isMatch);
      expect(matches.length).toBe(2);
      expect(matches[0].text.toLowerCase()).toBe("script");
      expect(matches[1].text.toLowerCase()).toBe("script");
    });

    it("returns img onerror attack as single non-matching text when query is empty", () => {
      const result = splitTextByQuery(
        "<img onerror=alert(1) src=x>",
        ""
      );
      expect(result).toEqual([
        { text: "<img onerror=alert(1) src=x>", isMatch: false },
      ]);
    });

    it("handles HTML content in text with non-empty query", () => {
      const result = splitTextByQuery("<b>bold</b>", "");
      expect(result).toEqual([{ text: "<b>bold</b>", isMatch: false }]);
    });

    it("matches literal HTML characters in query", () => {
      const result = splitTextByQuery("use <b>bold</b>", "<b>");
      const matches = result.filter((s) => s.isMatch);
      expect(matches.length).toBe(1);
      expect(matches[0].text).toBe("<b>");
    });
  });

  describe("special regex characters", () => {
    it("escapes regex special characters in query and matches literally", () => {
      const result = splitTextByQuery(
        "open test.js file",
        "test.js"
      );
      expect(result).toEqual([
        { text: "open ", isMatch: false },
        { text: "test.js", isMatch: true },
        { text: " file", isMatch: false },
      ]);
    });

    it("does not match regex dot as wildcard", () => {
      const result = splitTextByQuery("testXjs", "test.js");
      // Should NOT match because . in query is literal, not regex wildcard
      expect(result).toEqual([{ text: "testXjs", isMatch: false }]);
    });
  });
});
