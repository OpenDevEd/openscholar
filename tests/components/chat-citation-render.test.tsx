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
 *
 * Also covers the position-based resolver contract: a chat where a
 * middle source is excluded still renders `[P2]` and `[P4]` correctly
 * — the resolver looks up by `position`, not by array index, so no
 * off-by-one shift occurs.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithTooltip as render } from "../helpers/render-with-tooltip";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  CHAT_MARKDOWN_ALLOWED_TAGS,
  buildStreamdownComponents,
  type ResolvedPaper,
} from "@/components/extraction/chat/message-list";
import { normalizeChatMarkdownForRender } from "@/lib/chat/markdown-render";
import { PapersContext } from "@/components/extraction/chat/papers-context";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";
import type { Id } from "@/convex/_generated/dataModel";
import { fakePapersContext } from "@/tests/helpers/papers-context-fixture";

vi.mock("convex/react", () => ({
  useMutation: () => {
    const fn = vi.fn(async () => undefined);
    Object.assign(fn, { withOptimisticUpdate: () => fn });
    return fn;
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      chatPapers: {
        toggleChatPaper: "stub:toggleChatPaper",
        listChatSourcesWithInclusion: "stub:listChatSourcesWithInclusion",
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, { error: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params?.title ? `${key}:${params.title}` : key,
}));

const JOB_ID = "job_test" as Id<"extractionJobs">;

function renderAssistantMarkdown(text: string, papers: ResolvedPaper[]) {
  const components = buildStreamdownComponents();
  const papersByPosition = new Map<number, ResolvablePaper>();
  for (const p of papers) papersByPosition.set(p.position, p);
  return render(
    <PapersContext.Provider
      value={fakePapersContext({ jobId: JOB_ID, papersByPosition })}
    >
      <MessageResponse
        allowedTags={CHAT_MARKDOWN_ALLOWED_TAGS}
        components={components}
        mode="static"
        parseIncompleteMarkdown={false}
      >
        {normalizeChatMarkdownForRender(text)}
      </MessageResponse>
    </PapersContext.Provider>,
  );
}

const mkPaper = (over: Partial<ResolvedPaper> & { position: number }): ResolvedPaper => ({
  sourceId: `src_${over.position}` as Id<"extractionJobSources">,
  chatPaperId: `cp_${over.position}` as Id<"chatPapers">,
  title: "Placeholder",
  authors: ["Doe"],
  year: 2024,
  abstract: null,
  openalexId: `W${over.position}`,
  doi: null,
  pdfUrl: null,
  included: true,
  ...over,
});

const P1 = mkPaper({ position: 1, title: "Paper One" });
const P2 = mkPaper({ position: 2, title: "Paper Two" });
const P3 = mkPaper({ position: 3, title: "Paper Three" });

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

  it("links a citation of an OpenScholar API paper to its DOI, since OpenAlex has no page for it", () => {
    renderAssistantMarkdown(
      "This claim is well established [P1].",
      [mkPaper({ position: 1, openalexId: "OS150911088", doi: "10.1234/abc" })],
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://doi.org/10.1234/abc");
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

  it("uses chat markdown list components so numbered lists are not flattened by Tailwind preflight", () => {
    renderAssistantMarkdown(
      "1. **Information Security:** UCON<sub>ABC</sub> usage control [P1]\n2. **Clinical Education:** K-ABC assessment [P2]",
      [P1, P2, P3],
    );

    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("data-chat-markdown", "ordered-list");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-chat-markdown", "list-item");
    expect(items[0]).toHaveTextContent("Information Security");
    expect(items[0].querySelector("strong")).not.toBeNull();
    expect(items[0].querySelector("sub")).toHaveTextContent("ABC");
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "1",
      "2",
    ]);
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
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("handles the real production message shape (markdown heading + combined brackets)", () => {
    const bigCorpus = Array.from({ length: 200 }, (_, i) =>
      mkPaper({ position: i + 1, title: `Paper ${i + 1}` }),
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

  it("renders safe scholarly inline HTML such as subscript without allowing attributes", () => {
    const { container } = renderAssistantMarkdown(
      "The UCON<sub onclick=\"alert(1)\">ABC</sub> model and H<sup>+</sup> transport are cited [P1].",
      [P1],
    );

    const subscript = container.querySelector("sub");
    const superscript = container.querySelector("sup");
    expect(subscript).not.toBeNull();
    expect(subscript).toHaveTextContent("ABC");
    expect(subscript).not.toHaveAttribute("onclick");
    expect(superscript).not.toBeNull();
    expect(superscript).toHaveTextContent("+");
    expect(screen.getByRole("link")).toHaveTextContent("1");
  });

  it("normalizes escaped safe scholarly tags before rendering markdown", () => {
    const { container } = renderAssistantMarkdown(
      "The UCON&lt;sub&gt;ABC&lt;/sub&gt; model is cited [P1].",
      [P1],
    );

    expect(container.textContent).not.toContain("<sub");
    const subscript = container.querySelector("sub");
    expect(subscript).not.toBeNull();
    expect(subscript).toHaveTextContent("ABC");
    expect(screen.getByRole("link")).toHaveTextContent("1");
  });

  it("normalizes the exact backslash-escaped subscript tags persisted by Gemini", () => {
    const { container } = renderAssistantMarkdown(
      "The UCON<sub\\>ABC</sub\\> usage control model is cited [P1].",
      [P1],
    );

    expect(container.textContent).not.toContain("<sub");
    expect(container.textContent).not.toContain("</sub");
    const subscript = container.querySelector("sub");
    expect(subscript).not.toBeNull();
    expect(subscript).toHaveTextContent("ABC");
    expect(screen.getByRole("link")).toHaveTextContent("1");
  });

  it("renders standalone thematic breaks instead of leaking literal asterisks", () => {
    const { container } = renderAssistantMarkdown(
      "First section.\n\n***\n\n**Second section.**",
      [P1],
    );

    expect(container.textContent).not.toContain("***");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("hr")).toHaveAttribute(
      "data-chat-markdown",
      "thematic-break",
    );
  });

  it("renders the exact persisted Gemini snippet without raw tags or literal thematic-break text", () => {
    const { container } = renderAssistantMarkdown(
      "**Title:** *The UCON<sub\\>ABC</sub\\> usage control model* [P37]\n\n" +
        "Authorizations refer to traditional rights based on attributes.\n\n" +
        "***\n\n" +
        "**We are really covering ground now.**",
      [mkPaper({ position: 37, title: "The UCONABC usage control model" })],
    );

    expect(container.textContent).not.toContain("<sub");
    expect(container.textContent).not.toContain("</sub");
    expect(container.textContent).not.toContain("***");
    expect(container.textContent).not.toContain("*");
    expect(container.querySelector("sub")).toHaveTextContent("ABC");
    expect(container.querySelector("hr")).toHaveAttribute(
      "data-chat-markdown",
      "thematic-break",
    );
    expect(screen.getByRole("link")).toHaveTextContent("37");
  });

  it("removes dangling terminal emphasis markers from model output", () => {
    const { container } = renderAssistantMarkdown(
      "Where to next? Just say the word!***",
      [P1],
    );

    expect(container.textContent).toContain("Where to next?");
    expect(container.textContent).toContain("Just say the word!");
    expect(container.textContent).not.toContain("***");
  });

  describe("position-based resolution (tri-state integration)", () => {
    it("renders [P2] excluded + [P4] included in the same paragraph without off-by-one shift", () => {
      // Five-source chat where position 2 is excluded (the bridge-table
      // flag is set to `included: false`). The paper stays in the live
      // list — position-based resolver still finds it — but the pill
      // renders as excluded.
      const rows = [
        mkPaper({ position: 1, title: "P1" }),
        mkPaper({ position: 2, title: "P2 excluded", included: false }),
        mkPaper({ position: 3, title: "P3" }),
        mkPaper({ position: 4, title: "P4 included", included: true }),
        mkPaper({ position: 5, title: "P5" }),
      ];
      renderAssistantMarkdown(
        "See [P2, P4] for details.",
        rows,
      );
      const pills = screen.getAllByRole("link");
      expect(pills).toHaveLength(2);
      // Pills are rendered in citation order, so position 2 first.
      expect(pills[0].getAttribute("data-citation-state")).toBe("excluded");
      expect(pills[0].textContent).toBe("2");
      expect(pills[1].getAttribute("data-citation-state")).toBe("included");
      expect(pills[1].textContent).toBe("4");
    });

    it("renders [P3] as unresolved when position 3 is absent from the live list", () => {
      // A chat where position 3 has been *removed* from the live list
      // (not just excluded). This differs from the included=false case:
      // the paper row is gone entirely from the query results, so the
      // resolver returns null → unresolved pill.
      const rows = [
        mkPaper({ position: 1, title: "P1" }),
        mkPaper({ position: 2, title: "P2" }),
        // no position 3
        mkPaper({ position: 4, title: "P4" }),
      ];
      renderAssistantMarkdown("Past claim [P3] cited here.", rows);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("3?")).toBeInTheDocument();
    });
  });
});
