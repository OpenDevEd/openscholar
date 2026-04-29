/**
 * @vitest-environment jsdom
 *
 * U2 — <WebSourceChips /> filters source-url parts and renders a footer row.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WebSourceChips } from "@/components/ai-elements/web-source-chips";
import type { UIMessagePart } from "ai";

type AnyPart = UIMessagePart<Record<string, never>, Record<string, never>>;

const textPart: AnyPart = { type: "text", text: "hello" };
const stepStart: AnyPart = { type: "step-start" };

const urlPart = (url: string, sourceId: string, title?: string): AnyPart => ({
  type: "source-url",
  sourceId,
  url,
  title,
});

describe("<WebSourceChips>", () => {
  it("renders nothing when there are no source-url parts", () => {
    const { container } = render(
      <WebSourceChips parts={[textPart, stepStart]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one chip per source-url and exposes the count", () => {
    const parts: AnyPart[] = [
      textPart,
      urlPart("https://arxiv.org/abs/x", "s1", "Preprint"),
      stepStart,
      urlPart("https://example.com", "s2"),
    ];
    const { container } = render(<WebSourceChips parts={parts} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute("data-web-sources-count")).toBe("2");

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("data-source-host")).toBe("arxiv.org");
    expect(links[0]).toHaveTextContent("[1]");
    expect(links[1].getAttribute("data-source-host")).toBe("example.com");
    expect(links[1]).toHaveTextContent("[2]");
  });

  it("ignores non-source-url parts entirely", () => {
    render(<WebSourceChips parts={[textPart, stepStart]} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
