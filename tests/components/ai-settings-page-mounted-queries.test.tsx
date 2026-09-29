/**
 * @vitest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithTooltip as render } from "../helpers/render-with-tooltip";

const convexQueryMock = vi.fn();
const convexClientMock = { query: convexQueryMock };
const useQueryMock = vi.fn();
const useMutationMock = vi.fn((..._args: unknown[]) => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" {...props} />,
}));

vi.mock("motion/react", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        ({
          children,
          whileHover: _whileHover,
          whileTap: _whileTap,
          initial: _initial,
          animate: _animate,
          transition: _transition,
          onAnimationStart: _onAnimationStart,
          ...props
        }: React.HTMLAttributes<HTMLElement> & Record<"whileHover" | "whileTap" | "initial" | "animate" | "transition", unknown>) =>
          React.createElement(tag, props, children),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("convex/react", () => ({
  useConvex: () => convexClientMock,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    models: {
      queries: {
        listCatalogOptions: "models:listCatalogOptions",
        list: "models:list",
      },
    },
    userAiConfig: {
      queries: { get: "userAiConfig:get" },
      mutations: {
        setPreset: "userAiConfig:setPreset",
        setCustomModel: "userAiConfig:setCustomModel",
      },
    },
    aiModelConfig: {
      queries: { list: "aiModelConfig:list" },
    },
  },
}));

vi.mock("@/lib/store", () => ({
  useAIConfigStore: () => ({
    provider: "openai",
    model: "gpt-4o",
    setProvider: vi.fn(),
    setModel: vi.fn(),
    apiKey: "",
    setApiKey: vi.fn(),
    apiKeyMode: "local",
    setApiKeyMode: vi.fn(),
  }),
}));

vi.mock("@/components/providers/convex-provider", () => ({
  useAuthReadiness: () => ({ phase: "authenticated" }),
}));

vi.mock("@/lib/auth/use-sign-in-redirect", () => ({
  useSignInRedirect: () => vi.fn(),
}));

vi.mock("@/lib/auth/use-subscription-state", () => ({
  useSharedSubscriptionState: () => ({ planFeatures: [] }),
}));

vi.mock("@/lib/feature-flags/hook", () => ({
  useFeatureFlagForPlan: () => true,
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    validation: { failed: vi.fn() },
    clipboard: { copyFailed: vi.fn() },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import AISettingsPage from "@/app/settings/ai/page";

describe("<AISettingsPage> model catalog loading", () => {
  beforeEach(() => {
    convexQueryMock.mockReset();
    useQueryMock.mockReset();
    useMutationMock.mockClear();
    convexQueryMock.mockResolvedValue([]);
  });

  it("uses a one-off compact catalog read instead of the live models list query", async () => {
    render(<AISettingsPage />);

    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith(
        "models:listCatalogOptions",
        { provider: "openai" },
      );
    });

    const liveModelQueries = useQueryMock.mock.calls.filter(
      ([queryRef]) => queryRef === "models:list",
    );
    expect(liveModelQueries).toHaveLength(0);
  });

  it("renders an explicit failure state with retry when the catalog read rejects", async () => {
    convexQueryMock.mockRejectedValue(new Error("catalog offline"));

    render(<AISettingsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("somethingWentWrong");

    const callsBeforeRetry = convexQueryMock.mock.calls.length;
    convexQueryMock.mockResolvedValueOnce([]);
    fireEvent.click(within(alert).getByRole("button", { name: "retry" }));

    await waitFor(() => {
      expect(convexQueryMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    });
  });
});
