/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <PaperCitation> — the inline chat citation chip.
 *
 * Contracts we care about (all surfaced via accessible DOM, not CSS
 * classes — see CLAUDE.md testing philosophy):
 *  - resolved citations render as a real <a href=…> link so browsers,
 *    screen readers, and keyboard users can navigate
 *  - the link opens in a new tab with rel="noreferrer"
 *  - DOI takes priority over OpenAlex for the href (publisher page >
 *    aggregator page when a DOI is available)
 *  - OpenAlex is the fallback when no DOI is present
 *  - unresolved citations (index out of range) render as non-interactive
 *    text with data-paper-resolved="false"
 *  - when no identifier is available at all, render a non-link Badge
 *    (still shows the hover preview but nothing to navigate to)
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PaperCitationTarget } from "@/components/extraction/chat/paper-citation";
import { PaperCitation } from "@/components/extraction/chat/paper-citation";

vi.mock("next-intl", () => ({
  useTranslations: () =>
    (key: string, params?: Record<string, string | number>) => {
      if (params?.title) return `${key}:${params.title}`;
      return key;
    },
}));

const mkPaper = (over: Partial<PaperCitationTarget> = {}): PaperCitationTarget => ({
  _id: "s_1",
  title: "A study of citation behavior",
  authors: ["Doe, J.", "Smith, A."],
  year: 2024,
  openalexId: "W1234567890",
  ...over,
});

describe("<PaperCitation>", () => {
  it("renders a resolved citation as an <a> link", () => {
    render(<PaperCitation index={3} paper={mkPaper()} />);
    const link = screen.getByRole("link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveTextContent("[P3]");
  });

  it("links to OpenAlex when only openalexId is present", () => {
    render(<PaperCitation index={1} paper={mkPaper({ doi: undefined })} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "https://openalex.org/W1234567890",
    );
  });

  it("prefers DOI over OpenAlex when both are present", () => {
    render(
      <PaperCitation
        index={2}
        paper={mkPaper({ doi: "10.1234/abc.2024" })}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://doi.org/10.1234/abc.2024");
  });

  it("opens the link in a new tab with rel=noreferrer", () => {
    render(<PaperCitation index={1} paper={mkPaper()} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel") ?? "").toMatch(/noreferrer/);
  });

  it("exposes an aria-label describing the destination paper", () => {
    render(<PaperCitation index={1} paper={mkPaper({ title: "My Paper" })} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-label")).toContain("My Paper");
  });

  it("marks the chip with data attributes for downstream tooling", () => {
    render(
      <PaperCitation index={5} paper={mkPaper({ _id: "s_abc" })} />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("data-paper-resolved")).toBe("true");
    expect(link.getAttribute("data-paper-index")).toBe("5");
    expect(link.getAttribute("data-paper-id")).toBe("s_abc");
  });

  it("renders unresolved (paper=null) as non-link muted text", () => {
    render(<PaperCitation index={99} paper={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("[P99?]")).toBeInTheDocument();
    expect(
      screen.getByText("[P99?]").getAttribute("data-paper-resolved"),
    ).toBe("false");
  });

  it("renders non-link Badge when paper has no identifier", () => {
    render(
      <PaperCitation
        index={7}
        paper={mkPaper({ openalexId: undefined, doi: undefined })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("[P7]")).toBeInTheDocument();
  });
});
