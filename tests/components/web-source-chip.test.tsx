/**
 * @vitest-environment jsdom
 *
 * U1 — <WebSourceChip /> renders a single web source-url part.
 *
 * Contract:
 *   - <a> opens in a new tab with rel="noreferrer noopener"
 *   - data-source-type="web"
 *   - data-source-host derived from the URL
 *   - data-icon-state="favicon" while the image loads, "fallback" once it errors
 *   - falls back to host text when title is missing
 *   - renders a favicon <img> via the DuckDuckGo ip3 endpoint
 *   - on image error, replaces the <img> with a letter-avatar fallback
 *   - exposes the 1-based index suffix
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithTooltip as render } from "../helpers/render-with-tooltip";
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

  it("renders a favicon <img> using the DuckDuckGo ip3 endpoint", () => {
    const { container } = render(
      <WebSourceChip url="https://arxiv.org/abs/x" title="t" idx={0} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(
      "https://icons.duckduckgo.com/ip3/arxiv.org.ico",
    );
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("starts in the favicon icon state", () => {
    render(<WebSourceChip url="https://arxiv.org/abs/x" idx={0} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "data-icon-state",
      "favicon",
    );
  });

  it("swaps to a letter-avatar fallback when the favicon image errors", () => {
    const { container } = render(
      <WebSourceChip url="https://arxiv.org/abs/x" idx={0} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    expect(screen.getByRole("link")).toHaveAttribute(
      "data-icon-state",
      "fallback",
    );
    const fallback = container.querySelector("[data-icon-fallback='letter']");
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toBe("A");
    expect(container.querySelector("img")).toBeNull();
  });

  it("strips a leading www. before deriving the fallback letter", () => {
    const { container } = render(
      <WebSourceChip url="https://www.example.com/foo" idx={0} />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(
      container.querySelector("[data-icon-fallback='letter']")?.textContent,
    ).toBe("E");
  });
});
