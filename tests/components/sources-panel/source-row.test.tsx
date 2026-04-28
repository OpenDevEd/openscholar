/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <SourceRow>.
 *
 * Asserts on the user-observable contract:
 * - the row exposes a stable id, role=option, and aria-selected reflecting
 *   the included flag (so the panel-level aria-activedescendant can point
 *   at it)
 * - data-paper-included / data-paper-source / data-chat-paper-id are
 *   present so the higher-level behavior tests can scope queries by
 *   semantic state
 * - title + first-author/year/source-chip meta render as readable text
 * - when the SearchMatch field is one not already shown in the row chrome
 *   (abstract / doi / openalexId), a snippet line surfaces with a
 *   data-match-field attribute and a <mark> element wrapping the matching
 *   substring — title/author/year matches do NOT add the snippet
 * - hover/focus reveals OpenAlex / DOI link buttons whose href reflects
 *   the row's identifiers
 *
 * No CSS-class assertions per project testing doctrine.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceRow } from "@/components/extraction/chat/sources-panel/source-row";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const cp = (n: number) => `cp${n}` as unknown as Id<"chatPapers">;
const src = (n: number) => `src${n}` as unknown as Id<"extractionJobSources">;
const job = "job1" as unknown as Id<"extractionJobs">;

function row(overrides: Partial<ChatSourceRow> = {}): ChatSourceRow {
  return {
    chatPaperId: cp(1),
    sourceId: src(1),
    jobId: job,
    position: 1,
    included: true,
    title: "Photosynthesis in marine algae",
    authors: ["Smith, J", "Doe, A"],
    year: 2024,
    abstract:
      "We examine the use of photosynthesis in marine systems with a coral reef focus.",
    doi: "10.1234/abc.2024",
    pdfUrl: null,
    openalexId: "W1234567890",
    citedByCount: null,
    venueName: null,
    workType: null,
    bucketKey: "openalex:W1234567890",
    sourceType: "openalex",
    ...overrides,
  };
}

function renderRow(
  props: Partial<Parameters<typeof SourceRow>[0]> & {
    row: ChatSourceRow;
  },
) {
  return render(
    <SourceRow
      posInSet={1}
      setSize={1}
      onActivate={() => {}}
      {...props}
    />,
  );
}

describe("<SourceRow>", () => {
  it("exposes id, role=option, aria-selected, and data-* attributes for an included paper", () => {
    renderRow({ row: row() });
    const option = screen.getByRole("option");
    expect(option.getAttribute("id")).toBe(`src-row-${cp(1)}`);
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(option.getAttribute("data-paper-included")).toBe("true");
    expect(option.getAttribute("data-paper-source")).toBe("openalex");
    expect(option.getAttribute("data-chat-paper-id")).toBe(cp(1));
  });

  it("flips data-paper-included and aria-selected when the paper is excluded", () => {
    renderRow({ row: row({ included: false }) });
    const option = screen.getByRole("option");
    expect(option.getAttribute("aria-selected")).toBe("false");
    expect(option.getAttribute("data-paper-included")).toBe("false");
  });

  it("renders title and the first-author/year meta line", () => {
    renderRow({ row: row() });
    expect(screen.getByText("Photosynthesis in marine algae")).toBeInTheDocument();
    expect(screen.getByText(/Smith, J et al\..*2024/)).toBeInTheDocument();
  });

  it("does NOT show a match snippet when the match field is title (already in chrome)", () => {
    renderRow({
      row: row(),
      match: { score: 0.6, field: "title" },
      query: "photosynthesis",
    });
    expect(screen.queryByText(/data-match-field/i)).toBeNull();
    expect(document.querySelector("mark")).toBeNull();
  });

  it("renders an abstract snippet with <mark> highlight when the match field is abstract", () => {
    renderRow({
      row: row(),
      match: { score: 0.4, field: "abstract" },
      query: "photosynthesis",
    });
    const snippet = document.querySelector("[data-match-field='abstract']");
    expect(snippet).not.toBeNull();
    const mark = snippet!.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent?.toLowerCase()).toContain("photosynthesis");
  });

  it("renders OpenAlex and DOI external-link affordances with correct hrefs", () => {
    renderRow({ row: row() });
    const openalexLink = screen.getByRole("link", { name: /OpenAlex/i });
    expect(openalexLink.getAttribute("href")).toBe(
      "https://openalex.org/W1234567890",
    );
    const doiLink = screen.getByRole("link", { name: /DOI/i });
    expect(doiLink.getAttribute("href")).toBe("https://doi.org/10.1234/abc.2024");
  });

  it("omits the OpenAlex link when the row has no openalexId", () => {
    renderRow({ row: row({ openalexId: null }) });
    expect(screen.queryByRole("link", { name: /OpenAlex/i })).toBeNull();
  });

  it("exposes aria-posinset and aria-setsize for screen readers across virtualization", () => {
    renderRow({ row: row(), posInSet: 7, setSize: 100 });
    const option = screen.getByRole("option");
    expect(option.getAttribute("aria-posinset")).toBe("7");
    expect(option.getAttribute("aria-setsize")).toBe("100");
  });

  it("calls onActivate with the shift-key state when the row is clicked", () => {
    const onActivate = vi.fn();
    renderRow({ row: row(), onActivate });
    const option = screen.getByRole("option");
    option.dispatchEvent(
      new MouseEvent("click", { bubbles: true, shiftKey: true }),
    );
    expect(onActivate).toHaveBeenCalledWith(true);
  });
});
