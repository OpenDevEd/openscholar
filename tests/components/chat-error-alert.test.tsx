/**
 * @vitest-environment jsdom
 *
 * plan-01 — chat-error-alert renders the lifted errors.* namespace and
 * exposes data-error-code on the alert container. Asserts on behavior
 * (ARIA role, data-* attribute, text content) per the project testing
 * doctrine — never on Tailwind class strings.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ChatErrorAlert } from "@/components/extraction/chat/chat-error-alert";
import { serializeChatError } from "@/lib/errors/taxonomy";
import { ABORT_ERROR_STRING } from "@/lib/chat/abort-signal";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, vars?: Record<string, unknown>) => {
    // Simulate message resolution: return a stable string that encodes
    // the namespace + key so tests can assert the component read from
    // the right translation path.
    const resolved = namespace ? `${namespace}:${key}` : key;
    if (!vars) return resolved;
    const suffix = Object.entries(vars)
      .map(([name, value]) => `${name}=${String(value)}`)
      .join(",");
    return `${resolved}(${suffix})`;
  },
}));

vi.mock("convex/react", () => ({
  useQuery: () => null,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      model: { listChatModels: "listChatModels" },
    },
  },
}));

describe("<ChatErrorAlert> — plan-01 taxonomy surface", () => {
  it("emits data-error-code matching the envelope code", () => {
    const wire = serializeChatError({
      version: 1,
      class: "rate_limit",
      message: "429 upstream",
    });
    const { container } = render(
      <ChatErrorAlert rawError={wire} onRetry={() => {}} models={[]} />,
    );

    const alert = container.querySelector("[data-message-error='true']");
    expect(alert).not.toBeNull();
    expect(alert?.getAttribute("data-error-code")).toBe("rate_limit");
  });

  it("reads title + body from the shared errors.* namespace", () => {
    const wire = serializeChatError({
      version: 1,
      class: "insufficient_credits",
      message: "top up",
    });
    render(<ChatErrorAlert rawError={wire} onRetry={() => {}} models={[]} />);

    // The mocked useTranslations returns "<namespace>:<key>" so this
    // test proves the component looked up "errors.title.<code>" (not
    // the old "extraction.chatErrorTitle.<code>" path) and the shared
    // body key.
    expect(
      screen.getByText("errors:title.insufficient_credits"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("errors:body.insufficient_credits"),
    ).toBeInTheDocument();
  });

  it("does not show backend reason or technical details for insufficient credits", () => {
    const { container } = render(
      <ChatErrorAlert
        rawError={serializeChatError({
          version: 1,
          class: "insufficient_credits",
          message: "Not enough credits for this chat message.",
          creditEstimate: {
            required: 700,
            available: 125,
            deficit: 575,
          },
        })}
        onRetry={() => {}}
        models={[]}
      />,
    );

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-error-code",
      "insufficient_credits",
    );
    expect(
      container.querySelector("[data-error-backend-reason]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-error-technical-details]"),
    ).toBeNull();
    expect(screen.queryByText("extraction:chatErrorShowDetails")).toBeNull();
    expect(
      screen.queryByText("Not enough credits for this chat message."),
    ).toBeNull();
    const estimate = container.querySelector("[data-error-credit-estimate]");
    expect(estimate).not.toBeNull();
    expect(estimate).toHaveAttribute("data-credit-required", "700");
    expect(estimate).toHaveAttribute("data-credit-available", "125");
    expect(estimate).toHaveAttribute("data-credit-deficit", "575");
    expect(estimate).toHaveTextContent("extraction:chatErrorCreditsBalance");
    expect(estimate).toHaveTextContent(
      "extraction:chatErrorCreditsCurrentVsEstimate(current=125,estimate=700)",
    );
    expect(estimate).toHaveTextContent(
      "extraction:chatErrorCreditsDeficit(deficit=575)",
    );
    expect(
      container.querySelector("[data-action='retry-inline']"),
    ).not.toBeNull();
  });

  it("uses role=alert for destructive codes and role=status for aborted", () => {
    const { unmount } = render(
      <ChatErrorAlert
        rawError={serializeChatError({
          version: 1,
          class: "provider_5xx",
          message: "oops",
        })}
        onRetry={() => {}}
        models={[]}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    unmount();

    render(
      <ChatErrorAlert
        rawError={serializeChatError({
          version: 1,
          class: "aborted",
          message: "user stopped",
        })}
        onRetry={() => {}}
        models={[]}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("treats the raw chat abort sentinel as a stopped status, not an unknown error", () => {
    const { container } = render(
      <ChatErrorAlert
        rawError={ABORT_ERROR_STRING}
        onRetry={() => {}}
        models={[]}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-error-code", "aborted");
    expect(screen.queryByText("extraction:chatErrorShowDetails")).toBeNull();
    expect(container.querySelector("[data-action='retry-inline']")).toBeNull();
  });

  it("treats the agent failed-message update wrapper as stopped", () => {
    const { container } = render(
      <ChatErrorAlert
        rawError={`Trying to update a message that failed: ks7fm4y0axy6ad5g8pfdmtq00x85f2m5, error: ${ABORT_ERROR_STRING}`}
        onRetry={() => {}}
        models={[]}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-error-code", "aborted");
    expect(screen.queryByText("extraction:chatErrorShowDetails")).toBeNull();
    expect(container.querySelector("[data-action='retry-inline']")).toBeNull();
  });

  it("returns null when the raw error can't be parsed into an envelope", () => {
    const { container } = render(
      <ChatErrorAlert rawError="" onRetry={() => {}} models={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides retry for retryable errors when the failed message is not the latest assistant", () => {
    const wire = serializeChatError({
      version: 1,
      class: "rate_limit",
      message: "429 upstream",
    });
    const { container } = render(
      <ChatErrorAlert
        rawError={wire}
        onRetry={() => {}}
        canRetry={false}
        models={[]}
      />,
    );

    expect(container.querySelector("[data-action='retry-inline']")).toBeNull();
  });

  it("renders retry for every non-aborted chat error when the message can retry", () => {
    const retryableInChat = [
      "context_too_long",
      "moderation",
      "auth",
      "insufficient_credits",
      "provider_5xx",
    ] as const;

    for (const cls of retryableInChat) {
      const { container, unmount } = render(
        <ChatErrorAlert
          rawError={serializeChatError({
            version: 1,
            class: cls,
            message: `${cls} backend reason`,
          })}
          onRetry={() => {}}
          models={[]}
        />,
      );

      expect(container.querySelector("[data-action='retry-inline']")).not.toBeNull();
      unmount();
    }
  });

  it("renders the inline retry control as a plain button so it is safe inside forms", () => {
    const { container } = render(
      <ChatErrorAlert
        rawError={serializeChatError({
          version: 1,
          class: "unknown",
          message: "backend down",
        })}
        onRetry={() => {}}
        models={[]}
      />,
    );

    expect(container.querySelector("[data-action='retry-inline']")).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("renders local regenerate failures with technical details", () => {
    const wire = serializeChatError({
      version: 1,
      class: "regenerate_failed",
      message:
        "Regenerate did not start because the latest chat turn has no assistant message or stream artifact to replace.",
    });
    const { container } = render(
      <ChatErrorAlert rawError={wire} onRetry={() => {}} models={[]} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "regenerate_failed");
    expect(
      screen.getByText("errors:title.regenerate_failed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("errors:body.regenerate_failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("extraction:chatErrorShowDetails")).toBeInTheDocument();
    expect(
      container.querySelector("[data-error-backend-reason]"),
    ).toHaveTextContent(
        "Regenerate did not start because the latest chat turn has no assistant message or stream artifact to replace.",
    );
    expect(
      container.querySelector("[data-action='retry-inline']"),
    ).not.toBeNull();
  });

  it("shows technical details for classified provider errors, not only unknown errors", () => {
    const wire = serializeChatError({
      version: 1,
      class: "context_too_long",
      message:
        "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
      httpStatus: 400,
    });
    const { container } = render(
      <ChatErrorAlert rawError={wire} onRetry={() => {}} models={[]} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "context_too_long");
    expect(alert).toHaveAttribute("data-http-status", "400");
    expect(screen.getByText("extraction:chatErrorShowDetails")).toBeInTheDocument();
    expect(
      container.querySelector("[data-error-backend-reason]"),
    ).toHaveTextContent(
        "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
    );
  });

  it("does not echo generic 'Response failed' as the visible backend reason", () => {
    const { container } = render(
      <ChatErrorAlert rawError="Response failed" onRetry={() => {}} models={[]} />,
    );

    const inlineReason = container.querySelector("[data-error-backend-reason]");
    expect(inlineReason).toHaveTextContent(
      "extraction:chatErrorNoBackendReason",
    );
    expect(inlineReason).not.toHaveTextContent("Response failed");
  });

  it("resets the retry countdown when a new retry-after error replaces the old one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const first = serializeChatError({
        version: 1,
        class: "rate_limit",
        message: "first limit",
        retryAfterMs: 1_000,
      });
      const second = serializeChatError({
        version: 1,
        class: "rate_limit",
        message: "second limit",
        retryAfterMs: 5_000,
      });
      const { rerender } = render(
        <ChatErrorAlert rawError={first} onRetry={() => {}} models={[]} />,
      );

      expect(screen.getByRole("button", { name: /retry/i })).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });
      expect(screen.getByRole("button", { name: /retry/i })).toBeEnabled();

      rerender(
        <ChatErrorAlert rawError={second} onRetry={() => {}} models={[]} />,
      );

      expect(screen.getByRole("button", { name: /retry/i })).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_100);
      });
      expect(screen.getByRole("button", { name: /retry/i })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
