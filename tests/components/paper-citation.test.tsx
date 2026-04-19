/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <PaperCitation> — the inline chat citation chip.
 *
 * Contracts we care about (all surfaced via accessible DOM, not CSS
 * classes — see CLAUDE.md testing philosophy):
 *  - resolved citations render as a real <a href=…> link so browsers,
 *    screen readers, and keyboard users can navigate
 *  - the pill always points at OpenAlex when an openalexId is present
 *    (the guaranteed baseline destination); DOI and PDF are additive
 *    buttons inside the hover card, not the pill's primary href
 *  - opens in a new tab with rel="noreferrer"
 *  - hover card exposes up to three buttons (PDF / DOI / OpenAlex)
 *    marked with data-paper-card-link so tests/e2e can target them
 *  - unresolved citations (index out of range) render as non-interactive
 *    text with data-paper-resolved="false"
 *  - when no identifier is available at all, render a non-link Badge
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PaperCitationTarget } from "@/components/extraction/chat/paper-citation";
import { PaperCitation } from "@/components/extraction/chat/paper-citation";

// Radix HoverCard uses pointer-capture APIs that JSDOM doesn't ship.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
});

async function openHoverCard() {
  const user = userEvent.setup();
  const pill = screen.getByRole("link", { name: /chatCitationOpen/ });
  await user.hover(pill);
  await waitFor(() => {
    // Any of the card's action buttons shows up once it's open.
    const anyBtn = document.querySelector("a[data-paper-card-link]");
    expect(anyBtn).not.toBeNull();
  });
}

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

function getPill(): HTMLAnchorElement {
  return screen.getByRole("link", { name: /chatCitationOpen/ }) as HTMLAnchorElement;
}

describe("<PaperCitation>", () => {
  it("renders a resolved citation as an <a> link", () => {
    render(<PaperCitation index={3} paper={mkPaper()} />);
    const pill = getPill();
    expect(pill.tagName).toBe("A");
    expect(pill).toHaveTextContent("[P3]");
  });

  it("pill always points at OpenAlex when openalexId is present", () => {
    render(
      <PaperCitation
        index={2}
        paper={mkPaper({ doi: "10.1234/abc.2024" })}
      />,
    );
    // With both DOI and OpenAlex present, pill links to OpenAlex —
    // it's the guaranteed-available aggregator, whereas DOI/PDF are
    // surfaced as extra buttons inside the hover card.
    expect(getPill().getAttribute("href")).toBe(
      "https://openalex.org/W1234567890",
    );
  });

  it("falls back to DOI on the pill when no openalexId is present", () => {
    render(
      <PaperCitation
        index={1}
        paper={mkPaper({ openalexId: undefined, doi: "10.1234/abc.2024" })}
      />,
    );
    expect(getPill().getAttribute("href")).toBe(
      "https://doi.org/10.1234/abc.2024",
    );
  });

  it("opens the pill in a new tab with rel=noreferrer", () => {
    render(<PaperCitation index={1} paper={mkPaper()} />);
    const pill = getPill();
    expect(pill.getAttribute("target")).toBe("_blank");
    expect(pill.getAttribute("rel") ?? "").toMatch(/noreferrer/);
  });

  it("exposes an aria-label describing the destination paper on the pill", () => {
    render(<PaperCitation index={1} paper={mkPaper({ title: "My Paper" })} />);
    expect(getPill().getAttribute("aria-label")).toContain("My Paper");
  });

  it("marks the pill with data attributes for downstream tooling", () => {
    render(
      <PaperCitation index={5} paper={mkPaper({ _id: "s_abc" })} />,
    );
    const pill = getPill();
    expect(pill.getAttribute("data-paper-resolved")).toBe("true");
    expect(pill.getAttribute("data-paper-index")).toBe("5");
    expect(pill.getAttribute("data-paper-id")).toBe("s_abc");
  });

  it("renders an OpenAlex action button in the hover card when openalexId is present", async () => {
    render(<PaperCitation index={1} paper={mkPaper()} />);
    await openHoverCard();
    const openalexBtn = document.querySelector(
      'a[data-paper-card-link="openalex"]',
    ) as HTMLAnchorElement | null;
    expect(openalexBtn).not.toBeNull();
    expect(openalexBtn!.getAttribute("href")).toBe(
      "https://openalex.org/W1234567890",
    );
  });

  it("renders a DOI action button in the hover card when doi is present", async () => {
    render(
      <PaperCitation
        index={1}
        paper={mkPaper({ doi: "10.1234/abc.2024" })}
      />,
    );
    await openHoverCard();
    const doiBtn = document.querySelector(
      'a[data-paper-card-link="doi"]',
    ) as HTMLAnchorElement | null;
    expect(doiBtn).not.toBeNull();
    expect(doiBtn!.getAttribute("href")).toBe(
      "https://doi.org/10.1234/abc.2024",
    );
    expect(doiBtn!).toHaveTextContent("10.1234/abc.2024");
  });

  it("renders a PDF action button in the hover card when pdfUrl is present", async () => {
    render(
      <PaperCitation
        index={1}
        paper={mkPaper({ pdfUrl: "https://example.com/paper.pdf" })}
      />,
    );
    await openHoverCard();
    const pdfBtn = document.querySelector(
      'a[data-paper-card-link="pdf"]',
    ) as HTMLAnchorElement | null;
    expect(pdfBtn).not.toBeNull();
    expect(pdfBtn!.getAttribute("href")).toBe("https://example.com/paper.pdf");
  });

  it("hides action buttons for missing identifiers", async () => {
    render(
      <PaperCitation
        index={1}
        paper={mkPaper({ openalexId: "W1", doi: undefined, pdfUrl: undefined })}
      />,
    );
    await openHoverCard();
    expect(
      document.querySelector('a[data-paper-card-link="openalex"]'),
    ).not.toBeNull();
    expect(document.querySelector('a[data-paper-card-link="doi"]')).toBeNull();
    expect(document.querySelector('a[data-paper-card-link="pdf"]')).toBeNull();
  });

  it("normalises a DOI that is already a full URL", async () => {
    render(
      <PaperCitation
        index={1}
        paper={mkPaper({ doi: "https://doi.org/10.9/XYZ" })}
      />,
    );
    await openHoverCard();
    const doiBtn = document.querySelector(
      'a[data-paper-card-link="doi"]',
    ) as HTMLAnchorElement | null;
    expect(doiBtn!.getAttribute("href")).toBe("https://doi.org/10.9/XYZ");
    // Short DOI in the button text strips the protocol prefix.
    expect(doiBtn!).toHaveTextContent("10.9/XYZ");
  });

  it("renders unresolved (paper=null) as non-link muted text", () => {
    render(<PaperCitation index={99} paper={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("[P99?]")).toBeInTheDocument();
    expect(
      screen.getByText("[P99?]").getAttribute("data-paper-resolved"),
    ).toBe("false");
  });

  it("renders non-link Badge when paper has no identifier at all", () => {
    render(
      <PaperCitation
        index={7}
        paper={mkPaper({
          openalexId: undefined,
          doi: undefined,
          pdfUrl: undefined,
        })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("[P7]")).toBeInTheDocument();
  });
});
