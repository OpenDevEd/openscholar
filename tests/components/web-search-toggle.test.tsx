/**
 * @vitest-environment jsdom
 *
 * Behavioural tests for the chat composer's web-search toggle.
 *
 * Locks the contract laid out in plans/chat-web-search-grounding/07-composer-toggle-ui.md
 * and plans/unified-pricing/03-rewire-ui-and-i18n.md:
 *  - aria-pressed mirrors the persisted server state
 *  - the button is disabled when the active model lacks the "tools" capability
 *    or when the chat is generating
 *  - clicking flips the value via setChatWebSearchEnabled
 *  - tooltip text differentiates unsupported / on / off-loading / off-with-real-credits states
 *  - off-state tooltip is interpolated with the resolved credit count from
 *    `getChatWebSearchPricing`
 *  - data-web-search-source / data-web-search-credits-estimate track the
 *    active path resolution
 *
 * Per CLAUDE.md, no Tailwind class assertions appear here. Behaviour is
 * surfaced through aria-pressed, data-* attributes, and tooltip text.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WebSearchToggle } from "@/components/extraction/chat/web-search-toggle";

const setWebSearchMock = vi.fn().mockResolvedValue(undefined);
const pricingMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (fnRef: unknown) => {
    if (fnRef === "setChatWebSearchEnabled") return setWebSearchMock;
    return vi.fn();
  },
  useQuery: (fnRef: unknown) => {
    if (fnRef === "getChatWebSearchPricing") return pricingMock();
    return undefined;
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        setChatWebSearchEnabled: "setChatWebSearchEnabled",
        getChatWebSearchPricing: "getChatWebSearchPricing",
      },
    },
  },
}));

// Inline locale templates — these mirror the en-US strings owned by
// plan 03 U4 below. Keeps the test self-contained (no JSON load) while
// still letting us assert on the *rendered* tooltip rather than on the
// translation key, which is the contract real users observe.
const composerStrings: Record<string, string> = {
  "webSearch.label": "Web",
  "webSearch.ariaEnable": "Enable web search",
  "webSearch.ariaDisable": "Disable web search",
  "webSearch.tooltipUnsupported": "Selected model does not support web search.",
  "webSearch.tooltipOn": "Web search on. Click to disable.",
  "webSearch.tooltipOff":
    "Search the web for current info (~{credits} credits per search).",
  "webSearch.tooltipOffLoading": "Search the web for current info.",
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    const template = composerStrings[key] ?? key;
    if (!vars) return template;
    return Object.entries(vars).reduce(
      (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
      template,
    );
  },
}));

vi.mock("@/components/ui/tooltip", () => {
  const Tooltip = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const TooltipTrigger = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const TooltipContent = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  );
  return { Tooltip, TooltipTrigger, TooltipContent };
});

const baseProps = {
  threadId: "t_1",
  enabled: false,
  modelSupportedParameters: ["tools", "stream"] as string[] | null | undefined,
  isGenerating: false,
};

beforeEach(() => {
  pricingMock.mockReset();
  pricingMock.mockReturnValue({
    source: "tavily-basic",
    usdPerCall: 0.008,
    creditsPerCall: 104,
  });
});

describe("<WebSearchToggle>", () => {
  it("aria-pressed reflects the enabled prop", () => {
    const { rerender } = render(<WebSearchToggle {...baseProps} enabled={false} />);
    const off = screen.getByRole("button", { name: /enable web search/i });
    expect(off).toHaveAttribute("aria-pressed", "false");
    expect(off).toHaveAttribute("data-web-search-enabled", "false");

    rerender(<WebSearchToggle {...baseProps} enabled={true} />);
    const on = screen.getByRole("button", { name: /disable web search/i });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(on).toHaveAttribute("data-web-search-enabled", "true");
  });

  it("is disabled when the active model lacks the tools capability", () => {
    const { rerender } = render(
      <WebSearchToggle
        {...baseProps}
        modelSupportedParameters={["stream", "reasoning"]}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("data-web-search-supported", "false");

    // No supported_parameters at all (e.g. legacy row, undefined field) → still gated off.
    rerender(<WebSearchToggle {...baseProps} modelSupportedParameters={undefined} />);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-web-search-supported",
      "false",
    );

    // Explicit null behaves the same — capability helper treats it as "no capability".
    rerender(<WebSearchToggle {...baseProps} modelSupportedParameters={null} />);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-web-search-supported",
      "false",
    );

    // Capable model unblocks the button.
    rerender(
      <WebSearchToggle
        {...baseProps}
        modelSupportedParameters={["tools", "stream"]}
      />,
    );
    expect(screen.getByRole("button")).not.toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-web-search-supported",
      "true",
    );
  });

  it("is disabled while the chat is generating, even on a capable model", () => {
    render(<WebSearchToggle {...baseProps} isGenerating={true} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("data-web-search-supported", "true");
  });

  it("clicking calls setChatWebSearchEnabled with the negated current value", async () => {
    const user = userEvent.setup();
    setWebSearchMock.mockClear();

    const { rerender } = render(
      <WebSearchToggle {...baseProps} threadId="t_abc" enabled={false} />,
    );
    await user.click(screen.getByRole("button"));
    expect(setWebSearchMock).toHaveBeenLastCalledWith({
      threadId: "t_abc",
      enabled: true,
    });

    rerender(<WebSearchToggle {...baseProps} threadId="t_abc" enabled={true} />);
    await user.click(screen.getByRole("button"));
    expect(setWebSearchMock).toHaveBeenLastCalledWith({
      threadId: "t_abc",
      enabled: false,
    });

    expect(setWebSearchMock).toHaveBeenCalledTimes(2);
  });

  it("renders tooltipUnsupported when the model lacks tools (regardless of pricing)", () => {
    pricingMock.mockReturnValue({
      source: "unsupported",
      usdPerCall: null,
      creditsPerCall: null,
    });
    render(
      <WebSearchToggle
        {...baseProps}
        enabled={true}
        modelSupportedParameters={[]}
      />,
    );
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      /does not support web search/i,
    );
  });

  it("renders tooltipOn when the toggle is on", () => {
    render(
      <WebSearchToggle
        {...baseProps}
        enabled={true}
        modelSupportedParameters={["tools"]}
      />,
    );
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      /web search on/i,
    );
  });

  it("renders tooltipOff interpolated with the resolved Tavily-basic credit count", () => {
    pricingMock.mockReturnValue({
      source: "tavily-basic",
      usdPerCall: 0.008,
      creditsPerCall: 104,
    });
    render(
      <WebSearchToggle
        {...baseProps}
        enabled={false}
        modelSupportedParameters={["tools"]}
      />,
    );
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip).toHaveTextContent(/104 credits per search/i);
    expect(tooltip).not.toHaveTextContent(/\{credits\}/);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-web-search-source", "tavily-basic");
    expect(btn).toHaveAttribute("data-web-search-credits-estimate", "104");
  });

  it("renders tooltipOff interpolated with the OpenRouter server-tool credit count", () => {
    pricingMock.mockReturnValue({
      source: "openrouter-server-tool",
      usdPerCall: 0.02,
      creditsPerCall: 260,
    });
    render(
      <WebSearchToggle
        {...baseProps}
        enabled={false}
        modelSupportedParameters={["tools"]}
      />,
    );
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      /260 credits per search/i,
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-web-search-source",
      "openrouter-server-tool",
    );
  });

  it("renders tooltipOffLoading while pricing resolves (no '0 credits' flash)", () => {
    pricingMock.mockReturnValue(undefined);
    render(
      <WebSearchToggle
        {...baseProps}
        enabled={false}
        modelSupportedParameters={["tools"]}
      />,
    );
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip).toHaveTextContent(/Search the web for current info\.$/);
    expect(tooltip).not.toHaveTextContent(/0 credits per search/);
    expect(tooltip).not.toHaveTextContent(/\$/);
    // data attrs reflect "we don't know yet" without flashing concrete values.
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-web-search-source", "unsupported");
    expect(btn).toHaveAttribute("data-web-search-credits-estimate", "0");
  });
});
