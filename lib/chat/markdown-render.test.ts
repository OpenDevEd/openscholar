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
