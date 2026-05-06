import { describe, expect, it } from "vitest";
import {
  normalizeChatMarkdownForClipboard,
  normalizeChatMarkdownForRender,
} from "./markdown-render";

describe("normalizeChatMarkdownForRender", () => {
  it("decodes escaped subscript and superscript tags only", () => {
    expect(
      normalizeChatMarkdownForRender(
        "UCON&lt;sub&gt;ABC&lt;/sub&gt; and H&lt;sup&gt;+&lt;/sup&gt;",
      ),
    ).toBe("UCON<sub>ABC</sub> and H<sup>+</sup>");
  });

  it("drops attributes from escaped safe tags before Streamdown sanitization", () => {
    expect(
      normalizeChatMarkdownForRender(
        "UCON&lt;sub onclick=&quot;alert(1)&quot;&gt;ABC&lt;/sub&gt;",
      ),
    ).toBe("UCON<sub>ABC</sub>");
  });

  it("normalizes Gemini-style backslash-escaped safe tags", () => {
    expect(normalizeChatMarkdownForRender("UCON<sub\\>ABC</sub\\>")).toBe(
      "UCON<sub>ABC</sub>",
    );
  });

  it("removes terminal unmatched emphasis markers", () => {
    expect(normalizeChatMarkdownForRender("Just say the word!***")).toBe(
      "Just say the word!",
    );
    expect(
      normalizeChatMarkdownForRender("Already *italic* text then junk***"),
    ).toBe("Already *italic* text then junk");
    expect(
      normalizeChatMarkdownForRender("Already **bold** text then junk**"),
    ).toBe("Already **bold** text then junk");
  });

  it("preserves valid terminal emphasis markers", () => {
    expect(normalizeChatMarkdownForRender("This is **important**")).toBe(
      "This is **important**",
    );
    expect(normalizeChatMarkdownForRender("This is *important*")).toBe(
      "This is *important*",
    );
    expect(normalizeChatMarkdownForRender("This is ***important***")).toBe(
      "This is ***important***",
    );
  });

  it("strips dotted Gemini grounding markers like [1.1.1]", () => {
    expect(normalizeChatMarkdownForRender("Tested in isolation [1.1.3].")).toBe(
      "Tested in isolation.",
    );
  });

  it("strips comma-separated Gemini grounding markers", () => {
    expect(
      normalizeChatMarkdownForRender(
        "Behave as expected [1.1.1, 1.1.3, 1.1.4].",
      ),
    ).toBe("Behave as expected.");
  });

  it("strips multiple grounding markers across the message", () => {
    expect(
      normalizeChatMarkdownForRender(
        "First [1.1.1]. Second [1.1.4]. Third [1.1.5].",
      ),
    ).toBe("First. Second. Third.");
  });

  it("strips two-segment grounding markers like [1.1]", () => {
    expect(normalizeChatMarkdownForRender("Item [1.1].")).toBe("Item.");
  });

  it("preserves [Pn] paper citations", () => {
    expect(normalizeChatMarkdownForRender("See [P19, P36] then [P5].")).toBe(
      "See [P19, P36] then [P5].",
    );
  });

  it("preserves single-digit footnote-style brackets like [1]", () => {
    expect(normalizeChatMarkdownForRender("Step [1] then [2, 3].")).toBe(
      "Step [1] then [2, 3].",
    );
  });

  it("preserves markdown links like [text](url)", () => {
    expect(
      normalizeChatMarkdownForRender("See [docs](https://example.com)."),
    ).toBe("See [docs](https://example.com).");
  });

  it("does not consume newlines when stripping a marker at line start", () => {
    expect(
      normalizeChatMarkdownForRender("First paragraph.\n\n[1.1.1] Second."),
    ).toBe("First paragraph.\n\n Second.");
  });

  it("coexists with [Pn] citations in the same sentence", () => {
    expect(
      normalizeChatMarkdownForRender(
        "Some approaches [P19, P36] use [1.1.1, 1.1.3] tests.",
      ),
    ).toBe("Some approaches [P19, P36] use tests.");
  });
});

describe("normalizeChatMarkdownForClipboard", () => {
  it("copies Gemini-style subscript output as plain readable text", () => {
    expect(
      normalizeChatMarkdownForClipboard(
        "The UCON<sub\\>ABC</sub\\> usage control model",
      ),
    ).toBe("The UCONABC usage control model");
  });

  it("does not leak standalone markdown thematic breaks into copied text", () => {
    expect(
      normalizeChatMarkdownForClipboard(
        "First section.\n\n***\n\n**Second section.**",
      ),
    ).toBe("First section.\n\n**Second section.**");
  });
});
