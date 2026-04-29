/**
 * @vitest-environment jsdom
 *
 * U1 — <WebSourceChip /> renders a single web source-url part.
 *
 * Contract:
 *   - <a> opens in a new tab with rel="noreferrer noopener"
 *   - data-source-type="web"
 *   - data-source-host derived from the URL
 *   - falls back to host text when title is missing
 *   - renders a favicon <img> via the Google s2 endpoint
 *   - exposes the 1-based index suffix
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WebSourceChip } from "@/components/ai-elements/web-source-chip";

describe("<WebSourceChip>", () => {
  it("renders an external anchor with the security attributes and data hooks", () => {
    render(
      <WebSourceChip
        url="https://arxiv.org/abs/2401.00001"
        title="Some preprint"
        idx={0}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://arxiv.org/abs/2401.00001");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    expect(link).toHaveAttribute("data-source-type", "web");
    expect(link).toHaveAttribute("data-source-host", "arxiv.org");
  });

  it("uses the title when present", () => {
    render(
      <WebSourceChip
        url="https://example.com/article"
        title="Hello World"
        idx={0}
      />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("Hello World");
  });

  it("falls back to the host when the title is missing", () => {
    render(<WebSourceChip url="https://example.com/article" idx={0} />);
    expect(screen.getByRole("link")).toHaveTextContent("example.com");
  });

  it("falls back to the host when the title is whitespace only", () => {
    render(
      <WebSourceChip url="https://example.com/article" title="   " idx={0} />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("example.com");
  });

  it("exposes a [n] index suffix derived from idx (1-based)", () => {
    render(
      <WebSourceChip url="https://example.com" title="t" idx={2} />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("[3]");
  });

  it("renders a favicon <img> using the Google s2 endpoint", () => {
    const { container } = render(
      <WebSourceChip url="https://arxiv.org/abs/x" title="t" idx={0} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(
      "https://www.google.com/s2/favicons?domain=arxiv.org&sz=32",
    );
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });
});
