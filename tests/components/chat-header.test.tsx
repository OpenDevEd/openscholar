/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the redesigned <ChatHeader>.
 *
 * Asserts on the user-observable contract:
 * - back affordance is a link to /extraction (the breadcrumb root)
 * - thread title renders
 * - "more options" dropdown opens and exposes a destructive "Delete history" item
 * - the destructive item opens the controlled clear-conversation dialog
 *   (not a one-click destructive trigger, which is what the user called
 *   out as deceptive)
 * - while the job is generating, the destructive item is disabled
 */
import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ChatHeader } from "@/components/extraction/chat/chat-header";
import type { Doc } from "@/convex/_generated/dataModel";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        swapModel: "stub",
        clearThread: "stub",
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({ error: vi.fn() }),
}));

vi.mock("@/components/extraction/model-picker", () => ({
  ModelPicker: () => <div data-testid="model-picker" />,
}));

function makeJob(over: Partial<Doc<"extractionJobs">> = {}): Doc<"extractionJobs"> {
  return {
    _id: "job_1" as Doc<"extractionJobs">["_id"],
    _creationTime: 0,
    name: "Coffee bean roasting study",
    isGenerating: false,
    ...over,
  } as Doc<"extractionJobs">;
}

function withProviders(ui: React.ReactElement) {
  return <TooltipProvider>{ui}</TooltipProvider>;
}

// Radix Dropdown/Tooltip primitives use Pointer Events + ResizeObserver
// APIs that JSDOM doesn't ship; stub the ones the components touch.
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
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  }
});

describe("<ChatHeader>", () => {
  it("renders the thread name", () => {
    render(withProviders(<ChatHeader job={makeJob()} threadId="t_1" />));
    expect(
      screen.getByTestId("chat-job-name"),
    ).toHaveTextContent("Coffee bean roasting study");
  });

  it("back affordance is a link to /extraction", () => {
    render(withProviders(<ChatHeader job={makeJob()} threadId="t_1" />));
    const backLink = screen.getByRole("link", {
      name: /chatBack|back/i,
    });
    expect(backLink).toHaveAttribute("href", "/extraction");
  });

  it("clicking 'more options' opens a dropdown with a destructive Delete item", async () => {
    const user = userEvent.setup();
    render(withProviders(<ChatHeader job={makeJob()} threadId="t_1" />));
    await user.click(
      screen.getByRole("button", { name: /chatHeaderMore/i }),
    );
    const item = await screen.findByRole("menuitem");
    expect(item).toHaveAttribute("data-action", "open-clear");
    expect(item).toHaveAttribute("data-variant", "destructive");
  });

  it("selecting Delete opens the confirm dialog (no one-click destructive)", async () => {
    const user = userEvent.setup();
    render(withProviders(<ChatHeader job={makeJob()} threadId="t_1" />));
    await user.click(
      screen.getByRole("button", { name: /chatHeaderMore/i }),
    );
    const item = await screen.findByRole("menuitem");
    await user.click(item);
    await waitFor(() => {
      expect(
        document.querySelector('[data-clear-conversation="true"]'),
      ).not.toBeNull();
    });
  });

  it("Delete item is disabled while the job is generating", async () => {
    const user = userEvent.setup();
    render(
      withProviders(
        <ChatHeader job={makeJob({ isGenerating: true })} threadId="t_1" />,
      ),
    );
    await user.click(
      screen.getByRole("button", { name: /chatHeaderMore/i }),
    );
    const item = await screen.findByRole("menuitem");
    expect(item).toHaveAttribute("data-disabled");
  });
});
