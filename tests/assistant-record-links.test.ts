// A record's address a reply wrote as text shows as that record's link; the rest of the reply is left as it was.
import { describe, expect, it } from "vitest";
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { recordLinks } from "@/components/assistant/record-links";

const names: Record<string, string> = { search: "Saved search", collection: "Collection", extraction: "Extraction" };
/** The links in `markdown` once the plugin has run: each one's address and words. */
function links(markdown: string) {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Root;
  recordLinks((kind) => names[kind] ?? kind)()(tree);
  const found: Array<[string, string]> = [];
  const walk = (node: { type: string; url?: string; children?: unknown[]; value?: string }) => {
    if (node.type === "link") found.push([node.url!, (node.children as Array<{ value?: string }>).map((child) => child.value ?? "").join("")]);
    for (const child of (node.children ?? []) as never[]) walk(child);
  };
  walk(tree as never);
  return found;
}

describe("record addresses written as text", () => {
  it("become links named by their kind, whole, with the sentence's full stop left outside", () => {
    expect(links("You can open it at /results/bc99f91e-a82e.")).toEqual([["/results/bc99f91e-a82e", "Saved search"]]);
    expect(links("Filtered: /library?col=c1&sort=title&q=trials, then /extraction/j12")).toEqual([["/library?col=c1&sort=title&q=trials", "Collection"], ["/extraction/j12", "Extraction"]]);
    expect(links("Page three (/results/abc?page=3)")).toEqual([["/results/abc?page=3", "Saved search"]]);
  });

  it("leave links, autolinks, code and pages that aren't records as they are", () => {
    expect(links("[Tutoring](/results/abc) and [Open /results/abc](/results/abc)")).toEqual([["/results/abc", "Tutoring"], ["/results/abc", "Open /results/abc"]]);
    expect(links("See https://example.org/#/results/abc")).toEqual([["https://example.org/#/results/abc", "https://example.org/#/results/abc"]]);
    expect(links("`/results/a` and ``/results/b`` and\n\n~~~\n/results/c\n~~~\n\n    /results/d")).toEqual([]);
    expect(links("Start one at /extraction/new or /library?q=x")).toEqual([]);
  });
});
