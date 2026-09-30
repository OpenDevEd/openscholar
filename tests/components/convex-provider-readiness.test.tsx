import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  clerk: { isLoaded: false, isSignedIn: false, userId: undefined as string | undefined, sessionId: undefined as string | undefined },
  convex: { isAuthenticated: false, isLoading: true },
  ensureUser: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: PropsWithChildren) => children,
  useAuth: () => auth.clerk,
}));
vi.mock("convex/react-clerk", () => ({ ConvexProviderWithClerk: ({ children }: PropsWithChildren) => children }));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useConvexAuth: () => auth.convex,
  useMutation: () => auth.ensureUser,
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/components/posthog-identify", () => ({ PostHogIdentify: () => null }));
vi.mock("@/lib/feature-flags/provider", () => ({ FeatureFlagProvider: ({ children }: PropsWithChildren) => children }));
vi.mock("@/lib/billing/catalog-provider", () => ({ BillingCatalogProvider: ({ children }: PropsWithChildren) => children }));
vi.mock("@/lib/research/provider", () => ({ ResearchStateProvider: ({ children }: PropsWithChildren) => children }));

import { ConvexClientProvider, useAuthReadiness } from "@/components/providers/convex-provider";

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Page() {
  const { phase, retryUserSync } = useAuthReadiness();
  return <><input aria-label="Draft query" /><output aria-label="Account phase">{phase}</output><button onClick={retryUserSync}>Retry</button></>;
}

function app() {
  // These providers are outside the auth lifecycle exercised here.
  const preloaded = {} as ComponentProps<typeof ConvexClientProvider>;
  return <ConvexClientProvider {...preloaded}><Page /></ConvexClientProvider>;
}

function signedIn(userId: string, sessionId = `${userId}-session`) {
  auth.clerk = { isLoaded: true, isSignedIn: true, userId, sessionId };
  auth.convex = { isAuthenticated: true, isLoading: false };
}

function phase() { return screen.getByLabelText("Account phase").textContent; }

describe("account readiness without remounting the page", () => {
  beforeEach(() => {
    auth.clerk = { isLoaded: false, isSignedIn: false, userId: undefined, sessionId: undefined };
    auth.convex = { isAuthenticated: false, isLoading: true };
    auth.ensureUser.mockReset();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("preserves a focused draft while Clerk loads and Convex initializes the account", async () => {
    const request = deferred();
    auth.ensureUser.mockReturnValue(request.promise);
    const view = render(app());
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "unfinished research question" } });
    input.focus();
    signedIn("alice");
    auth.convex = { isAuthenticated: false, isLoading: true };
    view.rerender(app());
    expect(screen.getByRole("textbox")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue("unfinished research question");
    expect(phase()).toBe("initializing");
    expect(auth.ensureUser).not.toHaveBeenCalled();
    auth.convex = { isAuthenticated: true, isLoading: false };
    view.rerender(app());
    await act(async () => request.resolve("alice-db-id"));
    expect(phase()).toBe("authenticated");
    expect(document.activeElement).toBe(input);
    expect(auth.ensureUser).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)("ignores an old account's late %s after switching accounts", async (settlement) => {
    const alice = deferred(), bob = deferred();
    auth.ensureUser.mockReturnValueOnce(alice.promise).mockReturnValueOnce(bob.promise);
    signedIn("alice");
    const view = render(app());
    signedIn("bob");
    view.rerender(app());
    await act(async () => { if (settlement === "resolve") alice.resolve(); else alice.reject(new Error("old account failed")); });
    expect(phase()).toBe("initializing");
    await act(async () => bob.resolve());
    expect(phase()).toBe("authenticated");
  });

  it("requires a fresh sync after signing out and back into the same account", async () => {
    const first = deferred(), second = deferred();
    auth.ensureUser.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    signedIn("alice");
    const view = render(app());
    await act(async () => first.resolve());
    expect(phase()).toBe("authenticated");
    auth.clerk = { isLoaded: true, isSignedIn: false, userId: undefined, sessionId: undefined };
    auth.convex = { isAuthenticated: false, isLoading: false };
    view.rerender(app());
    expect(phase()).toBe("anonymous");
    signedIn("alice", "second-session");
    view.rerender(app());
    expect(phase()).toBe("initializing");
    await act(async () => second.resolve());
    expect(phase()).toBe("authenticated");
  });

  it("cancels backoff on sign-out and does not retry a late failure after unmount", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const request = deferred();
    auth.ensureUser.mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(request.promise);
    signedIn("alice");
    const view = render(app());
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(1);
    auth.clerk = { isLoaded: true, isSignedIn: false, userId: undefined, sessionId: undefined };
    auth.convex = { isAuthenticated: false, isLoading: false };
    view.rerender(app());
    expect(phase()).toBe("anonymous");
    expect(vi.getTimerCount()).toBe(0);
    signedIn("bob");
    view.rerender(app());
    view.unmount();
    await act(async () => request.reject(new Error("late failure")));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(auth.ensureUser).toHaveBeenCalledTimes(2);
  });

  it("backs off, exposes exhausted sync, and recovers through retry without losing the page", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth.ensureUser.mockRejectedValue(new Error("unavailable"));
    signedIn("alice");
    render(app());
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "retained draft" } });
    await act(async () => {});
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
      expect(phase()).toBe("initializing");
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    }
    expect(phase()).toBe("sync_error");
    expect(auth.ensureUser).toHaveBeenCalledTimes(7);
    auth.ensureUser.mockResolvedValue("alice-db-id");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(phase()).toBe("authenticated");
    expect(input).toHaveValue("retained draft");
    expect(vi.getTimerCount()).toBe(0);
  });
});
