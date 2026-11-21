// An action's own name a reply wrote shows as its step's name; anything else that looks like one is left as it was.
import { describe, expect, it } from "vitest";
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { actionNames } from "@/components/assistant/action-names";

/** The reply's text once the plugin has run, with each step's name in [brackets]. */
function shown(markdown: string) {
  const tree = fromMarkdown(markdown) as Root;
  actionNames((path) => `[${path}]`)()(tree);
  return toString(tree);
}

describe("action names in a reply", () => {
  // A reply on the Cheap preset said "The extraction action is `extraction/start:extract`".
  it("show as the step's name, in code or not, by path or by tool name", () => {
    expect(shown("The extraction action is `extraction/start:extract`.")).toBe("The extraction action is [extraction/start:extract].");
    expect(shown("I used research_papers_search and extraction/queries:summarizeJobResults.")).toBe("I used [research/papers:search] and [extraction/queries:summarizeJobResults].");
  });

  it("leave addresses, unknown names and code blocks as they are", () => {
    expect(shown("See https://example.org/a/extraction/start:extract and `no/such:action` or snake_case_words")).toBe("See https://example.org/a/extraction/start:extract and no/such:action or snake_case_words");
    expect(shown("```\nextraction/start:extract\n```")).toBe("extraction/start:extract");
  });
});
