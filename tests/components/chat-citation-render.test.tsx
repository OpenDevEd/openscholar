/**
 * @vitest-environment jsdom
 *
 * End-to-end render test for the chat citation pipeline:
 *   Assistant markdown text  →  MessageResponse (Streamdown)
 *     →  custom `p` renderer (CitationAwareParagraph)
 *       →  PaperCitation components
 *
 * Reproduces exactly what MessageRow does in message-list.tsx, but
 * deterministically in jsdom. This covers the case where Streamdown
 * might tokenise `[P1]` or `[P1, P2]` in a way our regex can't see,
 * which unit tests on the parser alone would miss.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  buildStreamdownComponents,
  type ResolvedPaper,
} from "@/components/extraction/chat/message-list";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params?.title ? `${key}:${params.title}` : key,
}));

function renderAssistantMarkdown(text: string, papers: ResolvedPaper[]) {
  const components = buildStreamdownComponents(papers);
  return render(
    <MessageResponse components={components}>{text}</MessageResponse>,
  );
}

const mkPaper = (over: Partial<ResolvedPaper>): ResolvedPaper => ({
  _id: "s_1",
  title: "Placeholder",
  authors: ["Doe"],
  year: 2024,
  openalexId: "W1",
  ...over,
});

const P1 = mkPaper({ _id: "s_1", openalexId: "W1", title: "Paper One" });
const P2 = mkPaper({ _id: "s_2", openalexId: "W2", title: "Paper Two" });
const P3 = mkPaper({ _id: "s_3", openalexId: "W3", title: "Paper Three" });

describe("chat citation rendering end-to-end (Streamdown + CitationAwareParagraph)", () => {
  it("renders a singleton [P1] as a clickable OpenAlex link", () => {
    renderAssistantMarkdown(
      "This claim is well established [P1].",
      [P1, P2, P3],
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://openalex.org/W1");
    expect(link).toHaveTextContent("1");
  });

  it("renders the combined-bracket form [P1, P2, P3] as three clickable links", () => {
    renderAssistantMarkdown(
      "Multiple sources agree [P1, P2, P3] on this point.",
      [P1, P2, P3],
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "https://openalex.org/W1",
      "https://openalex.org/W2",
      "https://openalex.org/W3",
    ]);
  });

  it("renders mixed singleton and combined citations in one paragraph", () => {
    renderAssistantMarkdown(
      "Early work [P1] established this, but [P2, P3] pushed further.",
      [P1, P2, P3],
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.textContent)).toEqual(["1", "2", "3"]);
  });

  it("leaves surrounding prose intact around a citation", () => {
    const { container } = renderAssistantMarkdown(
      "before [P1] after",
      [P1],
    );
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("does not crash on an empty assistant message", () => {
    renderAssistantMarkdown("", [P1]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("falls back to unresolved muted text for out-of-range [P99]", () => {
    renderAssistantMarkdown("Weird [P99] here.", [P1]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("99?")).toBeInTheDocument();
  });

  it("resolves a citation inside a markdown bullet list item", () => {
    renderAssistantMarkdown(
      "- first bullet [P1]\n- second bullet [P2]",
      [P1, P2, P3],
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.textContent)).toEqual(["1", "2"]);
  });

  it("resolves a citation inside bold emphasis inside a bullet", () => {
    renderAssistantMarkdown(
      "- **Important finding:** this has been shown [P1, P2].",
      [P1, P2, P3],
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
  });

  it("resolves a citation inside a markdown heading", () => {
    renderAssistantMarkdown("## Heading with a citation [P1]", [P1]);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://openalex.org/W1");
  });

  it("resolves a citation inside a blockquote", () => {
    renderAssistantMarkdown("> this claim [P1] rests on prior work.", [P1]);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://openalex.org/W1");
  });

  it("does not rewrite citations inside fenced code blocks", () => {
    renderAssistantMarkdown(
      "Here's some code:\n```\nregex: /\\[P\\d+\\]/g\nexample: [P1]\n```\n",
      [P1],
    );
    // Inside code blocks, [P1] should stay as literal text.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("handles the real production message shape (markdown heading + combined brackets)", () => {
    // Reproduces the exact paragraph shape from the latest assistant
    // message in the dev DB, including the ### heading and 4-paper
    // combined bracket.
    const bigCorpus = Array.from({ length: 200 }, (_, i) =>
      mkPaper({
        _id: `s_${i + 1}`,
        openalexId: `W${i + 1}`,
        title: `Paper ${i + 1}`,
      }),
    );
    renderAssistantMarkdown(
      "### 1. Calendrical Systems and Civil Organization\n" +
        "*   **Calendar Mechanics:** Several papers analyze the technical challenges of reconciling the solar and lunar years, particularly through intercalation, and the transition from one system to another [P97, P102, P167, P197].",
      bigCorpus,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "https://openalex.org/W97",
      "https://openalex.org/W102",
      "https://openalex.org/W167",
      "https://openalex.org/W197",
    ]);
  });
});
