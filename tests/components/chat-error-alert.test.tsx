/**
 * @vitest-environment jsdom
 *
 * plan-01 — chat-error-alert renders the lifted errors.* namespace and
 * exposes data-error-code on the alert container. Asserts on behavior
 * (ARIA role, data-* attribute, text content) per the project testing
 * doctrine — never on Tailwind class strings.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatErrorAlert } from "@/components/extraction/chat/chat-error-alert";
import { serializeChatError } from "@/lib/errors/taxonomy";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) =>
    (key: string) => {
      // Simulate message resolution: return a stable string that encodes
      // the namespace + key so tests can assert the component read from
      // the right translation path.
      return namespace ? `${namespace}:${key}` : key;
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
      <ChatErrorAlert rawError={wire} onRetry={() => {}} />,
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
    render(<ChatErrorAlert rawError={wire} onRetry={() => {}} />);

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

  it("uses role=alert for destructive codes and role=status for aborted", () => {
    const { unmount } = render(
      <ChatErrorAlert
        rawError={serializeChatError({
          version: 1,
          class: "provider_5xx",
          message: "oops",
        })}
        onRetry={() => {}}
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
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("returns null when the raw error can't be parsed into an envelope", () => {
    const { container } = render(
      <ChatErrorAlert rawError="" onRetry={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
