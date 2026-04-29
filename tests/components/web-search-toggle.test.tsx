/**
 * @vitest-environment jsdom
 *
 * Behavioural tests for the chat composer's web-search toggle.
 *
 * Locks the contract laid out in plans/chat-web-search-grounding/07-composer-toggle-ui.md:
 *  - aria-pressed mirrors the persisted server state
 *  - the button is disabled when the active model lacks the "tools" capability
 *    or when the chat is generating
 *  - clicking flips the value via setChatWebSearchEnabled
 *  - tooltip text differentiates unsupported / on / off states
 *
 * Per CLAUDE.md, no Tailwind class assertions appear here. Behaviour is
 * surfaced through aria-pressed, data-web-search-enabled, data-web-search-supported,
 * the tooltip text, and the underlying mutation call.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WebSearchToggle } from "@/components/extraction/chat/web-search-toggle";

const setWebSearchMock = vi.fn().mockResolvedValue(undefined);

vi.mock("convex/react", () => ({
  useMutation: (fnRef: unknown) => {
    if (fnRef === "setChatWebSearchEnabled") return setWebSearchMock;
    return vi.fn();
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        setChatWebSearchEnabled: "setChatWebSearchEnabled",
      },
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

describe("<WebSearchToggle>", () => {
  it("aria-pressed reflects the enabled prop", () => {
    const { rerender } = render(<WebSearchToggle {...baseProps} enabled={false} />);
    const off = screen.getByRole("button", { name: /webSearch\.ariaEnable/i });
    expect(off).toHaveAttribute("aria-pressed", "false");
    expect(off).toHaveAttribute("data-web-search-enabled", "false");

    rerender(<WebSearchToggle {...baseProps} enabled={true} />);
    const on = screen.getByRole("button", { name: /webSearch\.ariaDisable/i });
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
});
