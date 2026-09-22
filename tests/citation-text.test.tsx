// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CitationText } from "@/components/citation-text";
import { formatCitations } from "@/lib/citations/formatter";

afterEach(cleanup);
const record = {
  id: "rich", "citation-key": "rich", type: "article-journal", title: "Evidence & education",
  author: [{ family: "Smith", given: "Jane" }], issued: { "date-parts": [[2026]] },
  "container-title": "Journal of Education", volume: "42", DOI: "10.1234/evidence",
};

it("renders the style's italics and a navigable DOI without adding markup to copied text", async () => {
  const { apa } = await formatCitations(record, "en-GB");
  const { container } = render(createElement(CitationText, { citation: apa }));
  const link = screen.getByRole("link", { name: "https://doi.org/10.1234/evidence" });
  expect(link.getAttribute("href")).toBe("https://doi.org/10.1234/evidence");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(container.querySelector("i")?.textContent).toBe("Journal of Education");
  expect(container.textContent).toBe(apa.text);
});

it("keeps URL query strings intact and punctuation outside the link", async () => {
  const URL = "https://example.org/evidence?country=KE&year=2026";
  const { apa } = await formatCitations({ ...record, DOI: undefined, URL }, "en-GB");
  render(createElement(CitationText, { citation: apa }));
  expect(screen.getByRole("link").getAttribute("href")).toBe(URL);
});

it("renders bibliographic metadata as text and rejects executable markup and link schemes", async () => {
  const { apa } = await formatCitations({ ...record, title: 'Evidence <img src=x onerror="alert(1)">' }, "en-GB");
  const { container, rerender } = render(createElement(CitationText, { citation: apa }));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  rerender(createElement(CitationText, { citation: {
    text: "Unsafe link Safe link",
    html: '<script>alert(1)</script><iframe src="https://example.org"></iframe><a href="javascript:alert(1)">Unsafe link</a> <a href="https://example.org" onclick="alert(1)">Safe link</a><span style="position:fixed;font-variant:small-caps" onmouseover="alert(1)">Journal</span>',
  } }));
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.org/");
  expect(container.querySelector("script,iframe,[onclick],[onmouseover]")).toBeNull();
  expect(container.querySelector("span")?.style.position).toBe("");
  expect(container.querySelector("span")?.style.fontVariant).toBe("small-caps");
});

it("keeps BibTeX as literal copyable source", () => {
  const text = '@article{example, title={A <i>literal</i> title}, url={https://example.org}}';
  const { container } = render(createElement(CitationText, { citation: { text, html: null } }));
  expect(container.textContent).toBe(text);
  expect(container.querySelector("a,i")).toBeNull();
});


it("links a bare DOI in Vancouver without changing the style's visible label", async () => {
  const { vancouver } = await formatCitations(record, "en-GB");
  const { container } = render(createElement(CitationText, { citation: vancouver }));
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://doi.org/10.1234/evidence");
  expect(link.textContent).toBe("10.1234/evidence");
});
