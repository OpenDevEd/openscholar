// An action's own name a reply wrote shows as its step's name; anything else that looks like one is left as it was.
import { describe, expect, it } from "vitest";
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { actionNames, withStepNames } from "@/components/assistant/action-names";

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
    expect(shown("It ran `extraction/start:extract({})`.")).toBe("It ran [extraction/start:extract]({}).");
  });

  it("leave addresses, unknown names and code blocks as they are", () => {
    expect(shown("See https://example.org/a/extraction/start:extract and `no/such:action` or snake_case_words")).toBe("See https://example.org/a/extraction/start:extract and no/such:action or snake_case_words");
    expect(shown("```\nextraction/start:extract\n```")).toBe("extraction/start:extract");
    expect(shown("extraction/start:extract2 and `research_papers_search_all`")).toBe("extraction/start:extract2 and research_papers_search_all");
  });

  // A reply on the Cheap preset listed "Bulk changes (change_papers)": the assistant's own tools aren't actions.
  it("show the assistant's own tools by their names too", () => {
    expect(shown("Bulk changes (change_papers), or `run_many`.")).toBe("Bulk changes ([change_papers]), or [run_many].");
    expect(withStepNames("I used find_action and run_action.", (path) => `[${path}]`)).toBe("I used [find_action] and [run_action].");
    expect(shown("`https://example.org/change_papers` and `prefix.run_many()`")).toBe("https://example.org/change_papers and prefix.run_many()");
  });

  // A chat's preview in the list said "The action is library/queries:papers." while its reply showed the step's name.
  it("show as the step's name in a chat's plain-text preview too", () => {
    const label = (path: string) => `[${path}]`;
    expect(withStepNames("The action is library/queries:papers. I ran it.", label)).toBe("The action is [library/queries:papers]. I ran it.");
    expect(withStepNames("See https://example.org/library/queries:papers or no/such:action", label)).toBe("See https://example.org/library/queries:papers or no/such:action");
  });
});
