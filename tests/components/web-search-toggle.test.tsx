/**
 * @vitest-environment jsdom
 *
 * Behavioural tests for the chat composer's web-search toggle.
 *
 * The toggle exposes its semantic state through aria-pressed, data-* hooks,
 * and tooltip text. None of these tests look at class names or inline
 * styles — per the testing doctrine in CLAUDE.md, those are round-trips
 * that prove nothing about the user-visible behaviour.
 *
 * Contract surfaced here:
 *  - aria-pressed mirrors the persisted server state
 *  - the button is aria-disabled, not native-disabled, when the active model
 *    lacks the "tools" capability or when the chat is generating so the
 *    explanatory tooltip can still open
 *  - clicking flips the value via setChatWebSearchEnabled
 *  - tooltip renders a richer surface: title, body, status pill, and
 *    (when supported) cost + provider meta rows in BOTH on and off states
 *  - data-web-search-source / data-web-search-credits-estimate /
 *    data-web-search-state track the active path resolution
 *  - reduced-motion safe: motion.button still renders a real <button>
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

// Inline locale templates — mirror the en-US strings owned by this plan.
// Keeps the test self-contained (no JSON load) while still letting us
// assert on the *rendered* tooltip rather than on the translation key.
const composerStrings: Record<string, string> = {
  "webSearch.label": "Web",
  "webSearch.ariaEnable": "Enable web search",
  "webSearch.ariaDisable": "Disable web search",
  "webSearch.titleOn": "Web search active",
  "webSearch.titleOff": "Web search ready",
  "webSearch.titleUnsupported": "Web search unavailable",
  "webSearch.bodyOn": "Each reply will pull fresh sources from the live web.",
  "webSearch.bodyOff":
    "Click to ground answers in real-time pages from the live web.",
  "webSearch.bodyUnsupported":
    "The selected model can't run tool-based web searches. Switch models to enable.",
  "webSearch.metaCost": "~{credits} credits per search",
  "webSearch.metaCostNote": "One reply may include several searches.",
  "webSearch.metaCostLoading": "Calculating cost…",
  "webSearch.metaProvider": "via {provider}",
  "webSearch.providerTavilyBasic": "Tavily Basic",
  "webSearch.providerOpenRouter": "OpenRouter server tool",
  "webSearch.statusOn": "On",
  "webSearch.statusOff": "Off",
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
  it("aria-pressed reflects the enabled prop and data-web-search-state mirrors it", () => {
    const { rerender } = render(
      <WebSearchToggle {...baseProps} enabled={false} />,
    );
    const off = screen.getByRole("button", { name: /enable web search/i });
    expect(off).toHaveAttribute("aria-pressed", "false");
    expect(off).toHaveAttribute("data-web-search-enabled", "false");
    expect(off).toHaveAttribute("data-web-search-state", "off");

    rerender(<WebSearchToggle {...baseProps} enabled={true} />);
    const on = screen.getByRole("button", { name: /disable web search/i });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(on).toHaveAttribute("data-web-search-enabled", "true");
    expect(on).toHaveAttribute("data-web-search-state", "on");
  });

  it("is aria-disabled, but still tooltip-addressable, when the active model lacks the tools capability", () => {
    const { rerender } = render(
      <WebSearchToggle
        {...baseProps}
        modelSupportedParameters={["stream", "reasoning"]}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /web search unavailable/i,
    });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAttribute("data-web-search-supported", "false");
    expect(btn).toHaveAttribute("data-web-search-state", "unsupported");

    rerender(
      <WebSearchToggle {...baseProps} modelSupportedParameters={undefined} />,
    );
    expect(screen.getByRole("button")).not.toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-web-search-supported",
      "false",
    );

    rerender(
      <WebSearchToggle {...baseProps} modelSupportedParameters={null} />,
    );
    expect(screen.getByRole("button")).not.toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");

    rerender(
      <WebSearchToggle
        {...baseProps}
        modelSupportedParameters={["tools", "stream"]}
      />,
    );
    expect(screen.getByRole("button")).not.toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-web-search-supported",
      "true",
    );
  });

  it("is aria-disabled while the chat is generating, even on a capable model", () => {
    render(<WebSearchToggle {...baseProps} isGenerating={true} />);
    const btn = screen.getByRole("button");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAttribute("data-web-search-supported", "true");
  });

  it("does not mutate when aria-disabled", async () => {
    const user = userEvent.setup();
    setWebSearchMock.mockClear();

    render(<WebSearchToggle {...baseProps} isGenerating={true} />);
    await user.click(screen.getByRole("button"));

    expect(setWebSearchMock).not.toHaveBeenCalled();
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

  it("renders the unsupported tooltip surface when the model lacks tools (regardless of pricing)", () => {
    pricingMock.mockReturnValue({
      source: "unsupported",
      usdPerCall: null,
      creditsPerCall: null,
    });
    const { container } = render(
      <WebSearchToggle
        {...baseProps}
        enabled={true}
        modelSupportedParameters={[]}
      />,
    );
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip).toHaveTextContent(/Web search unavailable/);
    expect(tooltip).toHaveTextContent(/can't run tool-based web searches/);
    // No status pill in unsupported state.
    expect(
      container.querySelector("[data-web-search-status-pill]"),
    ).toBeNull();
    // No meta surface (cost / provider / loading) in unsupported state.
    expect(container.querySelector("[data-tooltip-cost-line]")).toBeNull();
    expect(container.querySelector("[data-tooltip-cost-loading]")).toBeNull();
    expect(
      container.querySelector("[data-tooltip-provider-line]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-web-search-tooltip-hint]"),
    ).toBeNull();
  });

  it("renders the on-state tooltip with title, status pill, body, cost, and provider rows", () => {
    pricingMock.mockReturnValue({
      source: "tavily-basic",
      usdPerCall: 0.008,
      creditsPerCall: 104,
    });
    const { container } = render(
      <WebSearchToggle
        {...baseProps}
        enabled={true}
        modelSupportedParameters={["tools"]}
      />,
    );
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip).toHaveTextContent(/Web search active/);
    expect(tooltip).toHaveTextContent(
      /Each reply will pull fresh sources from the live web\./,
    );
    // Status pill announces "On" alongside the live-state dot.
    const pill = container.querySelector("[data-web-search-status-pill]");
    expect(pill).not.toBeNull();
    expect(pill).toHaveAttribute("data-web-search-status-pill", "on");
    expect(pill).toHaveTextContent(/^On$/);
    // Cost row IS present in the on state — the user explicitly asked
    // for cost visibility even when web search is enabled.
    const costRow = container.querySelector("[data-tooltip-cost-line]");
    expect(costRow).not.toBeNull();
    expect(costRow).toHaveTextContent(/~104 credits per search/i);
    // Provider row resolves to the friendly name, never the raw slug.
    const providerRow = container.querySelector(
      "[data-tooltip-provider-line]",
    );
    expect(providerRow).not.toBeNull();
    expect(providerRow).toHaveTextContent(/via Tavily Basic/);
    expect(providerRow).not.toHaveTextContent(/tavily-basic/);
    expect(
      container.querySelector("[data-web-search-tooltip-hint]"),
    ).toBeNull();
  });

  it("renders the off-state tooltip with the full meta surface", () => {
    pricingMock.mockReturnValue({
      source: "tavily-basic",
      usdPerCall: 0.008,
      creditsPerCall: 104,
    });
    const { container } = render(
      <WebSearchToggle
        {...baseProps}
        enabled={false}
        modelSupportedParameters={["tools"]}
      />,
    );
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip).toHaveTextContent(/Web search ready/);
    expect(tooltip).toHaveTextContent(
      /Click to ground answers in real-time pages/,
    );
    const pill = container.querySelector("[data-web-search-status-pill]");
    expect(pill).toHaveAttribute("data-web-search-status-pill", "off");
    expect(pill).toHaveTextContent(/^Off$/);
    const costRow = container.querySelector("[data-tooltip-cost-line]");
    expect(costRow).not.toBeNull();
    expect(costRow).toHaveTextContent(/~104 credits per search/i);
    expect(tooltip).not.toHaveTextContent(/\{credits\}/);
    expect(
      container.querySelector("[data-tooltip-provider-line]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-web-search-tooltip-hint]"),
    ).toBeNull();
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-web-search-source", "tavily-basic");
    expect(btn).toHaveAttribute("data-web-search-credits-estimate", "104");
  });

  it("renders the OpenRouter server-tool provider label for the openrouter-server-tool source", () => {
    pricingMock.mockReturnValue({
      source: "openrouter-server-tool",
      usdPerCall: 0.02,
      creditsPerCall: 260,
    });
    const { container } = render(
      <WebSearchToggle
        {...baseProps}
        enabled={false}
        modelSupportedParameters={["tools"]}
      />,
    );
    const costRow = container.querySelector("[data-tooltip-cost-line]");
    expect(costRow).toHaveTextContent(/~260 credits per search/i);
    const providerRow = container.querySelector(
      "[data-tooltip-provider-line]",
    );
    expect(providerRow).toHaveTextContent(/via OpenRouter server tool/);
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-web-search-source",
      "openrouter-server-tool",
    );
  });

  it("shows a 'Calculating cost…' placeholder while pricing resolves and never flashes a 0-credit estimate", () => {
    pricingMock.mockReturnValue(undefined);
    const { container } = render(
      <WebSearchToggle
        {...baseProps}
        enabled={false}
        modelSupportedParameters={["tools"]}
      />,
    );
    const tooltip = screen.getByTestId("tooltip-content");
    // Body still renders during the loading window — only the cost row swaps.
    expect(tooltip).toHaveTextContent(/Click to ground answers/);
    // The resolved cost row is structurally absent so users never see
    // an in-progress "0 credits" estimate.
    expect(container.querySelector("[data-tooltip-cost-line]")).toBeNull();
    expect(tooltip).not.toHaveTextContent(/credits per search/);
    expect(tooltip).not.toHaveTextContent(/\$/);
    // A loading placeholder takes its place so the user knows pricing is
    // still being computed instead of seeing a phantom-empty meta row.
    const loading = container.querySelector("[data-tooltip-cost-loading]");
    expect(loading).not.toBeNull();
    expect(loading).toHaveTextContent(/Calculating cost…/);
    // Provider row is gated on a resolved source — also absent here.
    expect(
      container.querySelector("[data-tooltip-provider-line]"),
    ).toBeNull();
    // Data attributes on the button reflect "we don't know yet" without
    // flashing concrete values.
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-web-search-source", "unsupported");
    expect(btn).toHaveAttribute("data-web-search-credits-estimate", "0");
  });

  it("hides the provider row entirely when the source slug is unrecognised", () => {
    pricingMock.mockReturnValue({
      source: "unknown-future-provider",
      usdPerCall: 0.01,
      creditsPerCall: 130,
    });
    const { container } = render(
      <WebSearchToggle
        {...baseProps}
        enabled={false}
        modelSupportedParameters={["tools"]}
      />,
    );
    // Cost is still shown — the credits number is provider-agnostic.
    expect(
      container.querySelector("[data-tooltip-cost-line]"),
    ).toHaveTextContent(/~130 credits per search/i);
    // Provider row is suppressed rather than leaking the raw slug.
    expect(
      container.querySelector("[data-tooltip-provider-line]"),
    ).toBeNull();
    expect(screen.getByTestId("tooltip-content")).not.toHaveTextContent(
      /unknown-future-provider/,
    );
  });
});
